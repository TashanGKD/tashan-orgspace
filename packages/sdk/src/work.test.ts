import { describe, expect, test } from "vitest";

import { createOrgSpaceClient } from "./client.js";
import type { TransportRequest } from "./transport.js";

const organizationId = "35f503c2-a5d7-4250-a337-4f4fd03cf8df";
const workItemId = "84ecfe2e-c11a-4a56-8735-934955bef834";
const instanceId = "746fb70b-a27e-4a78-a231-aa55ef8c343e";

describe("work SDK", () => {
  test("uses explicit organization-scoped work and process paths", async () => {
    const requests: TransportRequest[] = [];
    const client = createOrgSpaceClient({
      transport: async (request) => {
        requests.push(request);
        return { status: 200, headers: new Headers(), body: { items: [], nextCursor: null } };
      },
      credentials: {
        getAccessToken: () => "token",
        getRefreshToken: () => "refresh-token-that-is-long-enough",
        updateTokens: () => undefined,
        clearTokens: () => undefined,
      },
      deviceId: "b228e557-2214-4f95-b49d-d4ff7d9759d4",
      clientChannel: "cli",
      invocationSource: "ai_via_cli",
    });
    await client.listWorkItems(organizationId, {});
    expect(requests[0]?.path).toBe(`/v1/organizations/${organizationId}/work-items?limit=50`);
    expect(client.readWorkItem).toBeTypeOf("function");
    expect(client.createWorkItem).toBeTypeOf("function");
    expect(client.transitionWorkItem).toBeTypeOf("function");
    expect(client.createProcessDefinition).toBeTypeOf("function");
    expect(client.createProcessVersion).toBeTypeOf("function");
    expect(client.publishProcessVersion).toBeTypeOf("function");
    expect(client.startProcessInstance).toBeTypeOf("function");
    expect(client.readProcessInstance).toBeTypeOf("function");
    expect(client.decideProcessInstance).toBeTypeOf("function");
    expect(workItemId).toMatch(/-/);
    expect(instanceId).toMatch(/-/);
  });
});
