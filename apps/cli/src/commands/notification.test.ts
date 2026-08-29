import { describe, expect, test, vi } from "vitest";
import type { OrgSpaceClient } from "@tashan/sdk";
import { MemoryCredentialStore } from "../credentials/memory-store.js";
import { runCli } from "../program.js";

const dependencies = (client: OrgSpaceClient) => ({
  createClient: vi.fn(() => client),
  credentialStore: new MemoryCredentialStore(),
  deviceId: "3c5442ea-00e2-483b-9e81-2271e34120f1",
  environment: {},
});

describe("notification CLI", () => {
  test("only exposes the daily summary as a member opt-out", async () => {
    const updateNotificationPreference = vi.fn().mockResolvedValue({
      organizationId: "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
      accountId: "84ecfe2e-c11a-4a56-8735-934955bef834",
      dailySummaryEnabled: false,
    });
    const result = await runCli(
      [
        "notification",
        "preference-set",
        "--org",
        "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
        "--daily-summary",
        "off",
        "--yes",
        "--idempotency-key",
        "notify-pref-1",
      ],
      dependencies({ updateNotificationPreference } as unknown as OrgSpaceClient),
    );
    expect(result.exitCode).toBe(0);
    expect(updateNotificationPreference).toHaveBeenCalledWith(
      expect.any(String),
      { dailySummaryEnabled: false },
      { idempotencyKey: "notify-pref-1" },
    );
  });

  test("rejects invented mandatory-notification switches", async () => {
    const updateNotificationPreference = vi.fn();
    const result = await runCli(
      [
        "notification",
        "preference-set",
        "--org",
        "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
        "--daily-summary",
        "off",
        "--deadline-reminder",
        "off",
      ],
      dependencies({ updateNotificationPreference } as unknown as OrgSpaceClient),
    );
    expect(result.exitCode).toBe(2);
    expect(updateNotificationPreference).not.toHaveBeenCalled();
  });
});
