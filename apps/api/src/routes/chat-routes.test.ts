import Fastify from "fastify";
import { describe, expect, test, vi } from "vitest";
import type { ChatService } from "../chat/chat-service.js";
import type { DatabaseClient } from "../db/client.js";
import type { MutationCoordinator } from "../http/idempotency.js";
import { initializeRequestContext, requestContext } from "../http/request-context.js";
import { registerChatRoutes } from "./chat-routes.js";

const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1",
  conversationId = "84ecfe2e-c11a-4a56-8735-934955bef834",
  accountId = "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
  principalId = "316324ee-4571-47c1-9a55-d30fdce16c02";
async function fixture() {
  const app = Fastify();
  app.addHook("onRequest", async (request) =>
    initializeRequestContext(request, { clientIp: "127.0.0.1", proxyChain: [] }),
  );
  const authenticate = async (request: Parameters<typeof requestContext>[0]) => {
    requestContext(request).identity = {
      accountId,
      principalId,
      sessionId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      actorSource: "cli",
      deviceMetadata: { name: "test", os: "test", architecture: "test", clientVersion: "test" },
    };
  };
  const conversation = {
    id: conversationId,
    organizationId,
    kind: "direct",
    title: null,
    createdByAccountId: accountId,
    nextSequence: 0,
    createdAt: "2026-08-29T08:00:00.000Z",
    updatedAt: "2026-08-29T08:00:00.000Z",
    members: [{ accountId, role: "member", joinedAt: "2026-08-29T08:00:00.000Z" }],
  };
  const chat = {
    listConversations: vi.fn().mockResolvedValue([conversation]),
    readConversation: vi.fn().mockResolvedValue(conversation),
    createDirect: vi.fn().mockResolvedValue(conversation),
    createGroup: vi.fn().mockResolvedValue({ ...conversation, kind: "group", title: "群聊" }),
    listMessages: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    sendMessage: vi.fn().mockResolvedValue({
      id: crypto.randomUUID(),
      conversationId,
      senderAccountId: accountId,
      clientMessageId: crypto.randomUUID(),
      sequence: 1,
      body: "你好",
      replyToMessageId: null,
      status: "active",
      editedAt: null,
      retractedAt: null,
      createdAt: "2026-08-29T08:00:00.000Z",
    }),
  };
  const transaction = {};
  const sql = Object.assign(vi.fn(), {
    begin: (work: (tx: unknown) => unknown) => work(transaction),
  }) as unknown as DatabaseClient;
  const mutations = {
    executeIdempotent: vi.fn(async (input) => input.work(transaction)),
  } as unknown as MutationCoordinator;
  await registerChatRoutes(app, {
    sql,
    chat: chat as unknown as ChatService,
    mutations,
    authenticate,
  });
  await app.ready();
  return { app, chat };
}
describe("chat routes", () => {
  test("mounts durable conversation, message and event history", async () => {
    const { app, chat } = await fixture();
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/organizations/${organizationId}/conversations`,
        })
      ).statusCode,
    ).toBe(200);
    const sent = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organizationId}/conversations/${conversationId}/messages`,
      headers: { "idempotency-key": "chat-send-1" },
      payload: { clientMessageId: crypto.randomUUID(), body: "你好" },
    });
    expect(sent.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/organizations/${organizationId}/conversations/${conversationId}/events?afterSequence=0`,
        })
      ).statusCode,
    ).toBe(200);
    expect(chat.sendMessage).toHaveBeenCalledOnce();
    await app.close();
  });
});
