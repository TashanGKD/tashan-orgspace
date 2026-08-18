import { generateKeyPair } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { AccessTokenService } from "../../src/auth/access-token.js";
import { AuthService, type LoginRateLimiter } from "../../src/auth/auth-service.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for auth integration tests");
}

class RecordingRateLimiter implements LoginRateLimiter {
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
let auth: AuthService;

beforeAll(async () => {
  await resetTestDatabase(testDatabaseUrl);
  await migrateDatabase(testDatabaseUrl);
  sql = createDatabaseClient(testDatabaseUrl);
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
  auth = new AuthService({ sql, tokenService: tokens, rateLimiter: limiter });
});

afterAll(async () => {
  await sql?.end();
});

const deviceA = {
  id: "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
  name: "Alice Mac",
  os: "darwin",
  architecture: "arm64",
  clientVersion: "0.1.0",
  channel: "cli" as const,
};

async function registerAlice() {
  return auth.register({ username: "Alice", password: "CorrectHorseBattery9" });
}

async function loginAlice() {
  return auth.login(
    { username: "alice", password: "CorrectHorseBattery9", device: deviceA },
    { serverIp: "127.0.0.1" },
  );
}

describe("registration and credential privacy", () => {
  test("case-insensitive duplicate registration creates one human Principal and no Membership", async () => {
    await registerAlice();
    await expect(
      auth.register({ username: "alice", password: "AnotherStrongPassword9" }),
    ).rejects.toMatchObject({ code: "USERNAME_TAKEN" });

    const [counts] = await sql<{ accounts: number; principals: number; memberships: number }[]>`
      select
        (select count(*)::int from accounts) as accounts,
        (select count(*)::int from principals where type = 'human') as principals,
        (select count(*)::int from memberships) as memberships
    `;
    expect(counts).toEqual({ accounts: 1, principals: 1, memberships: 0 });
  });

  test("wrong username and wrong password expose the same public error", async () => {
    await registerAlice();
    const attempts = [
      { username: "missing", password: "CorrectHorseBattery9", device: deviceA },
      { username: "alice", password: "IncorrectPassword9", device: deviceA },
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
    expect(limiter.keys).toContain("login:username:alice");
    expect(limiter.keys).toContain("login:ip:203.0.113.7");
  });

  test("rate limiter rejects before password verification", async () => {
    await registerAlice();
    limiter.allow = false;

    await expect(loginAlice()).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("device-bound session and refresh rotation", () => {
  test("rejects an expired access token", async () => {
    await registerAlice();
    const session = await loginAlice();
    const expired = await tokens.sign(
      {
        subject: session.accountId,
        principalId: session.principalId,
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        tokenVersion: session.tokenVersion,
        actorSource: "cli",
      },
      { lifetimeSeconds: -1 },
    );

    await expect(auth.authenticate(expired)).rejects.toMatchObject({ code: "AUTH_TOKEN_EXPIRED" });
  });

  test("rejects revoked devices and old token versions", async () => {
    await registerAlice();
    const first = await loginAlice();
    await sql`update devices set revoked_at = now() where id = ${first.deviceId}`;
    await expect(auth.authenticate(first.accessToken)).rejects.toMatchObject({
      code: "DEVICE_REVOKED",
    });

    await sql`update devices set revoked_at = null where id = ${first.deviceId}`;
    await sql`update sessions set token_version = token_version + 1 where id = ${first.sessionId}`;
    await expect(auth.authenticate(first.accessToken)).rejects.toMatchObject({
      code: "AUTH_TOKEN_REVOKED",
    });
  });

  test("refresh-token reuse revokes the entire session", async () => {
    await registerAlice();
    const first = await loginAlice();
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
    await registerAlice();
    const first = await loginAlice();
    const results = await Promise.allSettled([
      auth.refresh(first.refreshToken),
      auth.refresh(first.refreshToken),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
  });
});
