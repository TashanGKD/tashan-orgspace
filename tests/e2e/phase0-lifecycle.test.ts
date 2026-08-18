import { describe, expect, test } from "vitest";

import { createDatabaseClient } from "../../apps/api/src/db/client.js";
import { e2eEnvironment, registerAndVerify, runCliScenario } from "./support/flows.js";

describe("Phase 0 lifecycle", () => {
  test("keeps one Alice device active after another is revoked", async () => {
    const alice = await registerAndVerify("life-alice", "+8613800138101");
    const bob = await registerAndVerify("life-bob", "+8613800138102");
    const result = await runCliScenario<{
      organizationId: string;
      aliceDeviceA: string;
      aliceDeviceB: string;
      revoked: { exitCode: number; stderr: string };
      surviving: { account: { username: string }; deviceId: string };
      organizationAudit: { capabilityId: string }[];
    }>({ type: "lifecycle", alice, bob });

    expect(result.revoked).toMatchObject({ exitCode: 3 });
    expect(result.revoked.stderr).toContain("AUTH_TOKEN_REVOKED");
    expect(result.surviving).toMatchObject({
      account: { username: "life-alice" },
      deviceId: result.aliceDeviceB,
    });
    expect(result.organizationAudit).toContainEqual(
      expect.objectContaining({ capabilityId: "organization.member.add" }),
    );

    const sql = createDatabaseClient(e2eEnvironment().databaseUrl);
    try {
      const [deviceAudit] = await sql<
        { organization_id: string | null; device_id: string; capability_id: string }[]
      >`
        select organization_id, device_id, capability_id
        from audit_events
        where capability_id = 'device.revoke' and account_id = ${alice.accountId}
        order by created_at desc limit 1
      `;
      expect(deviceAudit).toEqual({
        organization_id: null,
        device_id: result.aliceDeviceB,
        capability_id: "device.revoke",
      });
    } finally {
      await sql.end();
    }
  });
});
