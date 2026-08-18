import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { UnitOfWork } from "../../src/db/transaction.js";
import { AccountRepository } from "../../src/repositories/account-repository.js";
import { AuditRepository } from "../../src/repositories/audit-repository.js";
import { IdempotencyRepository } from "../../src/repositories/idempotency-repository.js";
import { OutboxRepository } from "../../src/repositories/outbox-repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for repository integration tests");
}

let sql: DatabaseClient;
let unitOfWork: UnitOfWork;
const accounts = new AccountRepository();
const audit = new AuditRepository();
const idempotency = new IdempotencyRepository();
const outbox = new OutboxRepository();

beforeAll(async () => {
  await resetTestDatabase(testDatabaseUrl);
  await migrateDatabase(testDatabaseUrl);
  sql = createDatabaseClient(testDatabaseUrl);
  unitOfWork = new UnitOfWork(sql);
}, 30_000);

beforeEach(async () => {
  await sql`truncate table audit_events, outbox_events, idempotency_records, sessions, devices, memberships, organizations, phone_verifications, principals, accounts cascade`;
});

afterAll(async () => {
  await sql?.end();
});

async function counts() {
  const [result] = await sql<{ accounts: number; audit: number; outbox: number }[]>`
    select
      (select count(*)::int from accounts) as accounts,
      (select count(*)::int from audit_events) as audit,
      (select count(*)::int from outbox_events) as outbox
  `;
  return result;
}

async function createActor() {
  return unitOfWork.run(async (transaction) => {
    const account = await accounts.insert(transaction, {
      username: "idempotency-user",
      passwordHash: "argon2id-fixture",
    });
    const [principal] = await transaction<{ id: string }[]>`
      insert into principals (account_id, type)
      values (${account.id}, 'human')
      returning id
    `;
    if (principal === undefined) throw new Error("failed to create Principal fixture");
    return principal.id;
  });
}

describe("transactional repositories", () => {
  test("rolls back domain, audit, and outbox together", async () => {
    await expect(
      unitOfWork.run(async (transaction) => {
        const account = await accounts.insert(transaction, {
          username: "rollback-user",
          passwordHash: "argon2id-fixture",
        });
        await audit.append(transaction, {
          accountId: account.id,
          serverIp: "127.0.0.1",
          actorSource: "system",
          capabilityId: "auth.register",
          action: "auth.register",
          result: "success",
          requestId: "b6065a41-55a1-4475-ad31-b5e93be7cee0",
          eventHash: "rollback-event-hash",
        });
        await outbox.append(transaction, {
          eventType: "account.registered",
          payload: { accountId: account.id },
        });
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");

    expect(await counts()).toEqual({ accounts: 0, audit: 0, outbox: 0 });
  });

  test("commits domain, audit, and outbox together", async () => {
    await unitOfWork.run(async (transaction) => {
      const account = await accounts.insert(transaction, {
        username: "commit-user",
        passwordHash: "argon2id-fixture",
      });
      await audit.append(transaction, {
        accountId: account.id,
        serverIp: "127.0.0.1",
        actorSource: "system",
        capabilityId: "auth.register",
        action: "auth.register",
        result: "success",
        requestId: "4efc86c7-f0cf-4ce1-b742-09f5e9b42a39",
        eventHash: "commit-event-hash",
      });
      await outbox.append(transaction, {
        eventType: "account.registered",
        payload: { accountId: account.id },
      });
    });

    expect(await counts()).toEqual({ accounts: 1, audit: 1, outbox: 1 });
  });

  test("returns cached response for canonical-equivalent idempotent input", async () => {
    const actorId = await createActor();
    await unitOfWork.run(async (transaction) => {
      const claim = await idempotency.claim(transaction, {
        actorPrincipalId: actorId,
        capabilityId: "organization.create",
        idempotencyKey: "key-1",
        input: { b: 2, a: 1 },
      });
      expect(claim.kind).toBe("claimed");
      await idempotency.complete(transaction, {
        actorPrincipalId: actorId,
        capabilityId: "organization.create",
        idempotencyKey: "key-1",
        responseStatus: 201,
        responseBody: { id: "org-1" },
      });
    });

    const cached = await unitOfWork.run((transaction) =>
      idempotency.claim(transaction, {
        actorPrincipalId: actorId,
        capabilityId: "organization.create",
        idempotencyKey: "key-1",
        input: { a: 1, b: 2 },
      }),
    );
    expect(cached).toEqual({ kind: "cached", responseStatus: 201, responseBody: { id: "org-1" } });

    const [stored] = await sql<{ request_hash: string }[]>`
      select request_hash from idempotency_records where idempotency_key = 'key-1'
    `;
    expect(stored?.request_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("same idempotency key with different input conflicts", async () => {
    const actorId = await createActor();
    await unitOfWork.run((transaction) =>
      idempotency.claim(transaction, {
        actorPrincipalId: actorId,
        capabilityId: "organization.create",
        idempotencyKey: "key-1",
        input: { name: "Tashan" },
      }),
    );

    await expect(
      unitOfWork.run((transaction) =>
        idempotency.claim(transaction, {
          actorPrincipalId: actorId,
          capabilityId: "organization.create",
          idempotencyKey: "key-1",
          input: { name: "Another Organization" },
        }),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
});
