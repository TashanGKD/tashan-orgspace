import { describe, expect, test } from "vitest";

import { registerAndVerify, runCliScenario } from "./support/flows.js";

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
  });
});
