import { describe, expect, test } from "vitest";

import { WorkItemCreateRequest, WorkItemTransitionRequest } from "./work.js";

const accountId = "84ecfe2e-c11a-4a56-8735-934955bef834";
const assignmentId = "746fb70b-a27e-4a78-a231-aa55ef8c343e";

describe("work contracts", () => {
  test("accepts the approved work item and transition shapes", () => {
    expect(
      WorkItemCreateRequest.parse({
        type: "task",
        title: "Prepare agenda",
        description: "Draft and circulate",
        priority: "normal",
        dueAt: "2026-08-30T08:00:00.000Z",
        assigneeAccountIds: [accountId],
      }),
    ).toMatchObject({ type: "task" });
    expect(
      WorkItemTransitionRequest.parse({
        action: "request_transfer",
        assignmentId,
        targetAccountId: accountId,
        reason: "Schedule conflict",
        expectedVersion: 2,
      }),
    ).toMatchObject({ action: "request_transfer" });
  });

  test.each([
    { type: "meeting", title: "Meeting", priority: "normal", assigneeAccountIds: [] },
    { type: "task", title: "", priority: "normal", assigneeAccountIds: [] },
    { type: "task", title: "Task", priority: "normal", assigneeAccountIds: [accountId, accountId] },
  ])("rejects invalid create input %#", (input) => {
    expect(() => WorkItemCreateRequest.parse(input)).toThrow();
  });

  test("rejects stale-shaped and empty-reason transitions", () => {
    expect(() =>
      WorkItemTransitionRequest.parse({
        action: "dispute",
        assignmentId,
        reason: " ",
        expectedVersion: 0,
      }),
    ).toThrow();
  });
});
