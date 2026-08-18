import { FakeVerificationCodeSender } from "@tashan/testkit";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import type { TransactionClient } from "../../src/db/transaction.js";
import {
  PhoneVerificationService,
  type PhoneRateLimiter,
} from "../../src/phone/phone-verification-service.js";
import type { VerificationCodeSender } from "../../src/phone/verification-code-sender.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for phone integration tests");
}
const requiredTestDatabaseUrl: string = testDatabaseUrl;

class RecordingLimiter implements PhoneRateLimiter {
  public readonly keys: string[] = [];
  public allow = true;

  public async consume(key: string): Promise<boolean> {
    this.keys.push(key);
    return this.allow;
  }
}

class RejectingSender implements VerificationCodeSender {
  public readonly available = true;

  public async send(): Promise<void> {
    throw new Error("provider rejected fixture");
  }
}

let sql: DatabaseClient;

beforeAll(async () => {
  await resetTestDatabase(requiredTestDatabaseUrl);
  await migrateDatabase(requiredTestDatabaseUrl);
  sql = createDatabaseClient(requiredTestDatabaseUrl);
}, 30_000);

beforeEach(async () => {
  await sql`truncate table phone_verifications cascade`;
});

afterAll(async () => {
  await sql?.end();
});

function service(sender: VerificationCodeSender, limiter = new RecordingLimiter()) {
  return {
    limiter,
    phones: new PhoneVerificationService({
      sql,
      sender,
      rateLimiter: limiter,
      codePepper: "test-only-pepper",
    }),
  };
}

function consume(
  phones: PhoneVerificationService,
  input: {
    phone: string;
    purpose: "register" | "password_reset";
    challengeId: string;
    code: string;
  },
) {
  return sql.begin((transaction: TransactionClient) => phones.consume(input, transaction));
}

describe("anonymous purpose-bound phone verification", () => {
  test("rejects a register challenge used for password reset", async () => {
    const sender = new FakeVerificationCodeSender();
    const { phones } = service(sender);
    const challenge = await phones.start({
      phone: "+8613800138000",
      purpose: "register",
      serverIp: "203.0.113.7",
      requestId: "746fb70b-a27e-4a78-a231-aa55ef8c343e",
    });

    await expect(
      consume(phones, {
        phone: "+8613800138000",
        purpose: "password_reset",
        challengeId: challenge.challengeId,
        code: sender.messages[0]?.code ?? "",
      }),
    ).rejects.toMatchObject({ code: "VERIFICATION_INVALID" });
  });

  test("rejects the right code paired with a different phone", async () => {
    const sender = new FakeVerificationCodeSender();
    const { phones } = service(sender);
    const challenge = await phones.start({
      phone: "+8613800138000",
      purpose: "register",
      serverIp: "203.0.113.7",
      requestId: "746fb70b-a27e-4a78-a231-aa55ef8c343e",
    });

    await expect(
      consume(phones, {
        phone: "+8613900139000",
        purpose: "register",
        challengeId: challenge.challengeId,
        code: sender.messages[0]?.code ?? "",
      }),
    ).rejects.toMatchObject({ code: "VERIFICATION_INVALID" });
  });

  test("rejects expired and already-consumed challenges", async () => {
    const sender = new FakeVerificationCodeSender();
    const { phones } = service(sender);
    const expired = await phones.start({
      phone: "+8613800138000",
      purpose: "register",
      serverIp: "203.0.113.7",
      requestId: "746fb70b-a27e-4a78-a231-aa55ef8c343e",
    });
    await sql`update phone_verifications set expires_at = now() - interval '1 second' where id = ${expired.challengeId}`;
    await expect(
      consume(phones, {
        phone: "+8613800138000",
        purpose: "register",
        challengeId: expired.challengeId,
        code: sender.messages[0]?.code ?? "",
      }),
    ).rejects.toMatchObject({ code: "VERIFICATION_EXPIRED" });

    const active = await phones.start({
      phone: "+8613800138000",
      purpose: "password_reset",
      serverIp: "203.0.113.7",
      requestId: "b6065a41-55a1-4475-ad31-b5e93be7cee0",
    });
    const input = {
      phone: "+8613800138000",
      purpose: "password_reset" as const,
      challengeId: active.challengeId,
      code: sender.messages[1]?.code ?? "",
    };
    await expect(consume(phones, input)).resolves.toBeUndefined();
    await expect(consume(phones, input)).rejects.toMatchObject({ code: "VERIFICATION_INVALID" });
  });

  test("exhausts five attempts atomically before rejecting the correct code", async () => {
    const sender = new FakeVerificationCodeSender();
    const { phones } = service(sender);
    const challenge = await phones.start({
      phone: "+8613800138000",
      purpose: "register",
      serverIp: "127.0.0.1",
      requestId: "746fb70b-a27e-4a78-a231-aa55ef8c343e",
    });
    const base = {
      phone: "+8613800138000",
      purpose: "register" as const,
      challengeId: challenge.challengeId,
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(consume(phones, { ...base, code: "000000" })).rejects.toMatchObject({
        code: "VERIFICATION_INVALID",
      });
    }
    await expect(
      consume(phones, { ...base, code: sender.messages[0]?.code ?? "" }),
    ).rejects.toMatchObject({ code: "VERIFICATION_INVALID" });
  });

  test("rolls back challenge allocation when the sender fails", async () => {
    const { phones } = service(new RejectingSender());

    await expect(
      phones.start({
        phone: "+8613800138000",
        purpose: "register",
        serverIp: "127.0.0.1",
        requestId: "746fb70b-a27e-4a78-a231-aa55ef8c343e",
      }),
    ).rejects.toThrow("provider rejected fixture");

    const [count] = await sql<{ count: number }[]>`
      select count(*)::int as count from phone_verifications
    `;
    expect(count?.count).toBe(0);
  });

  test("stores only an HMAC and records purpose-aware rate dimensions", async () => {
    const sender = new FakeVerificationCodeSender();
    const { phones, limiter } = service(sender);
    await phones.start({
      phone: "13800138000",
      purpose: "register",
      serverIp: "203.0.113.7",
      requestId: "746fb70b-a27e-4a78-a231-aa55ef8c343e",
    });

    const [stored] = await sql<
      { phone_e164: string; code_hash: string; delivery_result: string }[]
    >`
      select phone_e164, code_hash, delivery_result from phone_verifications
    `;
    expect(stored).toMatchObject({
      phone_e164: "+8613800138000",
      delivery_result: "accepted",
    });
    expect(stored?.code_hash).not.toBe(sender.messages[0]?.code);
    expect(limiter.keys).toEqual(
      expect.arrayContaining([
        "verification:register:phone:+8613800138000",
        "verification:register:ip:203.0.113.7",
      ]),
    );
  });
});
