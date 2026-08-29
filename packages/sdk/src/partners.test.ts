import { describe, expect, test } from "vitest";
import { createOrgSpaceClient } from "./client.js";
describe("partner SDK", () => {
  test("exposes every partner operation", () => {
    const client = createOrgSpaceClient({
      transport: async () => ({ status: 500, headers: new Headers(), body: {} }),
      credentials: {
        getAccessToken: () => "token",
        getRefreshToken: () => "long-refresh-token-value",
        updateTokens: () => undefined,
        clearTokens: () => undefined,
      },
      deviceId: "b228e557-2214-4f95-b49d-d4ff7d9759d4",
      clientChannel: "cli",
      invocationSource: "ai_via_cli",
    });
    for (const name of [
      "listPartners",
      "readPartner",
      "createPartner",
      "updatePartner",
      "archivePartner",
      "restorePartner",
      "transferPartner",
      "bulkTransferPartners",
      "listPartnerDuplicates",
      "listAwaitingPartners",
      "readPartnerContact",
      "listPartnerInteractions",
      "addPartnerInteraction",
      "correctPartnerInteraction",
      "linkPartnerResource",
      "unlinkPartnerResource",
      "exportPartners",
    ] as const)
      expect(client[name]).toBeTypeOf("function");
  });
});
