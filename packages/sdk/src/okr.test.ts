import { describe, expect, test } from "vitest";
import { createOrgSpaceClient } from "./client.js";

describe("OKR SDK", () => {
  test("exposes all OKR operations", () => {
    const client = createOrgSpaceClient({
      transport: async () => ({ status: 500, headers: new Headers(), body: {} }),
      credentials: {
        getAccessToken: () => "token",
        getRefreshToken: () => "refresh-token-long-enough",
        updateTokens: () => undefined,
        clearTokens: () => undefined,
      },
      deviceId: "b228e557-2214-4f95-b49d-d4ff7d9759d4",
      clientChannel: "cli",
      invocationSource: "ai_via_cli",
    });
    for (const method of [
      "listObjectives",
      "readObjective",
      "createObjective",
      "updateKeyResultProgress",
      "requestOkrChange",
      "approveOkrChange",
      "adminEditObjective",
    ] as const)
      expect(client[method]).toBeTypeOf("function");
  });
});
