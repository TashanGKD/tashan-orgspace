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
export const ConversationListResponse = z
  .object({ items: z.array(Conversation), nextCursor: z.null() })
  .strict();

export const ChatAttachment = z.discriminatedUnion("type", [
  z.object({ type: z.literal("file"), spaceId: z.uuid(), entryId: z.uuid() }).strict(),
  z.object({ type: z.enum(["task", "meeting", "approval"]), workItemId: z.uuid() }).strict(),
]);

export const ChatMessageSendRequest = z
  .object({
    clientMessageId: z.uuid(),
    body: z.string().trim().min(1).max(20_000),
    replyToMessageId: z.uuid().optional(),
    attachments: z.array(ChatAttachment).max(20).default([]),
    mentionAccountIds: z.array(AccountId).max(100).default([]),
  })
  .strict()
  .refine((value) => new Set(value.mentionAccountIds).size === value.mentionAccountIds.length, {
    message: "duplicate mentioned account",
  });
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
    attachments: z.array(ChatAttachment),
    mentionAccountIds: z.array(AccountId),
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

export const ChatMessageConvertRequest = z
  .object({
    type: z.enum(["task", "meeting", "approval"]),
    title: z.string().trim().min(1).max(200),
    assigneeAccountIds: z.array(AccountId).max(100).default([]),
    dueAt: IsoDateTime.optional(),
    meetingStartsAt: IsoDateTime.optional(),
    sendSms: z.boolean().default(false),
  })
  .strict()
  .refine((value) => value.type !== "meeting" || value.meetingStartsAt !== undefined, {
    message: "meeting start time is required",
  });

export const ChatComplianceReviewRequest = z
  .object({
    conversationId: z.uuid(),
    reason: z.string().trim().min(10).max(2_000),
    startsAt: IsoDateTime,
    endsAt: IsoDateTime,
  })
  .strict()
  .refine((value) => {
    const start = Date.parse(value.startsAt),
      end = Date.parse(value.endsAt);
    return end > start && end - start <= 31 * 24 * 60 * 60 * 1_000;
  }, "compliance window must be positive and no longer than 31 days");
export const ChatComplianceReview = z
  .object({
    id: z.uuid(),
    organizationId: OrganizationId,
    conversationId: z.uuid(),
    requestedByAccountId: AccountId,
    reason: z.string(),
    startsAt: IsoDateTime,
    endsAt: IsoDateTime,
    createdAt: IsoDateTime,
  })
  .strict();
export const ChatComplianceEvent = z
  .object({
    id: z.uuid(),
    sequence: z.number().int().min(1),
    eventType: ChatEventType,
    messageId: z.uuid(),
    actorAccountId: AccountId,
    body: z.string().nullable(),
    createdAt: IsoDateTime,
  })
  .strict();
export const ChatComplianceReviewResponse = z
  .object({ review: ChatComplianceReview, events: z.array(ChatComplianceEvent) })
  .strict();

export type ChatAttachment = z.infer<typeof ChatAttachment>;
