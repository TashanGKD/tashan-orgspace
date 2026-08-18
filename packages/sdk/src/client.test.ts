import { describe, expect, test, vi } from "vitest";

import { phase0Capabilities, type CapabilityId } from "@tashan/capabilities";

import { createOrgSpaceClient, OrgSpaceApiError } from "./client.js";
import { createFetchTransport, type Transport, type TransportRequest } from "./transport.js";

const deviceId = "35f503c2-a5d7-4250-a337-4f4fd03cf8df";
const accountId = "b228e557-2214-4f95-b49d-d4ff7d9759d4";
const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";

function response(status: number, body: unknown) {
  return { status, headers: new Headers(), body };
}

function captureTransport(result: ReturnType<typeof response>) {
  const requests: TransportRequest[] = [];
  const transport: Transport = async (request) => {
    requests.push(request);
    return result;
  };
  return { transport, requests };
}

function credentials() {
  let accessToken: string | undefined = "access-token";
  let refreshToken: string | undefined = "refresh-token-that-is-long-enough-123456";
  return {
    getAccessToken: () => accessToken,
    getRefreshToken: () => refreshToken,
    updateTokens: vi.fn((tokens: { accessToken: string; refreshToken: string }) => {
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
    }),
    clearTokens: vi.fn(() => {
      accessToken = undefined;
      refreshToken = undefined;
    }),
  };
}

function client(transport: Transport, credentialStore = credentials()) {
  return createOrgSpaceClient({
    transport,
    credentials: credentialStore,
    deviceId,
    clientChannel: "cli",
    invocationSource: "ai_via_cli",
  });
}

describe("typed SDK request boundary", () => {
  test("exposes one typed method for every Phase 0 capability", () => {
    const sdk = client(captureTransport(response(500, null)).transport);
    const methods = {
      "system.health.read": "health",
      "capability.list": "listCapabilities",
      "capability.describe": "describeCapability",
      "auth.phone.start": "startPhoneVerification",
      "auth.phone.confirm": "confirmPhoneVerification",
      "auth.register": "register",
      "auth.login": "login",
      "auth.refresh": "refresh",
      "auth.logout": "logout",
      "auth.whoami": "whoami",
      "device.list": "listDevices",
      "device.revoke": "revokeDevice",
      "organization.list": "listOrganizations",
      "organization.create": "createOrganization",
      "organization.member.list": "listMembers",
      "organization.member.add": "addMember",
      "audit.list": "listAuditEvents",
    } as const satisfies Record<CapabilityId, keyof typeof sdk>;

    expect(Object.keys(methods).sort()).toEqual(phase0Capabilities.map(({ id }) => id).sort());
    for (const method of Object.values(methods)) expect(sdk[method]).toBeTypeOf("function");
  });

  test("adds bearer, request, device, channel and idempotency headers", async () => {
    const { transport, requests } = captureTransport(
      response(201, {
        organization: {
          id: organizationId,
          name: "Tashan",
          status: "active",
          storageQuotaBytes: 536_870_912_000,
          createdAt: "2026-08-18T12:00:00.000Z",
        },
        membership: {
          id: "26c86c8e-7284-4051-b4aa-919b7540bb65",
          organizationId,
          accountId,
          username: "alice",
          role: "org_owner",
          status: "active",
          createdAt: "2026-08-18T12:00:00.000Z",
          updatedAt: "2026-08-18T12:00:00.000Z",
        },
      }),
    );
    await client(transport).createOrganization({ name: "Tashan" }, { idempotencyKey: "k1" });

    expect(requests[0]?.headers).toMatchObject({
      authorization: "Bearer access-token",
      "idempotency-key": "k1",
      "x-torg-device-id": deviceId,
      "x-torg-client-channel": "cli",
      "x-torg-invocation-source": "ai_via_cli",
    });
    expect(requests[0]?.headers["x-torg-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("decodes stable API errors", async () => {
    const { transport } = captureTransport(
      response(403, {
        error: {
          code: "ORG_FORBIDDEN",
          message: "organization access is forbidden",
          requestId: "bb310eb3-d828-4c4b-99fa-7e0f510cdb90",
        },
      }),
    );
    await expect(client(transport).listMembers(organizationId)).rejects.toEqual(
      expect.objectContaining<Partial<OrgSpaceApiError>>({
        code: "ORG_FORBIDDEN",
        status: 403,
      }),
    );
  });

  test("rejects malformed success payloads", async () => {
    const { transport } = captureTransport(response(200, { status: "maybe" }));
    await expect(client(transport).health()).rejects.toThrow("response schema validation failed");
  });

  test("refreshes at most once in one request chain", async () => {
    const store = credentials();
    const calls: TransportRequest[] = [];
    const transport: Transport = async (request) => {
      calls.push(request);
      if (request.path === "/v1/auth/refresh") {
        return response(200, {
          sessionId: "3c5442ea-00e2-483b-9e81-2271e34120f1",
          deviceId,
          tokens: {
            tokenType: "Bearer",
            accessToken: "new-access-token",
            accessTokenExpiresAt: "2026-08-18T12:15:00.000Z",
            refreshToken: "new-refresh-token-that-is-long-enough-123",
            refreshTokenExpiresAt: "2026-09-17T12:00:00.000Z",
          },
        });
      }
      return response(401, {
        error: {
          code: "AUTH_TOKEN_EXPIRED",
          message: "expired",
          requestId: "bb310eb3-d828-4c4b-99fa-7e0f510cdb90",
        },
      });
    };

    await expect(client(transport, store).whoami()).rejects.toMatchObject({
      code: "AUTH_TOKEN_EXPIRED",
    });
    expect(calls.map(({ path }) => path)).toEqual([
      "/v1/auth/whoami",
      "/v1/auth/refresh",
      "/v1/auth/whoami",
    ]);
    expect(store.updateTokens).toHaveBeenCalledTimes(1);
  });

  test("fetch transport enforces its finite timeout and honors an external abort", async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        await new Promise<void>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        });
        throw new Error("unreachable");
      },
    );
    const transport = createFetchTransport({
      baseUrl: "http://127.0.0.1:4110",
      timeoutMilliseconds: 1000,
      fetchImplementation,
    });
    try {
      const pending = transport({ method: "GET", path: "/v1/health", headers: {} });
      const timedOut = expect(pending).rejects.toThrow("OrgSpace request timed out");
      await vi.advanceTimersByTimeAsync(1000);
      await timedOut;

      const controller = new AbortController();
      const externallyAborted = transport({
        method: "GET",
        path: "/v1/health",
        headers: {},
        signal: controller.signal,
      });
      const aborted = expect(externallyAborted).rejects.toThrow("caller stopped");
      controller.abort(new Error("caller stopped"));
      await aborted;
    } finally {
      vi.useRealTimers();
    }
  });
});
