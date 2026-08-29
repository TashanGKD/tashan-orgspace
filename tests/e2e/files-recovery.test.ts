import { describe, expect, test } from "vitest";

import { registerAndVerify, runCliScenario } from "./support/flows.js";

describe("file recovery", () => {
  test("survives MinIO and Worker restarts and reconciles storage", async () => {
    const alice = await registerAndVerify("files-recovery-alice", "+8613800138413");
    const result = await runCliScenario<{
      partsAfterMinioRestart: number[];
      verifiedEntryId: string;
      orphanCleaned: boolean;
      missingVersionStatus: string;
      reservedBytes: number;
    }>({ type: "files-recovery", alice });

    expect(result.partsAfterMinioRestart).toEqual([1]);
    expect(result.verifiedEntryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.orphanCleaned).toBe(true);
    expect(result.missingVersionStatus).toBe("corrupt");
    expect(result.reservedBytes).toBe(0);
  });
});
