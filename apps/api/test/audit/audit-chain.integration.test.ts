import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { AuditService } from "../../src/audit/audit-service.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for audit integration tests");
}

let sql: DatabaseClient;
let audit: AuditService;
let organizationId: string;
let requestSequence = 0;

beforeAll(async () => {
  await resetTestDatabase(testDatabaseUrl);
  await migrateDatabase(testDatabaseUrl);
  sql = createDatabaseClient(testDatabaseUrl);
  audit = new AuditService(sql);
}, 30_000);

beforeEach(async () => {
  await sql`truncate table audit_events, session_refresh_tokens, sessions, devices, memberships, organizations, phone_verifications, principals, accounts cascade`;
  const [organization] = await sql<{ id: string }[]>`
    insert into organizations (name) values ('Audit Test') returning id
  `;
  if (organization === undefined) throw new Error("failed to create audit organization fixture");
  organizationId = organization.id;
  requestSequence = 0;
});

afterAll(async () => {
  await sql?.end();
});

function nextRequestId(): string {
  requestSequence += 1;
  return `00000000-0000-4000-8000-${String(requestSequence).padStart(12, "0")}`;
}

async function appendEvent(action: string) {
  return audit.append({
    organizationId,
    serverIp: "198.51.100.23",
    proxyChain: ["10.0.0.4", "10.0.0.10"],
    deviceMetadata: {
      name: "Audit laptop",
      os: "darwin",
      architecture: "arm64",
      clientVersion: "0.0.0-test",
    },
    actorSource: "cli",
    reportedActorSource: "ai_via_cli",
    capabilityId: "organization.list",
    action,
    result: "success",
    requestId: nextRequestId(),
    beforeState: { phone: "+8613800138000" },
    afterState: { refreshToken: "must-not-persist" },
  });
}

describe("tamper-evident audit chain", () => {
  test("appends and verifies a valid redacted chain", async () => {
    await appendEvent("first");
    await appendEvent("second");
    await appendEvent("third");

    await expect(audit.verifyChain(organizationId)).resolves.toEqual({
      valid: true,
      eventCount: 3,
    });

    const rows = await sql<
      { before_state: { phone: string }; after_state: { refreshToken: string } }[]
    >`select before_state, after_state from audit_events order by created_at, id`;
    expect(rows[0]).toMatchObject({
      before_state: { phone: "+86138****8000" },
      after_state: { refreshToken: "[REDACTED]" },
    });
  });

  test("canonicalizes an IPv6 source before hashing and persistence", async () => {
    await audit.append({
      organizationId,
      serverIp: "2001:0db8:0000:0000:0000:0000:0000:0023",
      actorSource: "web",
      capabilityId: "organization.list",
      action: "ipv6",
      result: "success",
      requestId: nextRequestId(),
    });

    await expect(audit.verifyChain(organizationId)).resolves.toEqual({
      valid: true,
      eventCount: 1,
    });
    const [row] = await sql<{ server_ip: string }[]>`select server_ip from audit_events`;
    expect(row?.server_ip).toBe("2001:db8::23");
  });

  test("detects privileged fixture tampering at the one-based chain position", async () => {
    await appendEvent("first");
    await appendEvent("second");
    await appendEvent("third");

    try {
      await sql`alter table audit_events disable trigger audit_events_append_only`;
      await sql`
        update audit_events
        set action = 'privileged-tamper'
        where id = (
          select id from audit_events order by created_at, id offset 1 limit 1
        )
      `;
    } finally {
      await sql`alter table audit_events enable trigger audit_events_append_only`;
    }

    await expect(audit.verifyChain(organizationId)).resolves.toEqual({
      valid: false,
      eventCount: 3,
      brokenAt: 2,
    });
  });

  test("serializes concurrent appends into one unbroken organization chain", async () => {
    await Promise.all(Array.from({ length: 12 }, (_, index) => appendEvent(`parallel-${index}`)));

    await expect(audit.verifyChain(organizationId)).resolves.toEqual({
      valid: true,
      eventCount: 12,
    });
    const [counts] = await sql<{ total: number; hashes: number }[]>`
      select count(*)::int as total, count(distinct event_hash)::int as hashes
      from audit_events where organization_id = ${organizationId}
    `;
    expect(counts).toEqual({ total: 12, hashes: 12 });
  });
});
