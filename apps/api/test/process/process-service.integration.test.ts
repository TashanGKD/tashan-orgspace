import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { ProcessService } from "../../src/process/process-service.js";

const url = process.env.TEST_DATABASE_URL;
if (url === undefined) throw new Error("TEST_DATABASE_URL is required");
let sql: DatabaseClient;
beforeAll(async () => {
  await resetTestDatabase(url);
  await migrateDatabase(url);
  sql = createDatabaseClient(url);
}, 30_000);
beforeEach(async () => {
  await sql`truncate table audit_events, outbox_events, session_refresh_tokens, sessions, devices, memberships, organizations, phone_verifications, principals, accounts cascade`;
});
afterAll(async () => sql?.end());

async function fixture() {
  const ids: string[] = [];
  for (const [index, name] of ["Alice", "Bob", "Charlie"].entries()) {
    const [row] = await sql<{ id: string }[]>`
      insert into accounts (display_name, password_hash, phone_e164, phone_verified_at)
      values (${name}, 'hash', ${`+861380013844${index}`}, now()) returning id
    `;
    if (row === undefined) throw new Error("account fixture failed");
    ids.push(row.id);
  }
  const [alice, bob, charlie] = ids;
  const [organization] = await sql<{ id: string }[]>`
    insert into organizations (name) values ('Process Org') returning id
  `;
  if (
    organization === undefined ||
    alice === undefined ||
    bob === undefined ||
    charlie === undefined
  ) {
    throw new Error("process fixture failed");
  }
  await sql`insert into memberships (organization_id, account_id, role, status) values
    (${organization.id}, ${alice}, 'org_owner', 'active'),
    (${organization.id}, ${bob}, 'member', 'active'),
    (${organization.id}, ${charlie}, 'member', 'active')`;
  return { organizationId: organization.id, alice, bob, charlie };
}

async function published(
  service: ProcessService,
  actor: Awaited<ReturnType<typeof fixture>>,
  mode: "single" | "sequence" | "any" | "all",
  approvers: string[],
) {
  const created = await sql.begin((tx) =>
    service.createDefinition(tx, actor.alice, actor.organizationId, {
      name: `${mode} approval`,
      mode,
      approverAccountIds: approvers,
    }),
  );
  return sql.begin((tx) => service.publishVersion(tx, actor.alice, created.version.id));
}

describe("process service", () => {
  test("freezes published versions and pins instances to their selected version", async () => {
    const actor = await fixture();
    const service = new ProcessService();
    const first = await published(service, actor, "single", [actor.bob]);
    await expect(
      sql`update process_definition_versions set mode = 'all' where id = ${first.version.id}`,
    ).rejects.toThrow(/published process versions are immutable/);
    await expect(
      sql`update process_definition_steps set approver_account_id = ${actor.charlie}
        where definition_version_id = ${first.version.id}`,
    ).rejects.toThrow(/published process versions are immutable/);

    const secondDraft = await sql.begin((tx) =>
      service.createVersion(tx, actor.alice, first.definition.id, {
        mode: "all",
        approverAccountIds: [actor.bob, actor.charlie],
        expectedDefinitionVersion: first.definition.version,
      }),
    );
    await sql.begin((tx) => service.publishVersion(tx, actor.alice, secondDraft.version.id));
    const instance = await sql.begin((tx) =>
      service.start(tx, actor.alice, first.version.id, { subject: { kind: "manual" } }),
    );
    expect(instance.instance.definitionVersionId).toBe(first.version.id);
    expect(instance.steps).toHaveLength(1);
  });

  test("runs sequence approvals in order", async () => {
    const actor = await fixture();
    const service = new ProcessService();
    const process = await published(service, actor, "sequence", [actor.bob, actor.charlie]);
    const started = await sql.begin((tx) =>
      service.start(tx, actor.alice, process.version.id, { subject: { kind: "manual" } }),
    );
    await expect(
      sql.begin((tx) =>
        service.decide(tx, actor.charlie, started.instance.id, {
          action: "approve",
          expectedVersion: started.instance.version,
        }),
      ),
    ).rejects.toMatchObject({ code: "PROCESS_FORBIDDEN" });
    const first = await sql.begin((tx) =>
      service.decide(tx, actor.bob, started.instance.id, {
        action: "approve",
        expectedVersion: started.instance.version,
      }),
    );
    expect(first.instance.status).toBe("pending");
    expect(first.steps.map((step) => step.status)).toEqual(["approved", "pending"]);
    const final = await sql.begin((tx) =>
      service.decide(tx, actor.charlie, started.instance.id, {
        action: "approve",
        expectedVersion: first.instance.version,
      }),
    );
    expect(final.instance.status).toBe("approved");
  });

  test("supports any/all, and accepts only one concurrent any decision", async () => {
    const actor = await fixture();
    const service = new ProcessService();
    const any = await published(service, actor, "any", [actor.bob, actor.charlie]);
    const anyInstance = await sql.begin((tx) =>
      service.start(tx, actor.alice, any.version.id, { subject: { kind: "manual" } }),
    );
    const concurrent = await Promise.allSettled([
      sql.begin((tx) =>
        service.decide(tx, actor.bob, anyInstance.instance.id, {
          action: "approve",
          expectedVersion: 1,
        }),
      ),
      sql.begin((tx) =>
        service.decide(tx, actor.charlie, anyInstance.instance.id, {
          action: "approve",
          expectedVersion: 1,
        }),
      ),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    const [anyState] = await sql<{ status: string; version: number }[]>`
      select status, version from process_instances where id = ${anyInstance.instance.id}
    `;
    expect(anyState).toEqual({ status: "approved", version: 2 });
    const [decisionCount] = await sql<{ count: number }[]>`
      select count(*)::int as count from process_decision_events
      where process_instance_id = ${anyInstance.instance.id}
    `;
    expect(decisionCount?.count).toBe(1);

    const all = await published(service, actor, "all", [actor.bob, actor.charlie]);
    const allInstance = await sql.begin((tx) =>
      service.start(tx, actor.alice, all.version.id, { subject: { kind: "manual" } }),
    );
    const partial = await sql.begin((tx) =>
      service.decide(tx, actor.bob, allInstance.instance.id, {
        action: "approve",
        expectedVersion: 1,
      }),
    );
    expect(partial.instance.status).toBe("pending");
    const complete = await sql.begin((tx) =>
      service.decide(tx, actor.charlie, allInstance.instance.id, {
        action: "approve",
        expectedVersion: 2,
      }),
    );
    expect(complete.instance.status).toBe("approved");
  });

  test("transfers, returns and lets only the initiator withdraw", async () => {
    const actor = await fixture();
    const service = new ProcessService();
    const process = await published(service, actor, "single", [actor.bob]);
    const started = await sql.begin((tx) =>
      service.start(tx, actor.alice, process.version.id, { subject: { kind: "manual" } }),
    );
    const transferred = await sql.begin((tx) =>
      service.decide(tx, actor.bob, started.instance.id, {
        action: "transfer",
        targetAccountId: actor.charlie,
        reason: "Subject owner",
        expectedVersion: 1,
      }),
    );
    expect(transferred.steps[0]).toMatchObject({
      approverAccountId: actor.charlie,
      transferredFromAccountId: actor.bob,
      status: "pending",
    });
    const returned = await sql.begin((tx) =>
      service.decide(tx, actor.charlie, started.instance.id, {
        action: "return",
        reason: "Missing attachment",
        expectedVersion: 2,
      }),
    );
    expect(returned.instance.status).toBe("returned");

    const second = await sql.begin((tx) =>
      service.start(tx, actor.alice, process.version.id, { subject: { kind: "manual" } }),
    );
    await expect(
      sql.begin((tx) =>
        service.decide(tx, actor.bob, second.instance.id, {
          action: "withdraw",
          reason: "not mine",
          expectedVersion: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: "PROCESS_FORBIDDEN" });
    const withdrawn = await sql.begin((tx) =>
      service.decide(tx, actor.alice, second.instance.id, {
        action: "withdraw",
        reason: "No longer needed",
        expectedVersion: 1,
      }),
    );
    expect(withdrawn.instance.status).toBe("withdrawn");
  });
});
