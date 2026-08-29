import { describe, expect, test } from "vitest";
import { registerAndVerify, runCliScenario } from "./support/flows.js";

describe("notifications", () => {
  test("runs notification, reminder, preference and policy journeys through the CLI", async () => {
    const alice = await registerAndVerify("notify-alice", "+8613800138471");
    const bob = await registerAndVerify("notify-bob", "+8613800138472");
    const result = await runCliScenario<{
      eventCounts: Record<string, number>;
      smsAttempts: number;
      explicitIdempotentCount: number;
      dailySummaryStatus: string;
      markedRead: boolean;
      recoveredExpiredLease: boolean;
      policyVersion: number;
      policyTimezone: string;
    }>({ type: "notifications", alice, bob });
    expect(result.eventCounts).toMatchObject({
      approval_requested: 1,
      emergency: 1,
      ordinary_task: 4,
      deadline_one_hour: 2,
      meeting_one_hour: 1,
      partner_follow_up: 1,
    });
    expect(result.smsAttempts).toBe(7);
    expect(result.explicitIdempotentCount).toBe(1);
    expect(result.dailySummaryStatus).toBe("cancelled");
    expect(result.markedRead).toBe(true);
    expect(result.recoveredExpiredLease).toBe(true);
    expect(result.policyVersion).toBe(2);
    expect(result.policyTimezone).toBe("America/New_York");
  });
});
