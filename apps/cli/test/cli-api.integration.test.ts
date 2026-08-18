import { generateKeyPair } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createOrgSpaceClient, type SdkCredentialStore, type Transport } from "@tashan/sdk";
import { FakeVerificationCodeSender } from "@tashan/testkit";

import { buildApp } from "../../api/src/app.js";
import { AccessTokenService } from "../../api/src/auth/access-token.js";
import { createDatabaseClient, type DatabaseClient } from "../../api/src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../api/src/db/migrate.js";
import { MemoryCredentialStore } from "../src/credentials/memory-store.js";
import { runCli, type CliDependencies } from "../src/program.js";

class AllowAllRateLimiter {
  public async consume(): Promise<boolean> {
    return true;
  }
}

const baseDatabaseUrl = process.env.TEST_DATABASE_URL;
if (baseDatabaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for CLI integration tests");
}
const databaseUrlObject = new URL(baseDatabaseUrl);
databaseUrlObject.pathname = "/orgspace_cli_test";
const databaseUrl = databaseUrlObject.toString();

const aliceDeviceA = "35f503c2-a5d7-4250-a337-4f4fd03cf8df";
const aliceDeviceB = "84ecfe2e-c11a-4a56-8735-934955bef834";
const bobDevice = "b8880ea9-a7a5-42c3-bd2e-9272c8e9dd4a";
const password = "CorrectHorseBattery9";

let sql: DatabaseClient;
let sender: FakeVerificationCodeSender;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  await resetTestDatabase(databaseUrl);
  await migrateDatabase(databaseUrl);
  sql = createDatabaseClient(databaseUrl);
  sender = new FakeVerificationCodeSender();
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  const tokenService = new AccessTokenService({
    issuer: "https://api-org.tashan.chat",
    audience: "tashan-orgspace",
    activeKeyId: "cli-integration-key",
    privateKey,
    publicKeys: new Map([["cli-integration-key", publicKey]]),
  });
  app = await buildApp({
    sql,
    tokenService,
    phoneSender: sender,
    loginRateLimiter: new AllowAllRateLimiter(),
    phoneRateLimiter: new AllowAllRateLimiter(),
    phoneCodePepper: "cli-integration-phone-code-pepper",
    trustedProxyCidrs: [],
    corsOrigins: ["https://org.tashan.chat"],
  });
});

afterAll(async () => {
  await app?.close();
  await sql?.end();
});

function transportForApp(): Transport {
  return async (request) => {
    const response = await app.inject({
      method: request.method,
      url: request.path,
      headers: request.headers,
      ...(request.body === undefined ? {} : { payload: JSON.stringify(request.body) }),
    });
    return {
      status: response.statusCode,
      headers: new Headers(),
      body: response.body === "" ? null : response.json<unknown>(),
    };
  };
}

function cliDependencies(
  store: MemoryCredentialStore,
  deviceId: string,
  stdinValues: string[] = [],
): CliDependencies {
  return {
    credentialStore: store,
    deviceId,
    deviceMetadata: { name: `Test ${deviceId.slice(0, 8)}`, os: "test", architecture: "test" },
    environment: {},
    promptHidden: async () => password,
    readStdin: async () => {
      const value = stdinValues.shift();
      if (value === undefined) throw new Error("test stdin was exhausted");
      return value;
    },
    createClient: (credentials: SdkCredentialStore, currentDeviceId: string) =>
      createOrgSpaceClient({
        transport: transportForApp(),
        credentials,
        deviceId: currentDeviceId,
        clientChannel: "cli",
        invocationSource: "ai_via_cli",
      }),
  };
}

async function runJson(args: string[], dependencies: CliDependencies): Promise<unknown> {
  const result = await runCli([...args, "--json"], dependencies);
  expect(result, result.stderr).toMatchObject({ exitCode: 0, stderr: "" });
  expect(result.stdout.trim().split("\n")).toHaveLength(1);
  return JSON.parse(result.stdout) as unknown;
}

describe("CLI against the real Phase 0 API", () => {
  test("all capabilities work through CLI and device revocation is isolated", async () => {
    const aliceStoreA = new MemoryCredentialStore();
    const aliceStoreB = new MemoryCredentialStore();
    const bobStore = new MemoryCredentialStore();
    const aliceA = cliDependencies(aliceStoreA, aliceDeviceA);
    const aliceB = cliDependencies(aliceStoreB, aliceDeviceB);
    const bob = cliDependencies(bobStore, bobDevice);

    expect(await runJson(["health"], aliceA)).toMatchObject({ status: "ok" });
    const capabilities = (await runJson(["capability", "list"], aliceA)) as {
      items: { id: string }[];
    };
    expect(capabilities.items).toHaveLength(17);
    expect(await runJson(["capability", "describe", "device.revoke"], aliceA)).toMatchObject({
      id: "device.revoke",
      cli: "device revoke",
    });

    await runJson(
      ["auth", "register", "--username", "alice-cli", "--idempotency-key", "register-alice"],
      aliceA,
    );
    const bobRegistration = (await runJson(
      ["auth", "register", "--username", "bob-cli", "--idempotency-key", "register-bob"],
      bob,
    )) as { account: { id: string } };
    await runJson(["auth", "login", "--username", "alice-cli"], aliceA);
    await runJson(["auth", "login", "--username", "bob-cli"], bob);
    await runJson(["auth", "refresh"], aliceA);
    expect(await runJson(["auth", "whoami"], aliceA)).toMatchObject({
      account: { username: "alice-cli" },
      deviceId: aliceDeviceA,
    });

    const phoneStart = (await runJson(
      [
        "auth",
        "phone-start",
        "--phone",
        "+8613800138001",
        "--idempotency-key",
        "phone-start-alice",
      ],
      aliceA,
    )) as { challengeId: string };
    const code = sender.messages.at(-1)?.code;
    expect(code).toBeDefined();
    const aliceAWithCode = cliDependencies(aliceStoreA, aliceDeviceA, [code ?? ""]);
    await runJson(
      [
        "auth",
        "phone-confirm",
        "--challenge",
        phoneStart.challengeId,
        "--code-stdin",
        "--idempotency-key",
        "phone-confirm-alice",
      ],
      aliceAWithCode,
    );

    const bobPhoneStart = (await runJson(
      ["auth", "phone-start", "--phone", "+8613800138002", "--idempotency-key", "phone-start-bob"],
      bob,
    )) as { challengeId: string };
    const bobCode = sender.messages.at(-1)?.code;
    expect(bobCode).toBeDefined();
    await runJson(
      [
        "auth",
        "phone-confirm",
        "--challenge",
        bobPhoneStart.challengeId,
        "--code-stdin",
        "--idempotency-key",
        "phone-confirm-bob",
      ],
      cliDependencies(bobStore, bobDevice, [bobCode ?? ""]),
    );

    const team = (await runJson(
      ["org", "create", "--name", "CLI Team", "--yes", "--idempotency-key", "org-team"],
      aliceA,
    )) as { organization: { id: string } };
    const privateOrg = (await runJson(
      ["org", "create", "--name", "Private Team", "--yes", "--idempotency-key", "org-private"],
      aliceA,
    )) as { organization: { id: string } };
    const organizations = (await runJson(["org", "list"], aliceA)) as {
      items: { id: string }[];
    };
    expect(organizations.items).toHaveLength(2);
    await runJson(
      [
        "org",
        "member",
        "add",
        "--org",
        team.organization.id,
        "--account",
        bobRegistration.account.id,
        "--role",
        "member",
        "--yes",
        "--idempotency-key",
        "add-bob",
      ],
      aliceA,
    );
    const members = (await runJson(
      ["org", "member", "list", "--org", team.organization.id],
      bob,
    )) as { items: { username: string }[] };
    expect(members.items.map((member) => member.username).sort()).toEqual(["alice-cli", "bob-cli"]);
    const audit = (await runJson(["audit", "list", "--org", team.organization.id], bob)) as {
      items: { capabilityId: string }[];
    };
    expect(audit.items.some((event) => event.capabilityId === "organization.member.add")).toBe(
      true,
    );

    const forbidden = await runCli(
      ["audit", "list", "--org", privateOrg.organization.id, "--json"],
      bob,
    );
    expect(forbidden.exitCode).toBe(4);
    expect(forbidden.stderr).toContain("ORG_FORBIDDEN");

    await runJson(["auth", "login", "--username", "alice-cli"], aliceB);
    const devices = (await runJson(["device", "list"], aliceB)) as {
      items: { id: string }[];
    };
    expect(devices.items.map((device) => device.id)).toEqual(
      expect.arrayContaining([aliceDeviceA, aliceDeviceB]),
    );
    await runJson(
      ["device", "revoke", aliceDeviceA, "--yes", "--idempotency-key", "revoke-alice-a"],
      aliceB,
    );
    const revokedDevice = await runCli(["auth", "whoami", "--json"], aliceA);
    expect(revokedDevice.exitCode).toBe(3);
    expect(revokedDevice.stderr).toContain("AUTH_TOKEN_REVOKED");
    expect(await runJson(["auth", "whoami"], aliceB)).toMatchObject({
      deviceId: aliceDeviceB,
    });

    await runJson(["auth", "logout", "--yes"], aliceB);
    const loggedOut = await runCli(["auth", "whoami", "--json"], aliceB);
    expect(loggedOut.exitCode).toBe(3);
    expect(loggedOut.stderr).toContain("AUTH_REQUIRED");
  });
});
