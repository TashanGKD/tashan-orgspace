import { generateKeyPair } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { ErrorEnvelope } from "@tashan/contracts";
import { FakeVerificationCodeSender } from "@tashan/testkit";

import { AccessTokenService } from "../../src/auth/access-token.js";
import { buildApp } from "../../src/app.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for API integration tests");
}

class AllowAllRateLimiter {
  public async consume(): Promise<boolean> {
    return true;
  }
}

let sql: DatabaseClient;
let tokenService: AccessTokenService;
let sender: FakeVerificationCodeSender;
let app: Awaited<ReturnType<typeof buildApp>>;
let idempotencySequence = 0;

beforeAll(async () => {
  await resetTestDatabase(testDatabaseUrl);
  await migrateDatabase(testDatabaseUrl);
  sql = createDatabaseClient(testDatabaseUrl);
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  tokenService = new AccessTokenService({
    issuer: "https://api-org.tashan.chat",
    audience: "tashan-orgspace",
    activeKeyId: "test-key-1",
    privateKey,
    publicKeys: new Map([["test-key-1", publicKey]]),
  });
});

beforeEach(async () => {
  await sql`truncate table audit_events, session_refresh_tokens, sessions, devices, memberships, organizations, phone_verifications, principals, accounts cascade`;
  sender = new FakeVerificationCodeSender();
  idempotencySequence = 0;
  app = await buildApp({
    sql,
    tokenService,
    phoneSender: sender,
    loginRateLimiter: new AllowAllRateLimiter(),
    phoneRateLimiter: new AllowAllRateLimiter(),
    phoneCodePepper: "test-only-phone-code-pepper",
    trustedProxyCidrs: ["10.0.0.0/8"],
    corsOrigins: ["https://org.tashan.chat"],
  });
});

afterAll(async () => {
  await app?.close();
  await sql?.end();
});

function nextIdempotencyKey(prefix = "test"): string {
  idempotencySequence += 1;
  return `${prefix}-${idempotencySequence}`;
}

function authHeaders(token: string, mutate = false): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "user-agent": "torg-test/0.0.0",
    "x-actor-source": "ai_via_cli",
    ...(mutate ? { "idempotency-key": nextIdempotencyKey() } : {}),
  };
}

const aliceDeviceA = {
  id: "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
  name: "Alice Mac A",
  os: "darwin",
  architecture: "arm64",
  clientVersion: "0.0.0-test",
  channel: "cli" as const,
};

const aliceDeviceB = {
  ...aliceDeviceA,
  id: "84ecfe2e-c11a-4a56-8735-934955bef834",
  name: "Alice Mac B",
};

async function register(username: string, password = "CorrectHorseBattery9") {
  return app.inject({
    method: "POST",
    url: "/v1/auth/register",
    headers: { "idempotency-key": nextIdempotencyKey("register") },
    payload: { username, password },
  });
}

async function login(
  username: string,
  device: typeof aliceDeviceA,
  password = "CorrectHorseBattery9",
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { username, password, device },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{
    account: { id: string };
    tokens: { accessToken: string; refreshToken: string };
  }>();
}

async function verifyPhone(token: string, phone: string) {
  const start = await app.inject({
    method: "POST",
    url: "/v1/phone-verifications",
    headers: authHeaders(token, true),
    payload: { phone },
  });
  expect(start.statusCode).toBe(202);
  const challengeId = start.json<{ challengeId: string }>().challengeId;
  const code = sender.messages.at(-1)?.code;
  if (code === undefined) throw new Error("fake sender did not receive verification code");
  const confirm = await app.inject({
    method: "POST",
    url: "/v1/phone-verifications/confirm",
    headers: authHeaders(token, true),
    payload: { challengeId, code },
  });
  expect(confirm.statusCode).toBe(200);
}

describe("Phase 0 HTTP capability surface", () => {
  test("returns the stable error envelope", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/auth/whoami" });
    expect(response.statusCode).toBe(401);
    expect(ErrorEnvelope.parse(response.json()).error).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  test("replays identical idempotent registration and rejects a changed authenticated mutation", async () => {
    const registrationKey = "stable-registration-key";
    const registrationRequest = {
      method: "POST" as const,
      url: "/v1/auth/register",
      headers: { "idempotency-key": registrationKey },
      payload: { username: "alice", password: "CorrectHorseBattery9" },
    };
    const first = await app.inject(registrationRequest);
    const replay = await app.inject(registrationRequest);
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    const [accountCount] = await sql<{ count: number }[]>`
      select count(*)::int as count from accounts where username = 'alice'
    `;
    expect(accountCount?.count).toBe(1);

    const alice = await login("alice", aliceDeviceA);
    await verifyPhone(alice.tokens.accessToken, "+8613800138001");
    const organizationKey = "stable-organization-key";
    const firstOrganization = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: {
        ...authHeaders(alice.tokens.accessToken),
        "idempotency-key": organizationKey,
      },
      payload: { name: "First name" },
    });
    expect(firstOrganization.statusCode).toBe(201);
    const conflict = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: {
        ...authHeaders(alice.tokens.accessToken),
        "idempotency-key": organizationKey,
      },
      payload: { name: "Changed name" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(ErrorEnvelope.parse(conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  test("rejects malformed IDs, missing idempotency keys, spoofed forwarding and duplicate users", async () => {
    const registration = await register("alice");
    expect(registration.statusCode).toBe(201);
    const duplicate = await register("ALICE", "AnotherStrongPassword9");
    expect(duplicate.statusCode).toBe(409);
    expect(ErrorEnvelope.parse(duplicate.json()).error.code).toBe("USERNAME_TAKEN");

    const alice = await login("alice", aliceDeviceA);
    const malformed = await app.inject({
      method: "DELETE",
      url: "/v1/devices/not-a-uuid",
      headers: authHeaders(alice.tokens.accessToken, true),
    });
    expect(malformed.statusCode).toBe(400);
    expect(ErrorEnvelope.parse(malformed.json()).error.code).toBe("VALIDATION_FAILED");

    const missingKey = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: authHeaders(alice.tokens.accessToken),
      payload: { name: "No key" },
    });
    expect(missingKey.statusCode).toBe(400);
    expect(ErrorEnvelope.parse(missingKey.json()).error.code).toBe("VALIDATION_FAILED");

    const spoofed = await app.inject({
      method: "GET",
      url: "/v1/health",
      remoteAddress: "203.0.113.7",
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    expect(spoofed.statusCode).toBe(200);
    const [auditRow] = await sql<{ server_ip: string; proxy_chain: string[] }[]>`
      select server_ip, proxy_chain from audit_events
      where capability_id = 'system.health.read'
      order by chain_position desc limit 1
    `;
    expect(auditRow).toEqual({ server_ip: "203.0.113.7", proxy_chain: [] });
  });

  test("exposes all 17 capabilities through real route payloads and audits each one", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/health" })).statusCode).toBe(200);
    const capabilities = await app.inject({ method: "GET", url: "/v1/capabilities" });
    expect(capabilities.statusCode).toBe(200);
    const capabilityItems = capabilities.json<{ items: { id: string }[] }>().items;
    expect(capabilityItems).toHaveLength(17);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/capabilities/${capabilityItems[0]?.id ?? "missing"}`,
        })
      ).statusCode,
    ).toBe(200);

    expect((await register("alice")).statusCode).toBe(201);
    const alice = await login("alice", aliceDeviceA);
    await verifyPhone(alice.tokens.accessToken, "+8613800138001");

    const refreshed = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken: alice.tokens.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const aliceTokens = refreshed.json<{ tokens: { accessToken: string; refreshToken: string } }>()
      .tokens;

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/auth/whoami",
          headers: authHeaders(aliceTokens.accessToken),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/devices",
          headers: authHeaders(aliceTokens.accessToken),
        })
      ).statusCode,
    ).toBe(200);

    const created = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: authHeaders(aliceTokens.accessToken, true),
      payload: { name: "Tashan" },
    });
    expect(created.statusCode).toBe(201);
    const organizationId = created.json<{ organization: { id: string } }>().organization.id;
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/organizations",
          headers: authHeaders(aliceTokens.accessToken),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/organizations/${organizationId}/members`,
          headers: authHeaders(aliceTokens.accessToken),
        })
      ).statusCode,
    ).toBe(200);

    expect((await register("bob")).statusCode).toBe(201);
    const bob = await login("bob", { ...aliceDeviceA, id: "9a99c012-a85b-46f1-966d-403637476921" });
    await verifyPhone(bob.tokens.accessToken, "+8613800138002");
    const addMember = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organizationId}/members`,
      headers: authHeaders(aliceTokens.accessToken, true),
      payload: { accountId: bob.account.id, role: "member" },
    });
    expect(addMember.statusCode).toBe(201);

    const auditList = await app.inject({
      method: "GET",
      url: `/v1/audit-events?organizationId=${organizationId}`,
      headers: authHeaders(aliceTokens.accessToken),
    });
    expect(auditList.statusCode).toBe(200);

    const aliceSecond = await login("alice", aliceDeviceB);
    const revoked = await app.inject({
      method: "DELETE",
      url: `/v1/devices/${aliceDeviceA.id}`,
      headers: authHeaders(aliceSecond.tokens.accessToken, true),
    });
    expect(revoked.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/auth/whoami",
          headers: authHeaders(aliceTokens.accessToken),
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/auth/whoami",
          headers: authHeaders(aliceSecond.tokens.accessToken),
        })
      ).statusCode,
    ).toBe(200);

    const logout = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: authHeaders(bob.tokens.accessToken),
      payload: { refreshToken: bob.tokens.refreshToken },
    });
    expect(logout.statusCode).toBe(200);

    const rows = await sql<{ capability_id: string }[]>`
      select distinct capability_id from audit_events
    `;
    expect(new Set(rows.map(({ capability_id: id }) => id))).toEqual(
      new Set(capabilityItems.map(({ id }) => id)),
    );
  });

  test("denies a valid user from another organization", async () => {
    await register("alice");
    const alice = await login("alice", aliceDeviceA);
    await verifyPhone(alice.tokens.accessToken, "+8613800138001");
    const aliceOrg = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: authHeaders(alice.tokens.accessToken, true),
      payload: { name: "Alice Org" },
    });
    const aliceOrgId = aliceOrg.json<{ organization: { id: string } }>().organization.id;

    await register("charlie");
    const charlie = await login("charlie", {
      ...aliceDeviceA,
      id: "316324ee-4571-47c1-9a55-d30fdce16c02",
    });
    await verifyPhone(charlie.tokens.accessToken, "+8613800138003");

    const response = await app.inject({
      method: "GET",
      url: `/v1/organizations/${aliceOrgId}/members`,
      headers: authHeaders(charlie.tokens.accessToken),
    });
    expect(response.statusCode).toBe(403);
    expect(ErrorEnvelope.parse(response.json()).error.code).toBe("ORG_FORBIDDEN");
    const requestId = response.headers["x-request-id"];
    if (typeof requestId !== "string") throw new Error("response request ID is missing");
    const [rejection] = await sql<
      { organization_id: string; account_id: string; result: string; error_code: string }[]
    >`
      select organization_id, account_id, result, error_code
      from audit_events
      where capability_id = 'organization.member.list'
        and request_id = ${requestId}
    `;
    expect(rejection).toEqual({
      organization_id: aliceOrgId,
      account_id: charlie.account.id,
      result: "rejected",
      error_code: "ORG_FORBIDDEN",
    });
  });
});
