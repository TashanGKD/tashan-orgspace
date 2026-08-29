import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

import { createFetchTransport, createOrgSpaceClient, type SdkCredentialStore } from "@tashan/sdk";
import { createNodeFileByteTransport } from "@tashan/sdk/file-transfer";
import {
  createInternalS3Client,
  createPresignS3Client,
  parseObjectStoreConfig,
  S3FileDataStore,
  S3FileMaintenanceStore,
} from "@tashan/object-store";

import { MemoryCredentialStore } from "../../../apps/cli/src/credentials/memory-store.js";
import { CliSessionCredentials } from "../../../apps/cli/src/credentials/session-credentials.js";
import { runCli, type CliDependencies } from "../../../apps/cli/src/program.js";

interface ScenarioInput {
  type:
    | "lifecycle"
    | "cross-org"
    | "audit"
    | "files"
    | "files-authorization"
    | "files-recovery"
    | "work-okr"
    | "partners"
    | "notifications"
    | "chat-search";
  apiUrl: string;
  databaseUrl: string;
  alice: { accountId: string; phone: string; password: string };
  bob?: { accountId: string; phone: string; password: string };
  charlie?: { accountId: string; phone: string; password: string };
  diana?: { accountId: string; phone: string; password: string };
}

let serializedInput = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) serializedInput += chunk;
const input = JSON.parse(serializedInput) as ScenarioInput;
const apiHost = new URL(input.apiUrl).hostname.toLowerCase();
if (!["127.0.0.1", "localhost", "[::1]"].includes(apiHost)) {
  throw new Error("CLI E2E API URL must use loopback");
}
const databaseHost = new URL(input.databaseUrl).hostname.toLowerCase();
if (!["127.0.0.1", "localhost", "[::1]"].includes(databaseHost)) {
  throw new Error("CLI E2E database URL must use loopback");
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
    environment: {
      TORG_API_URL: input.apiUrl,
      ...(process.env.E2E_REALTIME_URL ? { TORG_REALTIME_URL: process.env.E2E_REALTIME_URL } : {}),
    },
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

async function runProcess(binary: string, args: string[]): Promise<void> {
  const child = spawn(binary, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (exitCode !== 0) throw new Error(`${binary} failed (${exitCode}): ${stderr}`);
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
} else if (input.type === "partners") {
  if (!input.bob || !input.charlie || !input.diana)
    throw new Error("partners requires three members");
  const makeMember = async (person: { phone: string; password: string }, name: string) => {
    const store = new MemoryCredentialStore();
    const effect = dependencies(store, crypto.randomUUID(), person.password, name);
    await login(effect, person.phone);
    return effect;
  };
  const bob = await makeMember(input.bob, "Bob Partner E2E");
  const charlie = await makeMember(input.charlie, "Charlie Partner E2E");
  const diana = await makeMember(input.diana, "Diana Partner E2E");
  const org = await command<{ organization: { id: string } }>(
    ["org", "create", "--name", "Partner E2E Org", "--yes", "--idempotency-key", "partner-org"],
    aliceA,
  );
  for (const [index, person] of [input.bob, input.charlie, input.diana].entries()) {
    await command(
      [
        "org",
        "member",
        "add",
        "--org",
        org.organization.id,
        "--account",
        person.accountId,
        "--role",
        "member",
        "--yes",
        "--idempotency-key",
        `partner-member-${index}`,
      ],
      aliceA,
    );
  }
  const create = (effect: CliDependencies, name: string, phone: string, key: string) =>
    command<{ partner: { id: string; version: number } }>(
      [
        "partner",
        "create",
        "--org",
        org.organization.id,
        "--data",
        JSON.stringify({ name, phone, cooperationStage: "lead", tags: [] }),
        "--yes",
        "--idempotency-key",
        key,
      ],
      effect,
    );
  const bobPartner = await create(bob, "Bob 联系人", "13812345678", "partner-bob");
  const charliePartner = await create(charlie, "Charlie 联系人", "13812345678", "partner-charlie");
  await create(diana, "Diana 联系人", "13900000001", "partner-diana");
  const bobList = await command<{ items: unknown[] }>(
    ["partner", "list", "--org", org.organization.id],
    bob,
  );
  const inferred = await rejected(
    ["partner", "get", "--org", org.organization.id, "--partner", bobPartner.partner.id],
    charlie,
  );
  const all = await command<{ items: unknown[] }>(
    ["partner", "list", "--org", org.organization.id, "--owner", "all", "--admin-scope"],
    aliceA,
  );
  const duplicate = await command<{ groups: unknown[] }>(
    ["partner", "duplicates", "--org", org.organization.id],
    aliceA,
  );
  const interaction = await command<{ interaction: { followUpWorkItemId: string | null } }>(
    [
      "partner",
      "interaction",
      "add",
      "--org",
      org.organization.id,
      "--partner",
      charliePartner.partner.id,
      "--data",
      JSON.stringify({
        contactedAt: "2026-08-29T08:00:00.000Z",
        channel: "wechat",
        summary: "发送资料",
        requiresFollowUp: true,
        followUp: { type: "task", title: "发送合作资料" },
        links: [],
      }),
      "--yes",
      "--idempotency-key",
      "partner-interaction",
    ],
    charlie,
  );
  const { createDatabaseClient } = await import("../../../apps/api/src/db/client.js");
  const db = createDatabaseClient(input.databaseUrl);
  let plaintextRows: number | undefined;
  try {
    await db`update memberships set status='removed',removed_at=now() where organization_id=${org.organization.id} and account_id=${input.bob.accountId}`;
    const { PartnerService } = await import("../../../apps/api/src/partners/partner-service.js");
    const { SensitiveFieldCipher } =
      await import("../../../apps/api/src/security/sensitive-field-cipher.js");
    const { BlindIndex } = await import("../../../apps/api/src/security/blind-index.js");
    const service = new PartnerService({
      cipher: new SensitiveFieldCipher({
        activeVersion: 1,
        keys: new Map([[1, Buffer.alloc(32, 1)]]),
      }),
      blindIndex: new BlindIndex(Buffer.alloc(32, 2)),
    });
    await db.begin((tx) => service.reconcileRemovedOwners(tx, org.organization.id));
    const [scan] = await db<
      { count: number }[]
    >`select count(*)::int count from partners where phone_cipher::text like '%13812345678%'`;
    plaintextRows = scan?.count ?? -1;
  } finally {
    await db.end();
  }
  const awaiting = await command<{ items: Array<{ id: string; version: number }> }>(
    ["partner", "awaiting-owner", "--org", org.organization.id],
    aliceA,
  );
  const waiting = awaiting.items.find((item) => item.id === bobPartner.partner.id);
  if (!waiting) throw new Error("awaiting partner missing");
  await command(
    [
      "partner",
      "bulk-transfer",
      "--org",
      org.organization.id,
      "--account",
      input.diana.accountId,
      "--items",
      JSON.stringify([{ partnerId: waiting.id, expectedVersion: waiting.version }]),
      "--yes",
      "--idempotency-key",
      "partner-bulk-transfer",
    ],
    aliceA,
  );
  const stale = await rejected(["partner", "list", "--org", org.organization.id], bob);
  const directory = await mkdtemp(join(tmpdir(), "partner-e2e-export-"));
  const output = join(directory, "partners.csv");
  await command(
    [
      "partner",
      "export",
      "--org",
      org.organization.id,
      "--owner",
      "all",
      "--output",
      output,
      "--yes",
      "--idempotency-key",
      "partner-export",
    ],
    aliceA,
  );
  const exportMode = (await stat(output)).mode & 0o777;
  await rm(directory, { recursive: true });
  process.stdout.write(
    JSON.stringify({
      bobOwnCount: bobList.items.length,
      adminAllCount: all.items.length,
      inferenceDenied: inferred.stderr.includes("PARTNER_NOT_FOUND"),
      duplicateGroups: duplicate.groups.length,
      followUpCreated: interaction.interaction.followUpWorkItemId !== null,
      awaitingCount: awaiting.items.length,
      staleDenied: stale.stderr.includes("PARTNER_NOT_FOUND"),
      plaintextRows: plaintextRows ?? -1,
      exportMode,
    }),
  );
} else if (input.type === "notifications") {
  if (!input.bob) throw new Error("notifications requires Bob");
  const bobStore = new MemoryCredentialStore();
  const bob = dependencies(bobStore, crypto.randomUUID(), input.bob.password, "Bob Notify E2E");
  await login(bob, input.bob.phone);
  const organization = await command<{ organization: { id: string } }>(
    ["org", "create", "--name", "Notification E2E Org", "--yes", "--idempotency-key", "notify-org"],
    aliceA,
  );
  const organizationId = organization.organization.id;
  await command(
    [
      "org",
      "member",
      "add",
      "--org",
      organizationId,
      "--account",
      input.bob.accountId,
      "--role",
      "member",
      "--yes",
      "--idempotency-key",
      "notify-member",
    ],
    aliceA,
  );
  const createWork = (
    group: "task" | "meeting" | "approval",
    title: string,
    key: string,
    extra: string[] = [],
  ) =>
    command<{ item: { id: string } }>(
      [
        group,
        "create",
        "--org",
        organizationId,
        "--title",
        title,
        "--assignee",
        input.bob!.accountId,
        ...extra,
        "--yes",
        "--idempotency-key",
        key,
      ],
      aliceA,
    );
  await createWork("approval", "审批请求", "notify-approval");
  await createWork("task", "紧急任务", "notify-urgent", ["--priority", "urgent"]);
  await createWork("task", "普通任务不发短信", "notify-ordinary");
  await createWork("task", "普通任务可短信", "notify-ordinary-sms", ["--send-sms"]);
  await createWork("task", "普通任务可短信", "notify-ordinary-sms", ["--send-sms"]);
  const soon = new Date(Date.now() + 30 * 60_000).toISOString();
  const deadline = await createWork("task", "一小时截止提醒", "notify-deadline", [
    "--due-at",
    soon,
  ]);
  await createWork("meeting", "一小时会议提醒", "notify-meeting", ["--starts-at", soon]);
  await command(
    [
      "partner",
      "create",
      "--org",
      organizationId,
      "--data",
      JSON.stringify({
        name: "待跟进合作方",
        cooperationStage: "contacting",
        tags: [],
        nextFollowUpAt: new Date(Date.now() - 1_000).toISOString(),
      }),
      "--yes",
      "--idempotency-key",
      "notify-partner",
    ],
    bob,
  );
  const { createDatabaseClient } = await import("../../../apps/api/src/db/client.js");
  const db = createDatabaseClient(input.databaseUrl);
  const waitFor = async (label: string, check: () => Promise<boolean>) => {
    const deadlineAt = Date.now() + 10_000;
    while (Date.now() < deadlineAt) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`notification E2E timed out: ${label}`);
  };
  try {
    await waitFor("projected journeys", async () => {
      const [row] = await db<{ count: number }[]>`
        select count(*)::int count from notifications
        where organization_id=${organizationId} and recipient_account_id=${input.bob!.accountId}
      `;
      return (row?.count ?? 0) >= 9;
    });
    await waitFor("daily summary schedule", async () => {
      const [row] = await db<{ count: number }[]>`
        select count(*)::int count from scheduled_reminders
        where organization_id=${organizationId} and recipient_account_id=${input.bob!.accountId}
          and event_type='daily_summary' and status='pending'
      `;
      return row?.count === 1;
    });
    await db`
      insert into scheduled_reminders(
        organization_id,recipient_account_id,event_type,resource_type,resource_id,
        scheduled_for,status,attempts,lease_owner,lease_expires_at,deterministic_key,payload
      ) values(
        ${organizationId},${input.bob.accountId},'deadline_one_hour','work_item',${deadline.item.id},
        now()-interval '2 minutes','processing',1,'dead-notification-worker',
        now()-interval '1 minute','e2e-expired-notification-lease',${db.json({ title: "重启恢复提醒" })}
      )
    `;
    await waitFor("expired reminder lease recovery", async () => {
      const [row] = await db<{ count: number }[]>`
        select count(*)::int count from notifications where deduplication_key=(
          select 'reminder:'||id from scheduled_reminders
          where deterministic_key='e2e-expired-notification-lease'
        )
      `;
      return row?.count === 1;
    });
    const listed = await command<{
      items: Array<{ id: string; title: string; eventType: string; status: string }>;
    }>(["notification", "list", "--org", organizationId], bob);
    const first = listed.items[0];
    if (!first) throw new Error("notification list is empty");
    const marked = await command<{ status: string }>(
      [
        "notification",
        "mark-read",
        "--org",
        organizationId,
        "--notification",
        first.id,
        "--idempotency-key",
        "notify-mark-read",
      ],
      bob,
    );
    await command(
      [
        "notification",
        "preference-set",
        "--org",
        organizationId,
        "--daily-summary",
        "off",
        "--yes",
        "--idempotency-key",
        "notify-daily-off",
      ],
      bob,
    );
    const currentPolicy = await command<{ organizationVersion: number }>(
      ["notification", "policy-get", "--org", organizationId],
      aliceA,
    );
    const published = await command<{ policyVersion: number; timezone: string }>(
      [
        "notification",
        "policy-publish",
        "--org",
        organizationId,
        "--timezone",
        "America/New_York",
        "--expected-version",
        String(currentPolicy.organizationVersion),
        "--yes",
        "--idempotency-key",
        "notify-policy",
      ],
      aliceA,
    );
    const eventCounts = await db<{ event_type: string; count: number }[]>`
      select event_type,count(*)::int count from notifications
      where organization_id=${organizationId} and recipient_account_id=${input.bob.accountId}
      group by event_type order by event_type
    `;
    const [sms] = await db<{ count: number }[]>`
      select count(*)::int count from notification_delivery_attempts attempt
      left join notifications notification on notification.id=attempt.notification_id
      left join scheduled_reminders reminder on reminder.id=attempt.reminder_id
      where coalesce(notification.recipient_account_id,reminder.recipient_account_id)=${input.bob.accountId}
        and attempt.channel='sms'
    `;
    const [explicit] = await db<{ count: number }[]>`
      select count(*)::int count from notifications
      where organization_id=${organizationId} and recipient_account_id=${input.bob.accountId}
        and title='普通任务可短信'
    `;
    const [daily] = await db<{ status: string }[]>`
      select status from scheduled_reminders
      where organization_id=${organizationId} and recipient_account_id=${input.bob.accountId}
        and event_type='daily_summary'
    `;
    process.stdout.write(
      JSON.stringify({
        eventCounts: Object.fromEntries(eventCounts.map((row) => [row.event_type, row.count])),
        smsAttempts: sms?.count ?? -1,
        explicitIdempotentCount: explicit?.count ?? -1,
        dailySummaryStatus: daily?.status,
        markedRead: marked.status === "read",
        recoveredExpiredLease: true,
        policyVersion: published.policyVersion,
        policyTimezone: published.timezone,
      }),
    );
  } finally {
    await db.end();
  }
} else if (input.type === "chat-search") {
  if (!input.bob || !input.charlie) throw new Error("chat-search requires Bob and Charlie");
  const bobStore = new MemoryCredentialStore();
  const bob = dependencies(bobStore, crypto.randomUUID(), input.bob.password, "Bob Chat E2E");
  await login(bob, input.bob.phone);
  const organization = await command<{ organization: { id: string } }>(
    ["org", "create", "--name", "Chat Search E2E", "--yes", "--idempotency-key", "chat-org"],
    aliceA,
  );
  const organizationId = organization.organization.id;
  await command(
    [
      "org",
      "member",
      "add",
      "--org",
      organizationId,
      "--account",
      input.bob.accountId,
      "--role",
      "member",
      "--yes",
      "--idempotency-key",
      "chat-member",
    ],
    aliceA,
  );
  const crossDenied = await rejected(
    [
      "chat",
      "conversation",
      "direct-create",
      "--org",
      organizationId,
      "--account",
      input.charlie.accountId,
      "--yes",
      "--idempotency-key",
      "chat-cross",
    ],
    aliceA,
  );
  const conversation = await command<{ id: string }>(
    [
      "chat",
      "conversation",
      "direct-create",
      "--org",
      organizationId,
      "--account",
      input.bob.accountId,
      "--yes",
      "--idempotency-key",
      "chat-direct",
    ],
    aliceA,
  );
  const first = await command<{ id: string }>(
    [
      "chat",
      "message",
      "send",
      "--org",
      organizationId,
      "--conversation",
      conversation.id,
      "--body",
      "实时关键字 第一条",
      "--mention",
      input.bob.accountId,
      "--client-message-id",
      crypto.randomUUID(),
      "--idempotency-key",
      "chat-first",
    ],
    aliceA,
  );
  const streamed = await command<{ items: unknown[] }>(
    [
      "chat",
      "event",
      "stream",
      "--org",
      organizationId,
      "--conversation",
      conversation.id,
      "--after",
      "0",
      "--once",
    ],
    bob,
  );
  const credentials = await CliSessionCredentials.load(bobStore, `session:${input.apiUrl}`);
  const token = await credentials.getAccessToken();
  const realtimeUrl = process.env.E2E_REALTIME_URL;
  if (!token || !realtimeUrl) throw new Error("realtime E2E credentials are missing");
  const realtimeHost = new URL(realtimeUrl).hostname;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(realtimeHost))
    throw new Error("realtime E2E URL must be loopback");
  const protocols = ["torg.realtime.v1", `torg.token.${Buffer.from(token).toString("base64url")}`];
  const socket = await new Promise<WebSocket>((resolve, reject) => {
    const deadline = Date.now() + 5_000;
    const attempt = () => {
      const candidate = new WebSocket(realtimeUrl, protocols);
      candidate.once("open", () => resolve(candidate));
      candidate.once("error", (error) => {
        candidate.close();
        if (Date.now() >= deadline) reject(error);
        else setTimeout(attempt, 50);
      });
    };
    attempt();
  });
  const received: Array<Record<string, unknown>> = [];
  let closeCode = 0;
  socket.on("message", (raw) =>
    received.push(JSON.parse(raw.toString()) as Record<string, unknown>),
  );
  socket.on("close", (code) => (closeCode = code));
  const wait = async (predicate: () => boolean, label: string) => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`chat-search E2E timeout: ${label}`);
  };
  socket.send(
    JSON.stringify({
      type: "subscribe",
      organizationId,
      conversationId: conversation.id,
      afterSequence: 0,
    }),
  );
  await wait(() => received.some((item) => item.type === "ready"), "history ready");
  const second = await command<{ id: string }>(
    [
      "chat",
      "message",
      "send",
      "--org",
      organizationId,
      "--conversation",
      conversation.id,
      "--body",
      "撤回关键字 第二条",
      "--client-message-id",
      crypto.randomUUID(),
      "--idempotency-key",
      "chat-second",
    ],
    aliceA,
  );
  await wait(
    () =>
      received.some((item) => (item.event as { sequence?: number } | undefined)?.sequence === 2),
    "live second event",
  );
  const searchBefore = await command<{ totalAuthorized: number }>(
    ["search", "query", "--org", organizationId, "--text", "实时关键字", "--type", "message"],
    bob,
  );
  const myWork = await command<{ items: Array<{ kind: string }> }>(["my-work", "list"], bob);
  const converted = await command<{ item: { id: string } }>(
    [
      "chat",
      "message",
      "convert",
      "--org",
      organizationId,
      "--conversation",
      conversation.id,
      "--message",
      first.id,
      "--type",
      "task",
      "--title",
      "聊天转任务",
      "--assignee",
      input.bob.accountId,
      "--yes",
      "--idempotency-key",
      "chat-convert",
    ],
    aliceA,
  );
  await command(
    [
      "chat",
      "message",
      "retract",
      "--org",
      organizationId,
      "--conversation",
      conversation.id,
      "--message",
      second.id,
      "--yes",
      "--idempotency-key",
      "chat-retract",
    ],
    aliceA,
  );
  const searchAfter = await command<{ totalAuthorized: number }>(
    ["search", "query", "--org", organizationId, "--text", "撤回关键字", "--type", "message"],
    bob,
  );
  const { createDatabaseClient } = await import("../../../apps/api/src/db/client.js");
  const db = createDatabaseClient(input.databaseUrl);
  try {
    await db`update memberships set status='removed',removed_at=now() where organization_id=${organizationId} and account_id=${input.bob.accountId}`;
  } finally {
    await db.end();
  }
  await command<{ id: string }>(
    [
      "chat",
      "message",
      "send",
      "--org",
      organizationId,
      "--conversation",
      conversation.id,
      "--body",
      "撤权后消息",
      "--client-message-id",
      crypto.randomUUID(),
      "--idempotency-key",
      "chat-third",
    ],
    aliceA,
  );
  await wait(() => closeCode === 4403, "revoked close");
  const staleSearch = await rejected(
    ["search", "query", "--org", organizationId, "--text", "实时关键字"],
    bob,
  );
  socket.close();
  process.stdout.write(
    JSON.stringify({
      crossDenied: crossDenied.stderr.includes("CHAT_FORBIDDEN"),
      historyEvents: received.filter((item) => item.type === "event").length,
      cliStreamed: streamed.items.length,
      searchBefore: searchBefore.totalAuthorized,
      searchAfter: searchAfter.totalAuthorized,
      hasMention: myWork.items.some((item) => item.kind === "mention"),
      convertedTaskId: converted.item.id,
      revokedClose: closeCode,
      staleDenied: staleSearch.stderr.includes("ORG_FORBIDDEN"),
    }),
  );
} else if (input.type === "work-okr") {
  if (input.bob === undefined) throw new Error("work-okr requires Bob");
  const bobStore = new MemoryCredentialStore();
  const bob = dependencies(bobStore, crypto.randomUUID(), input.bob.password, "Bob Work E2E");
  await login(bob, input.bob.phone);
  const organization = await command<{ organization: { id: string } }>(
    ["org", "create", "--name", "Work OKR Org", "--yes", "--idempotency-key", "work-okr-org"],
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
      "work-okr-member",
    ],
    aliceA,
  );
  const task = await command<{
    item: { id: string; version: number };
    assignments: Array<{ id: string }>;
  }>(
    [
      "task",
      "create",
      "--org",
      organization.organization.id,
      "--title",
      "准备议程",
      "--assignee",
      input.bob.accountId,
      "--yes",
      "--idempotency-key",
      "work-task-create",
    ],
    aliceA,
  );
  const assignmentId = task.assignments[0]?.id;
  if (assignmentId === undefined) throw new Error("task assignment missing");
  const disputed = await command<{ item: { version: number } }>(
    [
      "work",
      "dispute",
      "--org",
      organization.organization.id,
      "--work",
      task.item.id,
      "--assignment",
      assignmentId,
      "--reason",
      "时间冲突",
      "--expected-version",
      String(task.item.version),
      "--yes",
      "--idempotency-key",
      "work-dispute",
    ],
    bob,
  );
  const transfer = await command<{ item: { version: number } }>(
    [
      "work",
      "transfer-request",
      "--org",
      organization.organization.id,
      "--work",
      task.item.id,
      "--assignment",
      assignmentId,
      "--target",
      input.alice.accountId,
      "--reason",
      "由发起人处理",
      "--expected-version",
      String(disputed.item.version),
      "--yes",
      "--idempotency-key",
      "work-transfer-request",
    ],
    bob,
  );
  const approvedTransfer = await command<{ assignments: Array<{ assigneeAccountId: string }> }>(
    [
      "work",
      "transfer-approve",
      "--org",
      organization.organization.id,
      "--work",
      task.item.id,
      "--assignment",
      assignmentId,
      "--expected-version",
      String(transfer.item.version),
      "--yes",
      "--idempotency-key",
      "work-transfer-approve",
    ],
    aliceA,
  );
  const meeting = await command<{ item: { id: string } }>(
    [
      "meeting",
      "create",
      "--org",
      organization.organization.id,
      "--title",
      "周会",
      "--starts-at",
      "2026-09-01T09:00:00.000Z",
      "--yes",
      "--idempotency-key",
      "work-meeting",
    ],
    aliceA,
  );

  const definition = await command<{ version: { id: string } }>(
    [
      "process",
      "definition-create",
      "--org",
      organization.organization.id,
      "--name",
      "单人审批",
      "--mode",
      "single",
      "--approver",
      input.bob.accountId,
      "--yes",
      "--idempotency-key",
      "process-definition",
    ],
    aliceA,
  );
  await command(
    [
      "process",
      "version-publish",
      "--org",
      organization.organization.id,
      "--version-id",
      definition.version.id,
      "--yes",
      "--idempotency-key",
      "process-publish",
    ],
    aliceA,
  );
  const instance = await command<{ instance: { id: string; version: number } }>(
    [
      "process",
      "start",
      "--org",
      organization.organization.id,
      "--version-id",
      definition.version.id,
      "--subject",
      JSON.stringify({ title: "发布申请" }),
      "--yes",
      "--idempotency-key",
      "process-start",
    ],
    aliceA,
  );
  const decided = await command<{ instance: { status: string } }>(
    [
      "process",
      "decide",
      "--org",
      organization.organization.id,
      "--instance",
      instance.instance.id,
      "--action",
      "approve",
      "--expected-version",
      String(instance.instance.version),
      "--yes",
      "--idempotency-key",
      "process-decide",
    ],
    bob,
  );

  const objective = await command<{
    objective: { id: string; version: number };
    keyResults: Array<{ id: string; version: number }>;
  }>(
    [
      "okr",
      "create",
      "--org",
      organization.organization.id,
      "--title",
      "发布课程",
      "--cycle",
      "2026-Q3",
      "--key-results",
      JSON.stringify([{ title: "完成发布", weight: 100, formula: { type: "manual" } }]),
      "--yes",
      "--idempotency-key",
      "okr-create",
    ],
    bob,
  );
  const keyResult = objective.keyResults[0];
  if (keyResult === undefined) throw new Error("KR missing");
  const progress = await command<{ keyResult: { progress: number } }>(
    [
      "okr",
      "progress",
      "--org",
      organization.organization.id,
      "--key-result",
      keyResult.id,
      "--value",
      "60",
      "--expected-version",
      String(keyResult.version),
      "--yes",
      "--idempotency-key",
      "okr-progress",
    ],
    bob,
  );
  const change = await command<{ changeRequest: { id: string } }>(
    [
      "okr",
      "change-request",
      "--org",
      organization.organization.id,
      "--objective",
      objective.objective.id,
      "--patch",
      JSON.stringify({ title: "发布课程与资料" }),
      "--expected-version",
      String(objective.objective.version),
      "--yes",
      "--idempotency-key",
      "okr-change",
    ],
    bob,
  );
  const changed = await command<{ objective: { title: string } }>(
    [
      "okr",
      "approve",
      "--org",
      organization.organization.id,
      "--change-request",
      change.changeRequest.id,
      "--expected-version",
      String(objective.objective.version),
      "--yes",
      "--idempotency-key",
      "okr-approve",
    ],
    aliceA,
  );
  const aliceTasks = await command<{ items: unknown[] }>(
    ["work", "list", "--org", organization.organization.id, "--type", "task"],
    aliceA,
  );
  const aliceOkr = await command<{ items: unknown[] }>(
    ["okr", "list", "--org", organization.organization.id],
    aliceA,
  );
  process.stdout.write(
    JSON.stringify({
      transferredToAlice:
        approvedTransfer.assignments[0]?.assigneeAccountId === input.alice.accountId,
      meetingId: meeting.item.id,
      processStatus: decided.instance.status,
      progress: progress.keyResult.progress,
      changedTitle: changed.objective.title,
      aliceTaskCount: aliceTasks.items.length,
      aliceOkrCount: aliceOkr.items.length,
    }),
  );
} else if (input.type === "files-authorization") {
  if (input.bob === undefined) throw new Error("files-authorization requires Bob");
  const bobStore = new MemoryCredentialStore();
  const bob = dependencies(bobStore, crypto.randomUUID(), input.bob.password, "Bob Mac E2E");
  await login(aliceB, input.alice.phone);
  await login(bob, input.bob.phone);
  const organizationA = await command<{ organization: { id: string } }>(
    ["org", "create", "--name", "Files Org A", "--yes", "--idempotency-key", "files-auth-org-a"],
    aliceA,
  );
  const organizationB = await command<{ organization: { id: string } }>(
    ["org", "create", "--name", "Files Org B", "--yes", "--idempotency-key", "files-auth-org-b"],
    aliceA,
  );
  await command(
    [
      "org",
      "member",
      "add",
      "--org",
      organizationA.organization.id,
      "--account",
      input.bob.accountId,
      "--role",
      "member",
      "--yes",
      "--idempotency-key",
      "files-auth-member",
    ],
    aliceA,
  );
  type SpaceItem = {
    id: string;
    type: "personal" | "organization";
    accountId: string | null;
    organizationId: string | null;
    rootFolderId: string;
  };
  const aliceSpaces = await command<{ items: SpaceItem[] }>(["space", "list"], aliceA);
  const bobSpaces = await command<{ items: SpaceItem[] }>(["space", "list"], bob);
  const alicePersonal = aliceSpaces.items.find((space) => space.type === "personal");
  const orgASpace = aliceSpaces.items.find(
    (space) => space.organizationId === organizationA.organization.id,
  );
  const orgBSpace = aliceSpaces.items.find(
    (space) => space.organizationId === organizationB.organization.id,
  );
  const bobPersonal = bobSpaces.items.find((space) => space.type === "personal");
  if (
    alicePersonal === undefined ||
    bobPersonal === undefined ||
    orgASpace === undefined ||
    orgBSpace === undefined
  ) {
    throw new Error("required file spaces are missing");
  }

  const publicFolder = await command<{ entry: { id: string } }>(
    [
      "file",
      "mkdir",
      "--space",
      orgASpace.id,
      "--parent",
      orgASpace.rootFolderId,
      "--name",
      "Public collaboration",
      "--access",
      "organization_public",
      "--idempotency-key",
      "files-auth-public",
    ],
    aliceA,
  );
  const publicChild = await command<{ entry: { id: string } }>(
    [
      "file",
      "mkdir",
      "--space",
      orgASpace.id,
      "--parent",
      publicFolder.entry.id,
      "--name",
      "Bob public child",
      "--access",
      "organization_public",
      "--idempotency-key",
      "files-auth-public-child",
    ],
    bob,
  );

  const managerFolder = await command<{ entry: { id: string } }>(
    [
      "file",
      "mkdir",
      "--space",
      orgASpace.id,
      "--parent",
      orgASpace.rootFolderId,
      "--name",
      "Bob restricted",
      "--access",
      "restricted",
      "--idempotency-key",
      "files-auth-manager",
    ],
    bob,
  );
  const adminMetadata = await command<{ entry: { id: string; effectiveRole: string } }>(
    ["file", "get", "--space", orgASpace.id, "--file", managerFolder.entry.id],
    aliceA,
  );
  const adminDownload = await rejected(
    [
      "file",
      "download",
      "--space",
      orgASpace.id,
      "--file",
      managerFolder.entry.id,
      "--output",
      join(tmpdir(), `forbidden-${crypto.randomUUID()}`),
      "--idempotency-key",
      "files-auth-admin-download",
    ],
    aliceA,
  );
  const recovered = await command<{ grants: Array<{ accountId: string; role: string }> }>(
    [
      "folder",
      "manager-recover",
      "--space",
      orgASpace.id,
      "--folder",
      managerFolder.entry.id,
      "--account",
      input.alice.accountId,
      "--reason",
      "E2E manager recovery",
      "--expected-version",
      "1",
      "--yes",
      "--idempotency-key",
      "files-auth-recover",
    ],
    aliceA,
  );

  const editorFolder = await command<{ entry: { id: string } }>(
    [
      "file",
      "mkdir",
      "--space",
      orgASpace.id,
      "--parent",
      orgASpace.rootFolderId,
      "--name",
      "Editor folder",
      "--access",
      "restricted",
      "--idempotency-key",
      "files-auth-editor",
    ],
    aliceA,
  );
  await command(
    [
      "folder",
      "grant",
      "--space",
      orgASpace.id,
      "--folder",
      editorFolder.entry.id,
      "--account",
      input.bob.accountId,
      "--role",
      "editor",
      "--expected-version",
      "1",
      "--yes",
      "--idempotency-key",
      "files-auth-editor-grant",
    ],
    aliceA,
  );
  const editorChild = await command<{ entry: { id: string } }>(
    [
      "file",
      "mkdir",
      "--space",
      orgASpace.id,
      "--parent",
      editorFolder.entry.id,
      "--name",
      "Editor child",
      "--access",
      "restricted",
      "--idempotency-key",
      "files-auth-editor-child",
    ],
    bob,
  );
  const editorCannotManage = await rejected(
    [
      "folder",
      "grant",
      "--space",
      orgASpace.id,
      "--folder",
      editorFolder.entry.id,
      "--account",
      input.bob.accountId,
      "--role",
      "manager",
      "--expected-version",
      "2",
      "--yes",
      "--idempotency-key",
      "files-auth-editor-escalate",
    ],
    bob,
  );

  const viewerFolder = await command<{ entry: { id: string } }>(
    [
      "file",
      "mkdir",
      "--space",
      orgASpace.id,
      "--parent",
      orgASpace.rootFolderId,
      "--name",
      "Viewer folder",
      "--access",
      "restricted",
      "--idempotency-key",
      "files-auth-viewer",
    ],
    aliceA,
  );
  await command(
    [
      "folder",
      "grant",
      "--space",
      orgASpace.id,
      "--folder",
      viewerFolder.entry.id,
      "--account",
      input.bob.accountId,
      "--role",
      "viewer",
      "--expected-version",
      "1",
      "--yes",
      "--idempotency-key",
      "files-auth-viewer-grant",
    ],
    aliceA,
  );
  const viewerRead = await command<{ entry: { id: string } }>(
    ["file", "get", "--space", orgASpace.id, "--file", viewerFolder.entry.id],
    bob,
  );
  const viewerCannotWrite = await rejected(
    [
      "file",
      "mkdir",
      "--space",
      orgASpace.id,
      "--parent",
      viewerFolder.entry.id,
      "--name",
      "Forbidden child",
      "--access",
      "restricted",
      "--idempotency-key",
      "files-auth-viewer-child",
    ],
    bob,
  );
  const personalIsolation = await rejected(
    ["file", "list", "--space", alicePersonal.id, "--parent", alicePersonal.rootFolderId],
    bob,
  );
  const crossOrganization = await rejected(
    ["file", "list", "--space", orgBSpace.id, "--parent", orgBSpace.rootFolderId],
    bob,
  );

  const { createDatabaseClient } = await import("../../../apps/api/src/db/client.js");
  const sql = createDatabaseClient(input.databaseUrl);
  try {
    await sql`update memberships set status = 'removed', removed_at = now()
      where organization_id = ${organizationA.organization.id} and account_id = ${input.bob.accountId}`;
  } finally {
    await sql.end();
  }
  const removedMember = await rejected(
    ["file", "list", "--space", orgASpace.id, "--parent", orgASpace.rootFolderId],
    bob,
  );

  process.stdout.write(
    JSON.stringify({
      personalSpacesDistinct: alicePersonal.id !== bobPersonal.id,
      publicChildId: publicChild.entry.id,
      adminMetadata,
      adminDownload,
      managerRecovered: recovered.grants.some(
        (grant) => grant.accountId === input.alice.accountId && grant.role === "manager",
      ),
      editorChildId: editorChild.entry.id,
      editorCannotManage,
      viewerReadId: viewerRead.entry.id,
      viewerCannotWrite,
      personalIsolation,
      crossOrganization,
      removedMember,
    }),
  );
} else if (input.type === "files-recovery") {
  const spaces = await command<{ items: Array<{ id: string; rootFolderId: string }> }>(
    ["space", "list"],
    aliceA,
  );
  const personal = spaces.items[0];
  if (personal === undefined) throw new Error("personal space is missing");
  const composeProject = process.env.E2E_COMPOSE_PROJECT;
  const composeFile = process.env.E2E_COMPOSE_FILE;
  const replacementWorkerPidFile = process.env.E2E_REPLACEMENT_WORKER_PID_FILE;
  const workerPid = Number(process.env.E2E_WORKER_PID);
  if (
    composeFile !== "deploy/compose.local.yml" ||
    composeProject === undefined ||
    !/^tashan-orgspace-e2e-[0-9]+$/.test(composeProject) ||
    replacementWorkerPidFile === undefined ||
    !replacementWorkerPidFile.startsWith(`${tmpdir()}/`) ||
    !Number.isSafeInteger(workerPid) ||
    workerPid <= 1
  ) {
    throw new Error("recovery E2E control scope is invalid");
  }
  const s3Config = parseObjectStoreConfig(
    {
      endpoint: process.env.S3_ENDPOINT,
      publicOrigin: process.env.S3_PUBLIC_ORIGIN,
      region: process.env.S3_REGION,
      bucket: process.env.S3_BUCKET,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    },
    "test",
  );
  const internalClient = createInternalS3Client(s3Config);
  const dataStore = new S3FileDataStore({
    internalClient,
    presignClient: createPresignS3Client(s3Config),
    bucket: s3Config.bucket,
  });
  const maintenanceStore = new S3FileMaintenanceStore(internalClient, s3Config.bucket);
  const directory = await mkdtemp(join(tmpdir(), "torg-files-recovery-e2e-"));
  try {
    const source = join(directory, "recovery.bin");
    const bytes = Buffer.alloc(17 * 1024 * 1024, 73);
    await writeFile(source, bytes);
    const credentials = await CliSessionCredentials.load(
      aliceStoreA,
      `session:${input.apiUrl}`,
      aliceDeviceA,
    );
    const client = createOrgSpaceClient({
      transport: createFetchTransport({ baseUrl: input.apiUrl, timeoutMilliseconds: 15_000 }),
      credentials,
      deviceId: aliceDeviceA,
      clientChannel: "cli",
      invocationSource: "ai_via_cli",
    });
    const upload = await client.createUpload(
      personal.id,
      {
        parentId: personal.rootFolderId,
        fileName: "recovery.bin",
        expectedSizeBytes: bytes.byteLength,
        contentType: "application/octet-stream",
      },
      { idempotencyKey: "files-recovery-create" },
    );
    const firstUrl = await client.createUploadPartUrls(
      personal.id,
      upload.uploadSession.id,
      { partNumbers: [1] },
      { idempotencyKey: "files-recovery-part-one" },
    );
    const firstPart = bytes.subarray(0, upload.uploadSession.partSizeBytes);
    await createNodeFileByteTransport().uploadPart({
      url: firstUrl.items[0]?.url ?? "",
      bytes: firstPart,
      checksumSha256: createHash("sha256").update(firstPart).digest("base64"),
    });

    await runProcess("docker", [
      "compose",
      "-f",
      composeFile,
      "-p",
      composeProject,
      "restart",
      "minio",
    ]);
    await runProcess("docker", [
      "compose",
      "-f",
      composeFile,
      "-p",
      composeProject,
      "up",
      "-d",
      "--wait",
      "minio",
    ]);
    const afterMinioRestart = await client.readUpload(personal.id, upload.uploadSession.id);

    process.kill(workerPid, "SIGTERM");
    const workerExitDeadline = Date.now() + 5_000;
    while (Date.now() < workerExitDeadline) {
      try {
        process.kill(workerPid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") break;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const orphanKey = `temporary/${crypto.randomUUID()}`;
    const orphanUploadId = await dataStore.createMultipart({
      key: orphanKey,
      contentType: "application/octet-stream",
    });
    const orphanUrl = await dataStore.presignPart({
      key: orphanKey,
      uploadId: orphanUploadId,
      partNumber: 1,
      expiresInSeconds: 60,
    });
    const orphanBytes = Buffer.from("orphan temporary object", "utf8");
    const orphanChecksum = createHash("sha256").update(orphanBytes).digest("base64");
    const orphanPart = await createNodeFileByteTransport().uploadPart({
      url: orphanUrl,
      bytes: orphanBytes,
      checksumSha256: orphanChecksum,
    });
    await dataStore.completeMultipart({
      key: orphanKey,
      uploadId: orphanUploadId,
      parts: [{ partNumber: 1, etag: orphanPart.etag, checksumSha256: orphanChecksum }],
    });

    await command(
      [
        "upload",
        "resume",
        source,
        "--space",
        personal.id,
        "--upload",
        upload.uploadSession.id,
        "--idempotency-key",
        "files-recovery-resume",
      ],
      aliceA,
    );
    const replacementWorker = spawn(
      process.execPath,
      ["--import", "tsx", "apps/worker/src/main.ts"],
      {
        cwd: process.cwd(),
        env: { ...process.env, WORKER_ID: `${process.env.WORKER_ID ?? "e2e"}-restart` },
        shell: false,
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    if (replacementWorker.pid === undefined) throw new Error("replacement Worker PID is missing");
    await writeFile(replacementWorkerPidFile, String(replacementWorker.pid), { flag: "wx" });
    replacementWorker.unref();

    let entryId: string | undefined;
    const verificationDeadline = Date.now() + 8_000;
    while (Date.now() < verificationDeadline) {
      const listing = await command<{ items: Array<{ id: string; name: string }> }>(
        ["file", "list", "--space", personal.id, "--parent", personal.rootFolderId],
        aliceA,
      );
      entryId = listing.items.find((entry) => entry.name === "recovery.bin")?.id;
      if (entryId !== undefined) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (entryId === undefined) throw new Error("replacement worker did not verify the upload");

    let orphanCleaned = false;
    const orphanDeadline = Date.now() + 8_000;
    while (Date.now() < orphanDeadline) {
      if ((await maintenanceStore.headObject(orphanKey)) === undefined) {
        orphanCleaned = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const { createDatabaseClient } = await import("../../../apps/api/src/db/client.js");
    const sql = createDatabaseClient(input.databaseUrl);
    let versionId: string;
    let versionKey: string;
    try {
      const [version] = await sql<{ id: string; object_key: string }[]>`
        select version.id, version.object_key
        from file_entries entry join file_versions version on version.id = entry.current_version_id
        where entry.id = ${entryId}
      `;
      if (version === undefined) throw new Error("verified version is missing");
      versionId = version.id;
      versionKey = version.object_key;
      await maintenanceStore.deleteObject(versionKey);
      await sql`insert into file_maintenance_jobs (job_type, payload, available_at)
        values ('reconcile_version', ${sql.json({ versionId })}, now() - interval '1 second')`;
      const corruptDeadline = Date.now() + 8_000;
      let status = "available";
      while (Date.now() < corruptDeadline) {
        const [row] = await sql<{ status: string }[]>`
          select status from file_versions where id = ${versionId}
        `;
        status = row?.status ?? "missing";
        if (status === "corrupt") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const usage = await command<{ reservedBytes: number }>(
        ["space", "usage", "--space", personal.id],
        aliceA,
      );
      process.stdout.write(
        JSON.stringify({
          partsAfterMinioRestart: afterMinioRestart.uploadedParts.map((part) => part.partNumber),
          verifiedEntryId: entryId,
          orphanCleaned,
          missingVersionStatus: status,
          reservedBytes: usage.reservedBytes,
        }),
      );
    } finally {
      await sql.end();
    }
  } finally {
    internalClient.destroy();
    await rm(directory, { recursive: true });
  }
} else if (input.type === "files") {
  await login(aliceB, input.alice.phone);
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
    const restoredDestination = join(directory, "restored.txt");
    const originalBytes = Buffer.alloc(33 * 1024 * 1024);
    for (let index = 0; index < originalBytes.length; index += 1) {
      originalBytes[index] = index % 251;
    }
    await writeFile(source, originalBytes);

    const credentialsA = await CliSessionCredentials.load(
      aliceStoreA,
      `session:${input.apiUrl}`,
      aliceDeviceA,
    );
    const clientA = createOrgSpaceClient({
      transport: createFetchTransport({ baseUrl: input.apiUrl, timeoutMilliseconds: 15_000 }),
      credentials: credentialsA,
      deviceId: aliceDeviceA,
      clientChannel: "cli",
      invocationSource: "ai_via_cli",
    });
    const created = await clientA.createUpload(
      personal.id,
      {
        parentId: personal.rootFolderId,
        fileName: "source.txt",
        expectedSizeBytes: originalBytes.byteLength,
        contentType: "application/octet-stream",
      },
      { idempotencyKey: "files-upload-create" },
    );
    const partUrls = await clientA.createUploadPartUrls(
      personal.id,
      created.uploadSession.id,
      { partNumbers: [1, 2] },
      { idempotencyKey: "files-upload-first-two-parts" },
    );
    const byteTransport = createNodeFileByteTransport();
    for (const item of partUrls.items) {
      const offset = (item.partNumber - 1) * created.uploadSession.partSizeBytes;
      const bytes = originalBytes.subarray(offset, offset + created.uploadSession.partSizeBytes);
      await byteTransport.uploadPart({
        url: item.url,
        bytes,
        checksumSha256: createHash("sha256").update(bytes).digest("base64"),
      });
    }
    const credentialsB = await CliSessionCredentials.load(
      aliceStoreB,
      `session:${input.apiUrl}`,
      aliceDeviceB,
    );
    const clientB = createOrgSpaceClient({
      transport: createFetchTransport({ baseUrl: input.apiUrl, timeoutMilliseconds: 15_000 }),
      credentials: credentialsB,
      deviceId: aliceDeviceB,
      clientChannel: "cli",
      invocationSource: "ai_via_cli",
    });
    const interrupted = await clientB.readUpload(personal.id, created.uploadSession.id);
    await command(
      [
        "upload",
        "resume",
        source,
        "--space",
        personal.id,
        "--upload",
        created.uploadSession.id,
        "--idempotency-key",
        "files-upload-resume-device-b",
      ],
      aliceB,
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
    const downloadedBytes = await readFile(destination);
    const sameNameConflict = await rejected(
      [
        "file",
        "upload",
        source,
        "--space",
        personal.id,
        "--parent",
        personal.rootFolderId,
        "--idempotency-key",
        "files-upload-name-conflict",
      ],
      aliceA,
    );

    const versionTwoBytes = Buffer.from("version two bytes\n", "utf8");
    await writeFile(source, versionTwoBytes);
    await command(
      [
        "file",
        "upload",
        source,
        "--space",
        personal.id,
        "--parent",
        personal.rootFolderId,
        "--target-file",
        entry.id,
        "--content-type",
        "text/plain",
        "--idempotency-key",
        "files-upload-version-two",
      ],
      aliceA,
    );
    let versions: { items: Array<{ id: string; versionNumber: number }> } | undefined;
    const versionDeadline = Date.now() + 8_000;
    while (Date.now() < versionDeadline) {
      versions = await command<{ items: Array<{ id: string; versionNumber: number }> }>(
        ["file", "versions", "--space", personal.id, "--file", entry.id],
        aliceA,
      );
      if (versions.items.length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (versions === undefined || versions.items.length !== 2) {
      throw new Error("second file version did not become available");
    }
    const current = await command<{ entry: { lockVersion: number } }>(
      ["file", "get", "--space", personal.id, "--file", entry.id],
      aliceA,
    );
    const firstVersion = versions.items.find((version) => version.versionNumber === 1);
    if (firstVersion === undefined) throw new Error("first file version is missing");
    await command(
      [
        "file",
        "version-restore",
        "--space",
        personal.id,
        "--file",
        entry.id,
        "--version-id",
        firstVersion.id,
        "--expected-version",
        String(current.entry.lockVersion),
        "--yes",
        "--idempotency-key",
        "files-version-restore",
      ],
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
        restoredDestination,
        "--idempotency-key",
        "files-restored-download",
      ],
      aliceB,
    );
    const secondTrash = await command<{ expiresAt: string }>(
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
    const { createDatabaseClient } = await import("../../../apps/api/src/db/client.js");
    const sql = createDatabaseClient(input.databaseUrl);
    try {
      await sql`update trash_entries set expires_at = now() - interval '1 second'
        where entry_id = ${entry.id}`;
    } finally {
      await sql.end();
    }
    let purged = false;
    const purgeDeadline = Date.now() + 8_000;
    while (Date.now() < purgeDeadline) {
      const probe = await rejected(
        ["file", "get", "--space", personal.id, "--file", entry.id],
        aliceA,
      );
      if (probe.stderr.includes("FILE_NOT_FOUND")) {
        purged = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const usage = await command<{ usedBytes: number; reservedBytes: number }>(
      ["space", "usage", "--space", personal.id],
      aliceA,
    );
    process.stdout.write(
      JSON.stringify({
        interruptedParts: interrupted.uploadedParts.map((part) => part.partNumber),
        downloadedMatches: downloadedBytes.equals(originalBytes),
        sameNameConflict,
        versions: versions.items.length,
        restoredBytesMatch: (await readFile(restoredDestination)).equals(originalBytes),
        restoredName: restored.entry.name,
        secondTrashExpiresAt: secondTrash.expiresAt,
        purged,
        usedBytes: usage.usedBytes,
        reservedBytes: usage.reservedBytes,
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
