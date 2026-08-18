import { createFetchTransport, createOrgSpaceClient, type SdkCredentialStore } from "@tashan/sdk";

import { MemoryCredentialStore } from "../../../apps/cli/src/credentials/memory-store.js";
import { runCli, type CliDependencies } from "../../../apps/cli/src/program.js";

interface ScenarioInput {
  type: "lifecycle" | "cross-org" | "audit";
  apiUrl: string;
  alice: { username: string; password: string };
  bob?: { accountId: string; username: string; password: string };
}

let serializedInput = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) serializedInput += chunk;
const input = JSON.parse(serializedInput) as ScenarioInput;
const apiHost = new URL(input.apiUrl).hostname.toLowerCase();
if (!["127.0.0.1", "localhost", "[::1]"].includes(apiHost)) {
  throw new Error("CLI E2E API URL must use loopback");
}

function dependencies(
  store: MemoryCredentialStore,
  deviceId: string,
  password: string,
  name: string,
): CliDependencies {
  return {
    credentialStore: store,
    deviceId,
    deviceMetadata: { name, os: "e2e-os", architecture: "e2e-arch" },
    environment: { TORG_API_URL: input.apiUrl },
    promptHidden: async () => password,
    readStdin: async () => password,
    createClient: (credentials: SdkCredentialStore, currentDeviceId: string) =>
      createOrgSpaceClient({
        transport: createFetchTransport({ baseUrl: input.apiUrl, timeoutMilliseconds: 5_000 }),
        credentials,
        deviceId: currentDeviceId,
        clientChannel: "cli",
        invocationSource: "ai_via_cli",
      }),
  };
}

async function command<T>(args: string[], effects: CliDependencies): Promise<T> {
  const result = await runCli([...args, "--json"], effects);
  if (result.exitCode !== 0) {
    throw new Error(`${args.join(" ")} failed (${result.exitCode}): ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as T;
}

async function rejected(args: string[], effects: CliDependencies) {
  const result = await runCli([...args, "--json"], effects);
  return { exitCode: result.exitCode, stderr: result.stderr };
}

async function login(effects: CliDependencies, username: string): Promise<void> {
  await command(["auth", "login", "--username", username], effects);
}

const aliceStoreA = new MemoryCredentialStore();
const aliceStoreB = new MemoryCredentialStore();
const aliceDeviceA = crypto.randomUUID();
const aliceDeviceB = crypto.randomUUID();
const aliceA = dependencies(aliceStoreA, aliceDeviceA, input.alice.password, "Alice Mac E2E");
const aliceB = dependencies(aliceStoreB, aliceDeviceB, input.alice.password, "Alice Linux E2E");
await login(aliceA, input.alice.username);

if (input.type === "lifecycle") {
  if (input.bob === undefined) throw new Error("lifecycle requires Bob");
  await login(aliceB, input.alice.username);
  const organization = await command<{ organization: { id: string } }>(
    ["org", "create", "--name", "Lifecycle Org", "--yes", "--idempotency-key", "life-org"],
    aliceA,
  );
  await command(
    [
      "org",
      "member",
      "add",
      "--org",
      organization.organization.id,
      "--account",
      input.bob.accountId,
      "--role",
      "member",
      "--yes",
      "--idempotency-key",
      "life-member",
    ],
    aliceA,
  );
  await command(
    ["device", "revoke", aliceDeviceA, "--yes", "--idempotency-key", "life-revoke"],
    aliceB,
  );
  const revoked = await rejected(["auth", "whoami"], aliceA);
  const surviving = await command<{ account: { username: string }; deviceId: string }>(
    ["auth", "whoami"],
    aliceB,
  );
  const organizationAudit = await command<{ items: { capabilityId: string }[] }>(
    ["audit", "list", "--org", organization.organization.id],
    aliceB,
  );
  process.stdout.write(
    JSON.stringify({
      organizationId: organization.organization.id,
      aliceDeviceA,
      aliceDeviceB,
      revoked,
      surviving,
      organizationAudit: organizationAudit.items,
    }),
  );
} else if (input.type === "cross-org") {
  if (input.bob === undefined) throw new Error("cross-org requires Bob");
  const bobStore = new MemoryCredentialStore();
  const bob = dependencies(bobStore, crypto.randomUUID(), input.bob.password, "Bob E2E Device");
  await login(bob, input.bob.username);
  const aliceOrg = await command<{ organization: { id: string } }>(
    ["org", "create", "--name", "Alice Private", "--yes", "--idempotency-key", "cross-a"],
    aliceA,
  );
  const bobOrg = await command<{ organization: { id: string } }>(
    ["org", "create", "--name", "Bob Private", "--yes", "--idempotency-key", "cross-b"],
    bob,
  );
  process.stdout.write(
    JSON.stringify({
      aliceOrganizationId: aliceOrg.organization.id,
      bobOrganizationId: bobOrg.organization.id,
      bobReadsAliceMembers: await rejected(
        ["org", "member", "list", "--org", aliceOrg.organization.id],
        bob,
      ),
      bobReadsAliceAudit: await rejected(["audit", "list", "--org", aliceOrg.organization.id], bob),
      aliceReadsBobMembers: await rejected(
        ["org", "member", "list", "--org", bobOrg.organization.id],
        aliceA,
      ),
    }),
  );
} else {
  const organization = await command<{ organization: { id: string } }>(
    ["org", "create", "--name", "Audit Evidence", "--yes", "--idempotency-key", "audit-org"],
    aliceA,
  );
  const audit = await command<{ items: unknown[] }>(
    ["audit", "list", "--org", organization.organization.id],
    aliceA,
  );
  process.stdout.write(
    JSON.stringify({
      organizationId: organization.organization.id,
      aliceDeviceA,
      events: audit.items,
    }),
  );
}
