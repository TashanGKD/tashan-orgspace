import { randomUUID } from "node:crypto";

import { FakeVerificationCodeSender } from "@tashan/testkit";
import { generateKeyPair } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { AccessTokenService } from "../../src/auth/access-token.js";
import { AuthService, type LoginRateLimiter } from "../../src/auth/auth-service.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import {
  PhoneVerificationService,
  type PhoneRateLimiter,
} from "../../src/phone/phone-verification-service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for auth integration tests");
}
const requiredTestDatabaseUrl: string = testDatabaseUrl;

class RecordingRateLimiter implements LoginRateLimiter, PhoneRateLimiter {
  public readonly keys: string[] = [];
  public allow = true;

  public async consume(key: string): Promise<boolean> {
    this.keys.push(key);
    return this.allow;
  }
}

let sql: DatabaseClient;
let tokens: AccessTokenService;
let limiter: RecordingRateLimiter;
let sender: FakeVerificationCodeSender;
let phones: PhoneVerificationService;
let auth: AuthService;

beforeAll(async () => {
  await resetTestDatabase(requiredTestDatabaseUrl);
  await migrateDatabase(requiredTestDatabaseUrl);
  sql = createDatabaseClient(requiredTestDatabaseUrl);
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  tokens = new AccessTokenService({
    issuer: "https://api-org.tashan.chat",
    audience: "tashan-orgspace",
    activeKeyId: "test-key-1",
    privateKey,
    publicKeys: new Map([["test-key-1", publicKey]]),
  });
}, 30_000);

beforeEach(async () => {
  await sql`truncate table audit_events, session_refresh_tokens, sessions, devices, memberships, organizations, phone_verifications, principals, accounts cascade`;
  limiter = new RecordingRateLimiter();
  sender = new FakeVerificationCodeSender();
  phones = new PhoneVerificationService({
    sql,
    sender,
    rateLimiter: limiter,
    codePepper: "test-only-pepper",
  });
  auth = new AuthService({ sql, tokenService: tokens, rateLimiter: limiter, phones });
});

afterAll(async () => {
  await sql?.end();
});

const phone = "+8613800138000";
const password = "CorrectHorseBattery9";
const nextPassword = "AnotherStrongPassword9";
const deviceA = {
  id: "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
  name: "Alice Mac",
  os: "darwin",
  architecture: "arm64",
  clientVersion: "0.1.0",
  channel: "cli" as const,
};
const deviceB = {
  ...deviceA,
  id: "84ecfe2e-c11a-4a56-8735-934955bef834",
  name: "Alice Linux",
  os: "linux",
};

async function challenge(purpose: "register" | "password_reset", targetPhone = phone) {
  const created = await phones.start({
    phone: targetPhone,
    purpose,
    serverIp: "127.0.0.1",
    requestId: randomUUID(),
  });
  const code = sender.messages.at(-1)?.code;
  if (code === undefined) throw new Error("fake sender did not receive a code");
  return { ...created, code };
}

async function registerAlice(device = deviceA) {
  const verification = await challenge("register");
  return auth.register({
    phone,
    challengeId: verification.challengeId,
    code: verification.code,
    password,
    device,
  });
}

async function loginAlice(device = deviceA, presentedPassword = password) {
  return auth.login({ phone, password: presentedPassword, device }, { serverIp: "127.0.0.1" });
}

describe("phone registration and credential privacy", () => {
  test("registration consumes a challenge, creates one identity, and auto-logs in", async () => {
    const session = await registerAlice();

    await expect(auth.authenticate(session.accessToken)).resolves.toMatchObject({
      accountId: session.accountId,
      deviceId: deviceA.id,
    });
    const [account] = await sql<
      { phone_e164: string; display_name: string; phone_verified_at: Date }[]
    >`
      select phone_e164, display_name, phone_verified_at from accounts
    `;
    expect(account).toMatchObject({ phone_e164: phone, display_name: "用户8000" });
    expect(account?.phone_verified_at).toBeInstanceOf(Date);
  });

  test("two concurrent registrations for one phone create exactly one account", async () => {
    const first = await challenge("register");
    const second = await challenge("register");
    const results = await Promise.allSettled([
      auth.register({
        phone,
        challengeId: first.challengeId,
        code: first.code,
        password,
        device: deviceA,
      }),
      auth.register({
        phone,
        challengeId: second.challengeId,
        code: second.code,
        password,
        device: deviceB,
      }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "ACCOUNT_EXISTS" } });
    const [count] = await sql<{ count: number }[]>`select count(*)::int as count from accounts`;
    expect(count?.count).toBe(1);
  });

  test("unknown phone and wrong password expose the same public error", async () => {
    await registerAlice();
    const attempts = [
      { phone: "+8613900139000", password, device: deviceA },
      { phone, password: "IncorrectPassword9", device: deviceA },
    ];
    const errors = [];
    for (const attempt of attempts) {
      try {
        await auth.login(attempt, { serverIp: "203.0.113.7" });
      } catch (error) {
        errors.push(error);
      }
    }

    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    expect(errors[1]).toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    expect((errors[0] as Error).message).toBe((errors[1] as Error).message);
    expect(limiter.keys).toContain(`login:phone:${phone}`);
    expect(limiter.keys).toContain("login:ip:203.0.113.7");
  });
});

describe("password reset and device-bound sessions", () => {
  test("password reset revokes every old session but preserves reusable devices", async () => {
    const first = await registerAlice(deviceA);
    const second = await loginAlice(deviceB);
    const verification = await challenge("password_reset");

    await auth.resetPassword({
      phone,
      challengeId: verification.challengeId,
      code: verification.code,
      newPassword: nextPassword,
    });

    await expect(auth.authenticate(first.accessToken)).rejects.toMatchObject({
      code: "AUTH_TOKEN_REVOKED",
    });
    await expect(auth.authenticate(second.accessToken)).rejects.toMatchObject({
      code: "AUTH_TOKEN_REVOKED",
    });
    await expect(auth.refresh(first.refreshToken)).rejects.toMatchObject({
      code: "AUTH_TOKEN_REVOKED",
    });
    await expect(loginAlice(deviceA, password)).rejects.toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
    });
    await expect(loginAlice(deviceA, nextPassword)).resolves.toMatchObject({
      deviceId: deviceA.id,
    });
  });

  test("refresh-token reuse still revokes the entire session", async () => {
    const first = await registerAlice();
    const second = await auth.refresh(first.refreshToken);
    await expect(auth.authenticate(second.accessToken)).resolves.toMatchObject({
      deviceId: deviceA.id,
    });

    await expect(auth.refresh(first.refreshToken)).rejects.toMatchObject({
      code: "AUTH_TOKEN_REVOKED",
    });
    await expect(auth.authenticate(second.accessToken)).rejects.toMatchObject({
      code: "AUTH_TOKEN_REVOKED",
    });
  });

  test("allows exactly one concurrent refresh compare-and-swap", async () => {
    const first = await registerAlice();
    const results = await Promise.allSettled([
      auth.refresh(first.refreshToken),
      auth.refresh(first.refreshToken),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
  });
});
