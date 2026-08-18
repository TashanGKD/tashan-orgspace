import { describe, expect, test } from "vitest";

import { createDatabaseClient } from "../../apps/api/src/db/client.js";
import { e2eEnvironment, registerAndVerify, runCliScenario } from "./support/flows.js";

describe("organization isolation", () => {
  test("rejects valid users presenting real object IDs from another organization", async () => {
    const alice = await registerAndVerify("cross-alice", "+8613800138201");
    const bob = await registerAndVerify("cross-bob", "+8613800138202");
    const result = await runCliScenario<{
      aliceOrganizationId: string;
      bobOrganizationId: string;
      bobReadsAliceMembers: { exitCode: number; stderr: string };
      bobReadsAliceAudit: { exitCode: number; stderr: string };
      aliceReadsBobMembers: { exitCode: number; stderr: string };
    }>({ type: "cross-org", alice, bob });

    expect(result.aliceOrganizationId).not.toBe(result.bobOrganizationId);
    for (const rejection of [
      result.bobReadsAliceMembers,
      result.bobReadsAliceAudit,
      result.aliceReadsBobMembers,
    ]) {
      expect(rejection.exitCode).toBe(4);
      expect(rejection.stderr).toContain("ORG_FORBIDDEN");
    }

    const sql = createDatabaseClient(e2eEnvironment().databaseUrl);
    try {
      const rejections = await sql<
        {
          account_id: string;
          organization_id: string;
          capability_id: string;
          result: string;
          error_code: string;
        }[]
      >`
        select account_id, organization_id, capability_id, result, error_code
        from audit_events
        where result = 'rejected'
          and error_code = 'ORG_FORBIDDEN'
          and account_id in (${alice.accountId}, ${bob.accountId})
      `;
      expect(rejections).toEqual(
        expect.arrayContaining([
          {
            account_id: bob.accountId,
            organization_id: result.aliceOrganizationId,
            capability_id: "organization.member.list",
            result: "rejected",
            error_code: "ORG_FORBIDDEN",
          },
          {
            account_id: bob.accountId,
            organization_id: result.aliceOrganizationId,
            capability_id: "audit.list",
            result: "rejected",
            error_code: "ORG_FORBIDDEN",
          },
          {
            account_id: alice.accountId,
            organization_id: result.bobOrganizationId,
            capability_id: "organization.member.list",
            result: "rejected",
            error_code: "ORG_FORBIDDEN",
          },
        ]),
      );
    } finally {
      await sql.end();
    }
  });
});
