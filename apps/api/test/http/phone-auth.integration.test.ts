import { randomUUID } from "node:crypto";

import { FakeVerificationCodeSender } from "@tashan/testkit";
import { generateKeyPair } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { AccessTokenService } from "../../src/auth/access-token.js";
import { buildApp } from "../../src/app.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for phone auth HTTP tests");
}
const requiredTestDatabaseUrl: string = testDatabaseUrl;

class AllowAllRateLimiter {
  public async consume(): Promise<boolean> {
    return true;
  }
}

let sql: DatabaseClient;
let sender: FakeVerificationCodeSender;
let app: Awaited<ReturnType<typeof buildApp>>;

const webDevice = {
  id: "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
  name: "Web browser",
  os: "darwin",
  architecture: "arm64",
  clientVersion: "0.0.0-test",
  channel: "web" as const,
};

beforeAll(async () => {
  await resetTestDatabase(requiredTestDatabaseUrl);
  await migrateDatabase(requiredTestDatabaseUrl);
  sql = createDatabaseClient(requiredTestDatabaseUrl);
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  const tokenService = new AccessTokenService({
    issuer: "https://api-org.tashan.chat",
    audience: "tashan-orgspace",
    activeKeyId: "test-key-1",
    privateKey,
    publicKeys: new Map([["test-key-1", publicKey]]),
  });
  sender = new FakeVerificationCodeSender();
  app = await buildApp({
    sql,
    tokenService,
    serviceVersion: "0.1.0-alpha.2-test",
    phoneSender: sender,
    loginRateLimiter: new AllowAllRateLimiter(),
    phoneRateLimiter: new AllowAllRateLimiter(),
    phoneCodePepper: "test-only-phone-code-pepper",
    trustedProxyCidrs: [],
    corsOrigins: ["https://org.tashan.chat"],
  });
}, 30_000);

beforeEach(async () => {
  sender.messages.length = 0;
  await sql`truncate table audit_events, session_refresh_tokens, sessions, devices, memberships, organizations, phone_verifications, principals, accounts cascade`;
});

afterAll(async () => {
  await app?.close();
  await sql?.end();
});

async function verification(purpose: "register" | "password_reset") {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/verification/send",
    headers: { "idempotency-key": randomUUID() },
    payload: { phone: "13800138000", purpose },
  });
  expect(response.statusCode).toBe(202);
  const code = sender.messages.at(-1)?.code;
  if (code === undefined) throw new Error("fake sender did not receive a code");
  return { challengeId: response.json<{ challengeId: string }>().challengeId, code };
}

async function registerWeb() {
  const challenge = await verification("register");
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    headers: { "idempotency-key": randomUUID() },
    payload: {
      phone: "13800138000",
      challengeId: challenge.challengeId,
      code: challenge.code,
      password: "CorrectHorseBattery9",
      device: webDevice,
    },
  });
  expect(response.statusCode).toBe(201);
  return response;
}

describe("phone auth HTTP lifecycle", () => {
  test("anonymous registration auto-logs in and sets a secure Web refresh cookie", async () => {
    const response = await registerWeb();
    expect(response.json()).toMatchObject({
      account: { displayName: "用户8000", phone: "+8613800138000" },
      deviceId: webDevice.id,
      tokens: { tokenType: "Bearer" },
    });
    expect(response.headers["set-cookie"]).toContain("__Host-torg_refresh=");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("Secure");
    expect(response.headers["set-cookie"]).toContain("SameSite=Strict");
    const accountId = response.json<{ account: { id: string } }>().account.id;
    const [space] = await sql<{ type: string; quota_bytes: string; root_kind: string }[]>`
      select s.type, s.quota_bytes, root.kind as root_kind
      from spaces s join file_entries root on root.id = s.root_folder_id
      where s.account_id = ${accountId}
    `;
    expect(space).toEqual({ type: "personal", quota_bytes: "53687091200", root_kind: "folder" });
  });

  test("password reset clears the Web cookie and rejects every old session", async () => {
    const registration = await registerWeb();
    const accessToken = registration.json<{ tokens: { accessToken: string } }>().tokens.accessToken;
    const resetChallenge = await verification("password_reset");
    const reset = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      headers: {
        "idempotency-key": randomUUID(),
        cookie: String(registration.headers["set-cookie"]).split(";")[0] ?? "",
      },
      payload: {
        phone: "+8613800138000",
        challengeId: resetChallenge.challengeId,
        code: resetChallenge.code,
        newPassword: "AnotherStrongPassword9",
      },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({ reset: true });
    expect(reset.headers["set-cookie"]).toContain("__Host-torg_refresh=;");

    const oldSession = await app.inject({
      method: "GET",
      url: "/v1/auth/whoami",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(oldSession.statusCode).toBe(401);

    const [auditText] = await sql<{ body: string }[]>`
      select coalesce(jsonb_agg(to_jsonb(audit_events)), '[]'::jsonb)::text as body
      from audit_events
    `;
    expect(auditText?.body).not.toContain(resetChallenge.code);
    expect(auditText?.body).not.toContain("AnotherStrongPassword9");
    expect(auditText?.body).not.toContain(accessToken);
  });
});
