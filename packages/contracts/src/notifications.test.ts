import { describe, expect, test } from "vitest";
import {
  NotificationPreferenceUpdateRequest,
  NotificationPolicyPublishRequest,
} from "./notifications.js";
describe("notification contracts", () => {
  test("allows only daily summary opt-out", () => {
    expect(NotificationPreferenceUpdateRequest.parse({ dailySummaryEnabled: false })).toEqual({
      dailySummaryEnabled: false,
    });
    expect(() =>
      NotificationPreferenceUpdateRequest.parse({ approvalSmsEnabled: false }),
    ).toThrow();
  });
  test("validates organization timezones", () => {
    expect(
      NotificationPolicyPublishRequest.parse({ timezone: "Asia/Shanghai", expectedVersion: 1 }),
    ).toMatchObject({ timezone: "Asia/Shanghai" });
    expect(() =>
      NotificationPolicyPublishRequest.parse({ timezone: "Mars/Olympus", expectedVersion: 1 }),
    ).toThrow();
  });
});
