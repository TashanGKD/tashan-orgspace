import { describe, expect, test, vi } from "vitest";
import { createOrgSpaceClient } from "./client.js";

describe("notification SDK", () => {
  test("uses the notification API contract and validates mandatory preference fields", async () => {
    const requests: Array<{ path: string; body?: unknown }> = [];
    const client = createOrgSpaceClient({
      transport: async (request) => {
        requests.push({ path: request.path, body: request.body });
        return {
          status: 200,
          headers: new Headers(),
          body: {
            organizationId: "95d5579d-a32d-4650-aec4-318ff3a55df1",
            accountId: "84ecfe2e-c11a-4a56-8735-934955bef834",
            dailySummaryEnabled: false,
          },
        };
      },
      credentials: {
        getAccessToken: () => "token",
        getRefreshToken: vi.fn(),
        updateTokens: vi.fn(),
        clearTokens: vi.fn(),
      },
      deviceId: "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
      clientChannel: "cli",
      invocationSource: "ai_via_cli",
    });
    await client.updateNotificationPreference(
      "95d5579d-a32d-4650-aec4-318ff3a55df1",
      { dailySummaryEnabled: false },
      { idempotencyKey: "preference-1" },
    );
    expect(requests).toEqual([
      {
        path: "/v1/organizations/95d5579d-a32d-4650-aec4-318ff3a55df1/notification-preference",
        body: { dailySummaryEnabled: false },
      },
    ]);
    expect(() =>
      client.updateNotificationPreference(
        "95d5579d-a32d-4650-aec4-318ff3a55df1",
        { dailySummaryEnabled: false, deadlineOneHourEnabled: false },
        { idempotencyKey: "preference-2" },
      ),
    ).toThrow();
  });
});
