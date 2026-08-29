import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { CapabilityId } from "@tashan/capabilities";
import {
  ChatEventListResponse,
  ChatMessageEditRequest,
  ChatMessageListQuery,
  ChatMessageListResponse,
  ChatMessageSendRequest,
  ChatReactionResponse,
  ChatReactionSetRequest,
  ConversationDirectCreateRequest,
  ConversationGroupCreateRequest,
  ConversationListResponse,
  ConversationReadResponse,
} from "@tashan/contracts";
import type { ChatService } from "../chat/chat-service.js";
import type { DatabaseClient } from "../db/client.js";
import type { MutationCoordinator } from "../http/idempotency.js";
import { requestContext } from "../http/request-context.js";

const OrganizationPath = z.object({ organizationId: z.uuid() }).strict();
const ConversationPath = OrganizationPath.extend({ conversationId: z.uuid() }).strict();
const MessagePath = ConversationPath.extend({ messageId: z.uuid() }).strict();
function identity(request: FastifyRequest) {
  const value = requestContext(request).identity;
  if (!value) throw new Error("authenticated identity is missing");
  return value;
}
export async function registerChatRoutes(
  app: FastifyInstance,
  dependencies: {
    sql: DatabaseClient;
    chat: ChatService;
    mutations: MutationCoordinator;
    authenticate: preHandlerHookHandler;
  },
) {
  const mutate = async (
    request: FastifyRequest,
    capabilityId: CapabilityId,
    input: unknown,
    work: Parameters<MutationCoordinator["executeIdempotent"]>[0]["work"],
  ) =>
    (
      await dependencies.mutations.executeIdempotent({
        request,
        capabilityId,
        actorPrincipalId: identity(request).principalId,
        idempotencyInput: input,
        work,
      })
    ).body;
  const context = (request: FastifyRequest, organizationId: string) => {
    requestContext(request).organizationId = organizationId;
    return identity(request).accountId;
  };

  app.get(
    "/v1/organizations/:organizationId/conversations",
    { config: { capabilityId: "chat.conversation.list" }, preHandler: dependencies.authenticate },
    async (request) => {
      const path = OrganizationPath.parse(request.params);
      return dependencies.sql.begin(async (tx) =>
        ConversationListResponse.parse({
          items: await dependencies.chat.listConversations(
            tx,
            context(request, path.organizationId),
            path.organizationId,
          ),
          nextCursor: null,
        }),
      );
    },
  );
  app.get(
    "/v1/organizations/:organizationId/conversations/:conversationId",
    { config: { capabilityId: "chat.conversation.read" }, preHandler: dependencies.authenticate },
    async (request) => {
      const path = ConversationPath.parse(request.params);
      return dependencies.sql.begin(async (tx) =>
        ConversationReadResponse.parse(
          await dependencies.chat.readConversation(
            tx,
            context(request, path.organizationId),
            path.organizationId,
            path.conversationId,
          ),
        ),
      );
    },
  );
  for (const [kind, schema, capabilityId] of [
    ["direct", ConversationDirectCreateRequest, "chat.conversation.direct.create"],
    ["group", ConversationGroupCreateRequest, "chat.conversation.group.create"],
  ] as const) {
    app.post(
      `/v1/organizations/:organizationId/conversations/${kind}`,
      { config: { capabilityId }, preHandler: dependencies.authenticate },
      async (request, reply) => {
        const path = OrganizationPath.parse(request.params),
          body = schema.parse(request.body),
          accountId = context(request, path.organizationId);
        const result = await mutate(request, capabilityId, { ...path, ...body }, async (tx) => ({
          statusCode: 201,
          body: ConversationReadResponse.parse(
            kind === "direct"
              ? await dependencies.chat.createDirect(tx, accountId, path.organizationId, body)
              : await dependencies.chat.createGroup(tx, accountId, path.organizationId, body),
          ),
        }));
        return reply.code(201).send(result);
      },
    );
  }
  app.get(
    "/v1/organizations/:organizationId/conversations/:conversationId/messages",
    { config: { capabilityId: "chat.message.list" }, preHandler: dependencies.authenticate },
    async (request) => {
      const path = ConversationPath.parse(request.params),
        query = ChatMessageListQuery.parse(request.query);
      return dependencies.sql.begin(async (tx) =>
        ChatMessageListResponse.parse(
          await dependencies.chat.listMessages(
            tx,
            context(request, path.organizationId),
            path.organizationId,
            path.conversationId,
            query,
          ),
        ),
      );
    },
  );
  app.get(
    "/v1/organizations/:organizationId/conversations/:conversationId/events",
    { config: { capabilityId: "chat.event.list" }, preHandler: dependencies.authenticate },
    async (request) => {
      const path = ConversationPath.parse(request.params),
        query = ChatMessageListQuery.parse(request.query);
      return dependencies.sql.begin(async (tx) =>
        ChatEventListResponse.parse(
          await dependencies.chat.listEvents(
            tx,
            context(request, path.organizationId),
            path.organizationId,
            path.conversationId,
            query,
          ),
        ),
      );
    },
  );
  app.post(
    "/v1/organizations/:organizationId/conversations/:conversationId/messages",
    { config: { capabilityId: "chat.message.send" }, preHandler: dependencies.authenticate },
    async (request, reply) => {
      const path = ConversationPath.parse(request.params),
        body = ChatMessageSendRequest.parse(request.body),
        accountId = context(request, path.organizationId);
      const result = await mutate(
        request,
        "chat.message.send",
        { ...path, ...body },
        async (tx) => ({
          statusCode: 201,
          body: await dependencies.chat.sendMessage(
            tx,
            accountId,
            path.organizationId,
            path.conversationId,
            body,
          ),
        }),
      );
      return reply.code(201).send(result);
    },
  );
  for (const [action, capabilityId] of [
    ["edit", "chat.message.edit"],
    ["retract", "chat.message.retract"],
    ["reaction", "chat.message.reaction.set"],
  ] as const) {
    app.post(
      `/v1/organizations/:organizationId/conversations/:conversationId/messages/:messageId/${action}`,
      { config: { capabilityId }, preHandler: dependencies.authenticate },
      async (request) => {
        const path = MessagePath.parse(request.params),
          accountId = context(request, path.organizationId);
        const body =
          action === "edit"
            ? ChatMessageEditRequest.parse(request.body)
            : action === "reaction"
              ? ChatReactionSetRequest.parse(request.body)
              : z
                  .object({})
                  .strict()
                  .parse(request.body ?? {});
        return mutate(request, capabilityId, { ...path, ...body }, async (tx) => ({
          statusCode: 200,
          body:
            action === "edit"
              ? await dependencies.chat.editMessage(
                  tx,
                  accountId,
                  path.organizationId,
                  path.conversationId,
                  path.messageId,
                  body,
                )
              : action === "retract"
                ? await dependencies.chat.retractMessage(
                    tx,
                    accountId,
                    path.organizationId,
                    path.conversationId,
                    path.messageId,
                  )
                : ChatReactionResponse.parse(
                    await dependencies.chat.setReaction(
                      tx,
                      accountId,
                      path.organizationId,
                      path.conversationId,
                      path.messageId,
                      body,
                    ),
                  ),
        }));
      },
    );
  }
}
