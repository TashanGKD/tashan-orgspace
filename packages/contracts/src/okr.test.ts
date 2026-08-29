import { describe, expect, test } from "vitest";

import { ObjectiveCreateRequest, OkrChangeRequest, OkrProgressUpdateRequest } from "./okr.js";

const taskId = "84ecfe2e-c11a-4a56-8735-934955bef834";

describe("OKR contracts", () => {
  test("accepts numeric, manual and linked-task formulas", () => {
    expect(
      ObjectiveCreateRequest.parse({
        title: "Publish program",
        cycle: "2026-Q3",
        keyResults: [
          { title: "Draft", weight: 40, formula: { type: "numeric", start: 0, target: 10 } },
          { title: "Quality", weight: 30, formula: { type: "manual" } },
          {
            title: "Delivery",
            weight: 30,
            formula: { type: "linked_tasks", workItemIds: [taskId] },
          },
        ],
      }),
    ).toMatchObject({ cycle: "2026-Q3" });
    expect(OkrProgressUpdateRequest.parse({ progress: 62, expectedVersion: 1 })).toMatchObject({
      progress: 62,
    });
    expect(
      OkrChangeRequest.parse({
        patch: { title: "New title", cycle: "2026-Q4" },
        expectedVersion: 1,
      }),
    ).toMatchObject({ expectedVersion: 1 });
  });

  test.each([
    {
      title: "Bad",
      cycle: "Q",
      keyResults: [{ title: "Only", weight: 99, formula: { type: "manual" } }],
    },
    {
      title: "Bad",
      cycle: "Q",
      keyResults: [
        { title: "Only", weight: 100, formula: { type: "numeric", start: 1, target: 1 } },
      ],
    },
    {
      title: "Bad",
      cycle: "Q",
      keyResults: [
        { title: "Only", weight: 100, formula: { type: "linked_tasks", workItemIds: [] } },
      ],
    },
  ])("rejects invalid formulas and weights %#", (input) => {
    expect(() => ObjectiveCreateRequest.parse(input)).toThrow();
  });
});
