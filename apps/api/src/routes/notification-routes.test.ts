import Fastify from "fastify";
import { describe, expect, test, vi } from "vitest";
import type { DatabaseClient } from "../db/client.js";
import { initializeRequestContext, requestContext } from "../http/request-context.js";
import type { MutationCoordinator } from "../http/idempotency.js";
import type { NotificationPolicyService } from "../notifications/notification-policy-service.js";
import type { NotificationService } from "../notifications/notification-service.js";
import { registerNotificationRoutes } from "./notification-routes.js";

const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";
const notificationId = "84ecfe2e-c11a-4a56-8735-934955bef834";
const accountId = "35f503c2-a5d7-4250-a337-4f4fd03cf8df";
const principalId = "316324ee-4571-47c1-9a55-d30fdce16c02";
const record = {
  id: notificationId,
  organizationId,
  recipientAccountId: accountId,
  eventType: "emergency" as const,
  title: "紧急通知",
  body: "请立即处理",
  resourceType: null,
  resourceId: null,
  status: "unread" as const,
  createdAt: "2026-08-29T08:00:00.000Z",
  readAt: null,
};

async function fixture() {
  const app = Fastify();
  app.addHook("onRequest", async (request) => {
    initializeRequestContext(request, { clientIp: "127.0.0.1", proxyChain: [] });
  });
  const authenticate = async (request: Parameters<typeof requestContext>[0]) => {
    requestContext(request).identity = {
      accountId,
      principalId,
      sessionId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      actorSource: "cli",
      deviceMetadata: {
        name: "test",
        os: "test",
        architecture: "test",
        clientVersion: "test",
      },
    };
  };
  const notifications = {
    list: vi.fn().mockResolvedValue({ items: [record], nextCursor: null }),
    read: vi.fn().mockResolvedValue(record),
    markRead: vi.fn().mockResolvedValue({
      ...record,
      status: "read",
      readAt: "2026-08-29T08:01:00.000Z",
    }),
  };
  const policies = {
    getPreference: vi.fn().mockResolvedValue({
      organizationId,
      accountId,
      dailySummaryEnabled: true,
    }),
    setPreference: vi.fn(),
    getPolicy: vi.fn(),
    publish: vi.fn(),
  };
  const transaction = {};
  const sql = Object.assign(vi.fn(), {
    begin: (work: (tx: unknown) => unknown) => work(transaction),
  }) as unknown as DatabaseClient;
  const mutations = {
    executeIdempotent: vi.fn(async (input) => input.work(transaction)),
  } as unknown as MutationCoordinator;
  await registerNotificationRoutes(app, {
    sql,
    notifications: notifications as unknown as NotificationService,
    policies: policies as unknown as NotificationPolicyService,
    mutations,
    authenticate,
  });
  await app.ready();
  return { app, notifications, policies, mutations };
}

describe("notification routes", () => {
  test("mounts list, detail and mark-read on the organization API", async () => {
    const { app, notifications } = await fixture();
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/organizations/${organizationId}/notifications?status=unread`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/organizations/${organizationId}/notifications/${notificationId}`,
        })
      ).statusCode,
    ).toBe(200);
    const marked = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organizationId}/notifications/${notificationId}/read`,
      headers: { "idempotency-key": "read-1" },
      payload: {},
    });
    expect(marked.statusCode).toBe(200);
    expect(marked.json()).toMatchObject({ status: "read" });
    expect(notifications.markRead).toHaveBeenCalledWith(
      expect.anything(),
      accountId,
      organizationId,
      notificationId,
    );
    await app.close();
  });
});
