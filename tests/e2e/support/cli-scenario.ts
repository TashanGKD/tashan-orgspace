import { createFetchTransport, createOrgSpaceClient, type SdkCredentialStore } from "@tashan/sdk";

import { MemoryCredentialStore } from "../../../apps/cli/src/credentials/memory-store.js";
import { runCli, type CliDependencies } from "../../../apps/cli/src/program.js";

interface ScenarioInput {
  type: "lifecycle" | "cross-org" | "audit" | "files";
  apiUrl: string;
  alice: { phone: string; password: string };
  bob?: { accountId: string; phone: string; password: string };
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

async function login(effects: CliDependencies, phone: string): Promise<void> {
  await command(["auth", "login", "--phone", phone], effects);
}

const aliceStoreA = new MemoryCredentialStore();
const aliceStoreB = new MemoryCredentialStore();
const aliceDeviceA = crypto.randomUUID();
const aliceDeviceB = crypto.randomUUID();
const aliceA = dependencies(aliceStoreA, aliceDeviceA, input.alice.password, "Alice Mac E2E");
const aliceB = dependencies(aliceStoreB, aliceDeviceB, input.alice.password, "Alice Linux E2E");
await login(aliceA, input.alice.phone);

if (input.type === "lifecycle") {
  if (input.bob === undefined) throw new Error("lifecycle requires Bob");
  await login(aliceB, input.alice.phone);
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
  const surviving = await command<{ account: { displayName: string }; deviceId: string }>(
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
  await login(bob, input.bob.phone);
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
} else if (input.type === "files") {
  const spaces = await command<{ items: Array<{ id: string; rootFolderId: string }> }>(
    ["space", "list"],
    aliceA,
  );
  const personal = spaces.items[0];
  if (personal === undefined) throw new Error("personal space is missing");
  const directory = await mkdtemp(join(tmpdir(), "torg-files-e2e-"));
  try {
    const source = join(directory, "source.txt");
    const destination = join(directory, "downloaded.txt");
    await writeFile(source, "real MinIO bytes\n");
    await command(
      [
        "file",
        "upload",
        source,
        "--space",
        personal.id,
        "--parent",
        personal.rootFolderId,
        "--content-type",
        "text/plain",
        "--idempotency-key",
        "files-upload",
      ],
      aliceA,
    );

    let entry:
      | { id: string; name: string; lockVersion: number; currentVersionId: string | null }
      | undefined;
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const listing = await command<{
        items: Array<{
          id: string;
          name: string;
          lockVersion: number;
          currentVersionId: string | null;
        }>;
      }>(["file", "list", "--space", personal.id, "--parent", personal.rootFolderId], aliceA);
      entry = listing.items.find(
        (candidate) => candidate.name === "source.txt" && candidate.currentVersionId !== null,
      );
      if (entry !== undefined) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (entry === undefined) throw new Error("uploaded file did not become available");

    const versions = await command<{ items: unknown[] }>(
      ["file", "versions", "--space", personal.id, "--file", entry.id],
      aliceA,
    );
    await command(
      [
        "file",
        "download",
        "--space",
        personal.id,
        "--file",
        entry.id,
        "--output",
        destination,
        "--idempotency-key",
        "files-download",
      ],
      aliceA,
    );
    await command(
      [
        "file",
        "trash",
        "--space",
        personal.id,
        "--file",
        entry.id,
        "--yes",
        "--idempotency-key",
        "files-trash-1",
      ],
      aliceA,
    );
    const trashed = await command<{ entry: { lockVersion: number } }>(
      ["file", "get", "--space", personal.id, "--file", entry.id],
      aliceA,
    );
    const restored = await command<{ entry: { name: string } }>(
      [
        "file",
        "restore",
        "--space",
        personal.id,
        "--file",
        entry.id,
        "--expected-version",
        String(trashed.entry.lockVersion),
        "--idempotency-key",
        "files-restore",
      ],
      aliceA,
    );
    await command(
      [
        "file",
        "trash",
        "--space",
        personal.id,
        "--file",
        entry.id,
        "--yes",
        "--idempotency-key",
        "files-trash-2",
      ],
      aliceA,
    );
    const deleted = await command<{ queued: boolean }>(
      [
        "file",
        "delete",
        "--space",
        personal.id,
        "--file",
        entry.id,
        "--yes",
        "--idempotency-key",
        "files-delete",
      ],
      aliceA,
    );
    process.stdout.write(
      JSON.stringify({
        downloadedText: await readFile(destination, "utf8"),
        versions: versions.items.length,
        restoredName: restored.entry.name,
        deleteQueued: deleted.queued,
      }),
    );
  } finally {
    await rm(directory, { recursive: true });
  }
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
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
