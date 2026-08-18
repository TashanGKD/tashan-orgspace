import { describe, expect, test } from "vitest";

import { createDatabaseClient } from "../../apps/api/src/db/client.js";
import { e2eEnvironment, registerAndVerify, runCliScenario } from "./support/flows.js";

describe("audit evidence", () => {
  test("records trusted device/network context and excludes credentials and whole phone numbers", async () => {
    const alice = await registerAndVerify("audit-alice", "+8613800138301");
    const result = await runCliScenario<{
      organizationId: string;
      aliceDeviceA: string;
      events: {
        capabilityId: string;
        serverIp: string;
        deviceId: string;
        device: { name: string; os: string; architecture: string; clientVersion: string };
        actorSource: string;
        reportedActorSource: string | null;
        requestId: string;
        result: string;
      }[];
    }>({ type: "audit", alice });
    const creation = result.events.find((event) => event.capabilityId === "organization.create");
    expect(creation).toMatchObject({
      serverIp: "127.0.0.1",
      deviceId: result.aliceDeviceA,
      device: {
        name: "Alice Mac E2E",
        os: "e2e-os",
        architecture: "e2e-arch",
        clientVersion: "0.0.0",
      },
      actorSource: "ai_via_cli",
      reportedActorSource: "ai_via_cli",
      result: "success",
    });
    expect(creation?.requestId).toMatch(/^[0-9a-f-]{36}$/);

    const sql = createDatabaseClient(e2eEnvironment().databaseUrl);
    try {
      const rows = await sql<
        {
          device_metadata: unknown;
          before_state: unknown;
          after_state: unknown;
          idempotency_key: string | null;
        }[]
      >`
        select device_metadata, before_state, after_state, idempotency_key
        from audit_events where account_id = ${alice.accountId}
      `;
      const serialized = JSON.stringify(rows);
      expect(serialized).not.toContain(alice.password);
      expect(serialized).not.toContain(alice.phone);
      expect(serialized).not.toMatch(/refresh[-_]?token/i);
      expect(serialized).not.toMatch(/access[-_]?token/i);
    } finally {
      await sql.end();
    }
  });
});
