import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { CollaborationRepository } from "../../src/collaboration/collaboration-repository.js";

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
  const [alice] = await sql<{ id: string }[]>`
    insert into accounts (display_name, password_hash, phone_e164, phone_verified_at)
    values ('Alice', 'hash', '+8613800138421', now()) returning id
  `;
  const [bob] = await sql<{ id: string }[]>`
    insert into accounts (display_name, password_hash, phone_e164, phone_verified_at)
    values ('Bob', 'hash', '+8613800138422', now()) returning id
  `;
  const [orgA] = await sql<{ id: string }[]>`
    insert into organizations (name) values ('Collaboration A') returning id
  `;
  const [orgB] = await sql<{ id: string }[]>`
    insert into organizations (name) values ('Collaboration B') returning id
  `;
  if (alice === undefined || bob === undefined || orgA === undefined || orgB === undefined) {
    throw new Error("collaboration fixture failed");
  }
  await sql`insert into memberships (organization_id, account_id, role, status) values
    (${orgA.id}, ${alice.id}, 'org_owner', 'active'),
    (${orgA.id}, ${bob.id}, 'member', 'active'),
    (${orgB.id}, ${alice.id}, 'org_owner', 'active')`;
  return { alice, bob, orgA, orgB };
}

describe("collaboration kernel", () => {
  test("rejects cross-organization, self and duplicate resource links", async () => {
    const { alice, orgA, orgB } = await fixture();
    const repository = new CollaborationRepository();
    const source = {
      organizationId: orgA.id,
      resourceType: "file" as const,
      resourceId: crypto.randomUUID(),
    };
    const target = {
      organizationId: orgA.id,
      resourceType: "work_item" as const,
      resourceId: crypto.randomUUID(),
    };
    const outside = {
      organizationId: orgB.id,
      resourceType: "work_item" as const,
      resourceId: crypto.randomUUID(),
    };
    await sql.begin(async (transaction) => {
      await repository.registerResource(transaction, source);
      await repository.registerResource(transaction, target);
      await repository.registerResource(transaction, outside);
    });

    await expect(
      sql.begin((transaction) =>
        repository.createLink(transaction, {
          accountId: alice.id,
          source,
          target: outside,
          relationType: "related",
        }),
      ),
    ).rejects.toMatchObject({ code: "ORG_FORBIDDEN" });
    await expect(
      sql.begin((transaction) =>
        repository.createLink(transaction, {
          accountId: alice.id,
          source,
          target: source,
          relationType: "related",
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await sql.begin((transaction) =>
      repository.createLink(transaction, {
        accountId: alice.id,
        source,
        target,
        relationType: "related",
      }),
    );
    await expect(
      sql.begin((transaction) =>
        repository.createLink(transaction, {
          accountId: alice.id,
          source,
          target,
          relationType: "related",
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  test("allows active members to comment and rejects removed members", async () => {
    const { alice, bob, orgA } = await fixture();
    const repository = new CollaborationRepository();
    const resource = {
      organizationId: orgA.id,
      resourceType: "file" as const,
      resourceId: crypto.randomUUID(),
    };
    await sql.begin((transaction) => repository.registerResource(transaction, resource));
    await expect(
      sql.begin((transaction) =>
        repository.addComment(transaction, {
          accountId: bob.id,
          resource,
          body: "I can help",
        }),
      ),
    ).resolves.toMatchObject({ body: "I can help", authorAccountId: bob.id });
    await sql`update memberships set status = 'removed', removed_at = now()
      where organization_id = ${orgA.id} and account_id = ${bob.id}`;
    await expect(
      sql.begin((transaction) =>
        repository.addComment(transaction, {
          accountId: bob.id,
          resource,
          body: "stale session",
        }),
      ),
    ).rejects.toMatchObject({ code: "ORG_FORBIDDEN" });
    await expect(
      sql.begin((transaction) =>
        repository.addComment(transaction, {
          accountId: alice.id,
          resource,
          body: "still active",
        }),
      ),
    ).resolves.toMatchObject({ authorAccountId: alice.id });
  });

  test("keeps domain events immutable and commits their outbox atomically", async () => {
    const { alice, orgA } = await fixture();
    const repository = new CollaborationRepository();
    const aggregate = {
      organizationId: orgA.id,
      resourceType: "work_item" as const,
      resourceId: crypto.randomUUID(),
    };
    await sql.begin((transaction) => repository.registerResource(transaction, aggregate));

    await expect(
      sql.begin(async (transaction) => {
        await repository.appendDomainEvent(transaction, {
          accountId: alice.id,
          aggregate,
          sequence: 1,
          eventType: "work.created",
          schemaVersion: 1,
          payload: { title: "Rollback" },
        });
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");
    const [rolledBack] = await sql<{ events: number; outbox: number }[]>`
      select
        (select count(*)::int from domain_events) as events,
        (select count(*)::int from outbox_events where event_type = 'domain.event') as outbox
    `;
    expect(rolledBack).toEqual({ events: 0, outbox: 0 });

    const event = await sql.begin((transaction) =>
      repository.appendDomainEvent(transaction, {
        accountId: alice.id,
        aggregate,
        sequence: 1,
        eventType: "work.created",
        schemaVersion: 1,
        payload: { title: "Committed" },
      }),
    );
    const [committed] = await sql<{ events: number; outbox: number }[]>`
      select
        (select count(*)::int from domain_events) as events,
        (select count(*)::int from outbox_events where event_type = 'domain.event') as outbox
    `;
    expect(committed).toEqual({ events: 1, outbox: 1 });
    await expect(
      sql`update domain_events set event_type = 'tampered' where id = ${event.id}`,
    ).rejects.toThrow(/append-only/);
    await expect(sql`delete from domain_events where id = ${event.id}`).rejects.toThrow(
      /append-only/,
    );
  });
});
