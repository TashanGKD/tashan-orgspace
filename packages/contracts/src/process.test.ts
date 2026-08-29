import { describe, expect, test } from "vitest";

import {
  ProcessDefinitionCreateRequest,
  ProcessDecisionRequest,
  ProcessVersionCreateRequest,
} from "./process.js";

const bob = "84ecfe2e-c11a-4a56-8735-934955bef834";
const charlie = "746fb70b-a27e-4a78-a231-aa55ef8c343e";

describe("process contracts", () => {
  test("accepts approved modes and decisions", () => {
    expect(
      ProcessDefinitionCreateRequest.parse({
        name: "Expense",
        mode: "sequence",
        approverAccountIds: [bob, charlie],
      }),
    ).toMatchObject({ mode: "sequence" });
    expect(
      ProcessVersionCreateRequest.parse({
        mode: "all",
        approverAccountIds: [bob, charlie],
        expectedDefinitionVersion: 1,
      }),
    ).toMatchObject({ mode: "all" });
    expect(
      ProcessDecisionRequest.parse({
        action: "transfer",
        targetAccountId: charlie,
        reason: "Specialist",
        expectedVersion: 1,
      }),
    ).toMatchObject({ action: "transfer" });
  });

  test.each([
    { name: "Single", mode: "single", approverAccountIds: [bob, charlie] },
    { name: "Any", mode: "any", approverAccountIds: [] },
    { name: "Duplicate", mode: "all", approverAccountIds: [bob, bob] },
  ])("rejects invalid definition %#", (input) => {
    expect(() => ProcessDefinitionCreateRequest.parse(input)).toThrow();
  });

  test("requires a transfer target and non-empty reason", () => {
    expect(() =>
      ProcessDecisionRequest.parse({ action: "transfer", reason: " ", expectedVersion: 1 }),
    ).toThrow();
  });
});
