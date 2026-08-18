import { FakeVerificationCodeSender } from "@tashan/testkit";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import {
  PhoneVerificationService,
  type PhoneRateLimiter,
} from "../../src/phone/phone-verification-service.js";
import { UnavailableVerificationCodeSender } from "../../src/phone/verification-code-sender.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for phone integration tests");
}

class RecordingLimiter implements PhoneRateLimiter {
  public readonly keys: string[] = [];
  public allow = true;

  public async consume(key: string): Promise<boolean> {
    this.keys.push(key);
    return this.allow;
  }
}

let sql: DatabaseClient;
let accountId: string;

beforeAll(async () => {
  await resetTestDatabase(testDatabaseUrl);
  await migrateDatabase(testDatabaseUrl);
  sql = createDatabaseClient(testDatabaseUrl);
}, 30_000);

beforeEach(async () => {
  await sql`truncate table audit_events, session_refresh_tokens, sessions, devices, memberships, organizations, phone_verifications, principals, accounts cascade`;
  const [account] = await sql<{ id: string }[]>`
    insert into accounts (username, password_hash) values ('alice', 'argon2id-fixture') returning id
  `;
  if (account === undefined) throw new Error("failed to create account fixture");
  accountId = account.id;
});

afterAll(async () => {
  await sql?.end();
});

describe("phone verification state machine", () => {
  test("sends, confirms, consumes, and records all rate-limit dimensions", async () => {
    const sender = new FakeVerificationCodeSender();
    const limiter = new RecordingLimiter();
    const phones = new PhoneVerificationService({
      sql,
      sender,
      rateLimiter: limiter,
      codePepper: "test-only-pepper",
    });
    const challenge = await phones.start(accountId, "+8613800138000", "203.0.113.7");
    const code = sender.messages[0]?.code;
    if (code === undefined) throw new Error("fake sender did not receive a code");

    await expect(phones.confirm(accountId, challenge.challengeId, code)).resolves.toMatchObject({
      phone: "+8613800138000",
    });
    await expect(phones.confirm(accountId, challenge.challengeId, code)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(limiter.keys).toEqual(
      expect.arrayContaining([
        `phone:account:${accountId}`,
        "phone:number:+8613800138000",
        "phone:ip:203.0.113.7",
      ]),
    );
  });

  test("consumes the five-attempt budget atomically", async () => {
    const sender = new FakeVerificationCodeSender();
    const phones = new PhoneVerificationService({
      sql,
      sender,
      rateLimiter: new RecordingLimiter(),
      codePepper: "test-only-pepper",
    });
    const challenge = await phones.start(accountId, "+8613800138000", "127.0.0.1");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        phones.confirm(accountId, challenge.challengeId, "000000"),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
    const correctCode = sender.messages[0]?.code;
    await expect(
      phones.confirm(accountId, challenge.challengeId, correctCode ?? ""),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  test("unavailable production sender fails before writing a challenge", async () => {
    const phones = new PhoneVerificationService({
      sql,
      sender: new UnavailableVerificationCodeSender(),
      rateLimiter: new RecordingLimiter(),
      codePepper: "test-only-pepper",
    });

    await expect(phones.start(accountId, "+8613800138000", "127.0.0.1")).rejects.toMatchObject({
      code: "PHONE_PROVIDER_UNAVAILABLE",
    });
    const [count] = await sql<{ count: number }[]>`
      select count(*)::int as count from phone_verifications
    `;
    expect(count?.count).toBe(0);
  });
});
