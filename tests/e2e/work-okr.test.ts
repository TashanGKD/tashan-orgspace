import { describe, expect, test } from "vitest";
import { registerAndVerify, runCliScenario } from "./support/flows.js";

describe("work and OKR", () => {
  test("runs creator, assignee and administrator journeys through the CLI", async () => {
    const alice = await registerAndVerify("work-alice", "+8613800138461");
    const bob = await registerAndVerify("work-bob", "+8613800138462");
    const result = await runCliScenario<{
      transferredToAlice: boolean;
      meetingId: string;
      processStatus: string;
      progress: number;
      changedTitle: string;
      aliceTaskCount: number;
      aliceOkrCount: number;
    }>({ type: "work-okr", alice, bob });
    expect(result.transferredToAlice).toBe(true);
    expect(result.meetingId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.processStatus).toBe("approved");
    expect(result.progress).toBe(60);
    expect(result.changedTitle).toBe("发布课程与资料");
    expect(result.aliceTaskCount).toBeGreaterThan(0);
    expect(result.aliceOkrCount).toBe(1);
  });
});
