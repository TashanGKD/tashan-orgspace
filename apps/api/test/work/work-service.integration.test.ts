import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { WorkService } from "../../src/work/work-service.js";

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
  const accounts: string[] = [];
  for (const [index, name] of ["Alice", "Bob", "Charlie"].entries()) {
    const [row] = await sql<{ id: string }[]>`
      insert into accounts (display_name, password_hash, phone_e164, phone_verified_at)
      values (${name}, 'hash', ${`+861380013843${index}`}, now()) returning id
    `;
    if (row === undefined) throw new Error("account fixture failed");
    accounts.push(row.id);
  }
  const [organization] = await sql<{ id: string }[]>`
    insert into organizations (name) values ('Work Org') returning id
  `;
  const [alice, bob, charlie] = accounts;
  if (
    organization === undefined ||
    alice === undefined ||
    bob === undefined ||
    charlie === undefined
  ) {
    throw new Error("work fixture failed");
  }
  await sql`insert into memberships (organization_id, account_id, role, status) values
    (${organization.id}, ${alice}, 'org_owner', 'active'),
    (${organization.id}, ${bob}, 'member', 'active'),
    (${organization.id}, ${charlie}, 'member', 'active')`;
  return {
    organizationId: organization.id,
    alice,
    bob,
    charlie,
  };
}

describe("work service", () => {
  test("keeps responsibility during dispute and transfer request", async () => {
    const actor = await fixture();
    const service = new WorkService();
    const created = await sql.begin((transaction) =>
      service.create(transaction, actor.alice, actor.organizationId, {
        type: "task",
        title: "Prepare agenda",
        description: "Draft it",
        priority: "normal",
        assigneeAccountIds: [actor.bob],
      }),
    );
    expect(created.assignments).toEqual([
      expect.objectContaining({ assigneeAccountId: actor.bob, status: "assigned" }),
    ]);
    const assignmentId = created.assignments[0]?.id;
    if (assignmentId === undefined) throw new Error("assignment missing");

    const disputed = await sql.begin((transaction) =>
      service.transition(transaction, actor.bob, created.item.id, {
        action: "dispute",
        assignmentId,
        reason: "Deadline is impossible",
        expectedVersion: created.item.version,
      }),
    );
    expect(disputed.assignments).toEqual([
      expect.objectContaining({ assigneeAccountId: actor.bob, status: "disputed" }),
    ]);
    const transfer = await sql.begin((transaction) =>
      service.transition(transaction, actor.bob, created.item.id, {
        action: "request_transfer",
        assignmentId,
        targetAccountId: actor.charlie,
        reason: "Charlie owns the source",
        expectedVersion: disputed.item.version,
      }),
    );
    expect(transfer.assignments).toEqual([
      expect.objectContaining({
        assigneeAccountId: actor.bob,
        transferTargetAccountId: actor.charlie,
        status: "transfer_pending",
      }),
    ]);
    const approved = await sql.begin((transaction) =>
      service.transition(transaction, actor.alice, created.item.id, {
        action: "approve_transfer",
        assignmentId,
        expectedVersion: transfer.item.version,
      }),
    );
    expect(approved.assignments).toEqual([
      expect.objectContaining({ assigneeAccountId: actor.charlie, status: "assigned" }),
    ]);
  });

  test("enforces optimistic versions, membership and terminal transitions", async () => {
    const actor = await fixture();
    const service = new WorkService();
    const created = await sql.begin((transaction) =>
      service.create(transaction, actor.alice, actor.organizationId, {
        type: "task",
        title: "Submit report",
        priority: "urgent",
        assigneeAccountIds: [actor.bob],
      }),
    );
    await expect(
      sql.begin((transaction) =>
        service.transition(transaction, actor.bob, created.item.id, {
          action: "complete",
          expectedVersion: created.item.version + 1,
        }),
      ),
    ).rejects.toMatchObject({ code: "WORK_VERSION_CONFLICT" });
    const completed = await sql.begin((transaction) =>
      service.transition(transaction, actor.bob, created.item.id, {
        action: "complete",
        expectedVersion: created.item.version,
      }),
    );
    const reopened = await sql.begin((transaction) =>
      service.transition(transaction, actor.alice, created.item.id, {
        action: "reopen",
        expectedVersion: completed.item.version,
      }),
    );
    const cancelled = await sql.begin((transaction) =>
      service.transition(transaction, actor.alice, created.item.id, {
        action: "cancel",
        expectedVersion: reopened.item.version,
      }),
    );
    expect(cancelled.item.status).toBe("cancelled");

    await sql`update memberships set status = 'removed', removed_at = now()
      where organization_id = ${actor.organizationId} and account_id = ${actor.bob}`;
    await expect(
      sql.begin((transaction) =>
        service.transition(transaction, actor.bob, created.item.id, {
          action: "reopen",
          expectedVersion: cancelled.item.version,
        }),
      ),
    ).rejects.toMatchObject({ code: "ORG_FORBIDDEN" });
  });

  test("emits exactly one domain event and outbox row per accepted operation", async () => {
    const actor = await fixture();
    const service = new WorkService();
    const created = await sql.begin((transaction) =>
      service.create(transaction, actor.alice, actor.organizationId, {
        type: "task",
        title: "Count events",
        priority: "normal",
        assigneeAccountIds: [],
      }),
    );
    await sql.begin((transaction) =>
      service.transition(transaction, actor.alice, created.item.id, {
        action: "assign",
        accountId: actor.bob,
        expectedVersion: created.item.version,
      }),
    );
    const [counts] = await sql<{ domain: number; outbox: number }[]>`
      select
        (select count(*)::int from domain_events where aggregate_id = ${created.item.id}) as domain,
        (select count(*)::int from outbox_events where event_type = 'domain.event') as outbox
    `;
    expect(counts).toEqual({ domain: 2, outbox: 2 });
  });
});
