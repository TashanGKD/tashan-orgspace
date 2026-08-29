import { z } from "zod";
import { AccountId, IsoDateTime, OrganizationId } from "./common.js";

export const ConversationKind = z.enum(["direct", "group"]);
export const ConversationDirectCreateRequest = z.object({ accountId: AccountId }).strict();
export const ConversationGroupCreateRequest = z
  .object({
    title: z.string().trim().min(1).max(200),
    memberAccountIds: z.array(AccountId).min(1).max(500),
  })
  .strict()
  .refine((value) => new Set(value.memberAccountIds).size === value.memberAccountIds.length, {
    message: "duplicate conversation member",
  });
export const ConversationMember = z
  .object({
    accountId: AccountId,
    role: z.enum(["owner", "member"]),
    joinedAt: IsoDateTime,
  })
  .strict();
export const Conversation = z
  .object({
    id: z.uuid(),
    organizationId: OrganizationId,
    kind: ConversationKind,
    title: z.string().nullable(),
    createdByAccountId: AccountId,
    nextSequence: z.number().int().min(0),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
    members: z.array(ConversationMember),
  })
  .strict();
export const ConversationReadResponse = Conversation;

export const ChatMessageSendRequest = z
  .object({
    clientMessageId: z.uuid(),
    body: z.string().trim().min(1).max(20_000),
    replyToMessageId: z.uuid().optional(),
  })
  .strict();
export const ChatMessageEditRequest = z
  .object({ body: z.string().trim().min(1).max(20_000) })
  .strict();
export const ChatReactionSetRequest = z
  .object({ emoji: z.string().trim().min(1).max(32), active: z.boolean() })
  .strict();
export const ChatMessage = z
  .object({
    id: z.uuid(),
    conversationId: z.uuid(),
    senderAccountId: AccountId,
    clientMessageId: z.uuid(),
    sequence: z.number().int().min(1),
    body: z.string().nullable(),
    replyToMessageId: z.uuid().nullable(),
    status: z.enum(["active", "retracted"]),
    editedAt: IsoDateTime.nullable(),
    retractedAt: IsoDateTime.nullable(),
    createdAt: IsoDateTime,
  })
  .strict();
export const ChatMessageListQuery = z
  .object({
    afterSequence: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export const ChatMessageListResponse = z
  .object({ items: z.array(ChatMessage), nextCursor: z.number().int().min(0).nullable() })
  .strict();

export const ChatEventType = z.enum([
  "message.sent",
  "message.edited",
  "message.retracted",
  "reaction.added",
  "reaction.removed",
]);
export const ChatEvent = z
  .object({
    id: z.uuid(),
    conversationId: z.uuid(),
    sequence: z.number().int().min(1),
    eventType: ChatEventType,
    messageId: z.uuid(),
    actorAccountId: AccountId,
    payload: z.record(z.string(), z.json()),
    createdAt: IsoDateTime,
  })
  .strict();
export const ChatEventListResponse = z
  .object({ items: z.array(ChatEvent), nextCursor: z.number().int().min(0).nullable() })
  .strict();
export const ChatReactionResponse = z
  .object({
    messageId: z.uuid(),
    accountId: AccountId,
    emoji: z.string(),
    active: z.boolean(),
    sequence: z.number().int().min(1).nullable(),
  })
  .strict();
