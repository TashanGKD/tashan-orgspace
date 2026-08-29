import { createHash, randomUUID } from "node:crypto";
import type { JSONValue } from "postgres";
import {
  ChatEvent,
  ChatMessage,
  ChatMessageConvertRequest,
  ChatMessageEditRequest,
  ChatMessageListQuery,
  ChatMessageSendRequest,
  ChatReactionSetRequest,
  Conversation,
  ConversationDirectCreateRequest,
  ConversationGroupCreateRequest,
  type ChatAttachment,
} from "@tashan/contracts";
import { AuthError } from "../auth/auth-errors.js";
import type { TransactionClient } from "../db/transaction.js";
import { requireChatOrganizationMember, requireConversationAccess } from "./chat-authorization.js";
import { requireFilePermission } from "../files/file-authorization.js";
import { WorkService } from "../work/work-service.js";

interface ConversationRow {
  id: string;
  organization_id: string;
  kind: "direct" | "group";
  title: string | null;
  created_by_account_id: string;
  next_sequence: number | string;
  created_at: Date;
  updated_at: Date;
}
interface MessageRow {
  id: string;
  conversation_id: string;
  sender_account_id: string;
  client_message_id: string;
  client_payload_hash: string;
  sequence: number | string;
  body: string | null;
  reply_to_message_id: string | null;
  status: "active" | "retracted";
  edited_at: Date | null;
  retracted_at: Date | null;
  created_at: Date;
}
interface EventRow {
  id: string;
  conversation_id: string;
  sequence: number | string;
  event_type:
    "message.sent" | "message.edited" | "message.retracted" | "reaction.added" | "reaction.removed";
  message_id: string;
  actor_account_id: string;
  payload: Record<string, JSONValue>;
  created_at: Date;
}
const message = (row: MessageRow, attachments: ChatAttachment[]) =>
  ChatMessage.parse({
    id: row.id,
    conversationId: row.conversation_id,
    senderAccountId: row.sender_account_id,
    clientMessageId: row.client_message_id,
    sequence: Number(row.sequence),
    body: row.body,
    replyToMessageId: row.reply_to_message_id,
    status: row.status,
    editedAt: row.edited_at?.toISOString() ?? null,
    retractedAt: row.retracted_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    attachments,
  });
const event = (row: EventRow) =>
  ChatEvent.parse({
    id: row.id,
    conversationId: row.conversation_id,
    sequence: Number(row.sequence),
    eventType: row.event_type,
    messageId: row.message_id,
    actorAccountId: row.actor_account_id,
    payload: row.payload,
    createdAt: row.created_at.toISOString(),
  });
function payloadHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class ChatService {
  private readonly work = new WorkService();
  private async attachments(tx: TransactionClient, messageId: string): Promise<ChatAttachment[]> {
    const rows = await tx<
      {
        attachment_type: "file" | "task" | "meeting" | "approval";
        target_id: string;
        space_id: string | null;
      }[]
    >`select attachment_type,target_id,space_id from chat_message_attachments where message_id=${messageId} order by position`;
    return rows.map((row) =>
      row.attachment_type === "file"
        ? { type: "file", spaceId: row.space_id!, entryId: row.target_id }
        : { type: row.attachment_type, workItemId: row.target_id },
    );
  }
  private async publicMessage(tx: TransactionClient, row: MessageRow) {
    return message(row, await this.attachments(tx, row.id));
  }
  private async state(tx: TransactionClient, conversationId: string) {
    const [row] = await tx<
      ConversationRow[]
    >`select * from conversations where id=${conversationId}`;
    if (!row) throw new AuthError("CHAT_NOT_FOUND", "conversation was not found");
    const members = await tx<{ account_id: string; role: "owner" | "member"; joined_at: Date }[]>`
      select account_id,role,joined_at from conversation_members
      where conversation_id=${conversationId} and left_at is null order by joined_at,account_id
    `;
    return Conversation.parse({
      id: row.id,
      organizationId: row.organization_id,
      kind: row.kind,
      title: row.title,
      createdByAccountId: row.created_by_account_id,
      nextSequence: Number(row.next_sequence),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      members: members.map((member) => ({
        accountId: member.account_id,
        role: member.role,
        joinedAt: member.joined_at.toISOString(),
      })),
    });
  }
  public async createDirect(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    raw: unknown,
  ) {
    const input = ConversationDirectCreateRequest.parse(raw);
    if (input.accountId === accountId)
      throw new AuthError("CHAT_CONFLICT", "direct chat requires another member");
    await requireChatOrganizationMember(tx, accountId, organizationId);
    await requireChatOrganizationMember(tx, input.accountId, organizationId);
    const directKey = [accountId, input.accountId].sort().join(":");
    const id = randomUUID();
    await tx`
      insert into conversations(id,organization_id,kind,direct_key,created_by_account_id)
      values(${id},${organizationId},'direct',${directKey},${accountId})
      on conflict(organization_id,direct_key) where kind='direct' do nothing
    `;
    const [conversation] = await tx<{ id: string }[]>`
      select id from conversations where organization_id=${organizationId} and direct_key=${directKey}
    `;
    if (!conversation) throw new Error("direct conversation insert failed");
    for (const memberId of [accountId, input.accountId])
      await tx`insert into conversation_members(conversation_id,account_id,role)values(${conversation.id},${memberId},'member')on conflict(conversation_id,account_id)do update set left_at=null`;
    await tx`insert into collaboration_resources(organization_id,resource_type,resource_id)values(${organizationId},'conversation',${conversation.id})on conflict(resource_type,resource_id)do nothing`;
    return this.state(tx, conversation.id);
  }
  public async createGroup(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    raw: unknown,
  ) {
    const input = ConversationGroupCreateRequest.parse(raw);
    await requireChatOrganizationMember(tx, accountId, organizationId);
    for (const memberId of input.memberAccountIds)
      await requireChatOrganizationMember(tx, memberId, organizationId);
    const id = randomUUID();
    await tx`insert into conversations(id,organization_id,kind,title,created_by_account_id)values(${id},${organizationId},'group',${input.title},${accountId})`;
    const members = [...new Set([accountId, ...input.memberAccountIds])];
    for (const memberId of members)
      await tx`insert into conversation_members(conversation_id,account_id,role)values(${id},${memberId},${memberId === accountId ? "owner" : "member"})`;
    await tx`insert into collaboration_resources(organization_id,resource_type,resource_id)values(${organizationId},'conversation',${id})`;
    return this.state(tx, id);
  }
  public async readConversation(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    conversationId: string,
  ) {
    await requireConversationAccess(tx, accountId, organizationId, conversationId);
    return this.state(tx, conversationId);
  }
  public async listConversations(tx: TransactionClient, accountId: string, organizationId: string) {
    await requireChatOrganizationMember(tx, accountId, organizationId);
    const rows = await tx<{ id: string }[]>`
      select conversation.id from conversations conversation
      join conversation_members member on member.conversation_id=conversation.id
      where conversation.organization_id=${organizationId} and member.account_id=${accountId}
        and member.left_at is null
      order by conversation.updated_at desc,conversation.id
    `;
    return Promise.all(rows.map((row) => this.state(tx, row.id)));
  }
  private async nextSequence(tx: TransactionClient, conversationId: string) {
    const [row] = await tx<{ next_sequence: number | string }[]>`
      update conversations set next_sequence=next_sequence+1,updated_at=now()
      where id=${conversationId} returning next_sequence
    `;
    if (!row) throw new AuthError("CHAT_NOT_FOUND", "conversation was not found");
    return Number(row.next_sequence);
  }
  private async appendEvent(
    tx: TransactionClient,
    input: {
      conversationId: string;
      sequence: number;
      eventType: EventRow["event_type"];
      messageId: string;
      actorAccountId: string;
      payload: Record<string, JSONValue>;
    },
  ) {
    const [row] = await tx<EventRow[]>`
      insert into chat_events(conversation_id,sequence,event_type,message_id,actor_account_id,payload)
      values(${input.conversationId},${input.sequence},${input.eventType},${input.messageId},${input.actorAccountId},${tx.json(input.payload)}) returning *
    `;
    if (!row) throw new Error("chat event insert failed");
    return event(row);
  }
  public async sendMessage(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    conversationId: string,
    raw: unknown,
  ) {
    const input = ChatMessageSendRequest.parse(raw);
    await requireConversationAccess(tx, accountId, organizationId, conversationId);
    const hash = payloadHash(input);
    await tx`select pg_advisory_xact_lock(hashtextextended(${`${conversationId}:${input.clientMessageId}`},0))`;
    const [existing] = await tx<MessageRow[]>`
      select * from chat_messages where conversation_id=${conversationId} and client_message_id=${input.clientMessageId}
    `;
    if (existing) {
      if (existing.client_payload_hash !== hash)
        throw new AuthError("CHAT_CONFLICT", "client message ID was reused with different content");
      return this.publicMessage(tx, existing);
    }
    if (input.replyToMessageId) {
      const [reply] = await tx<
        { id: string }[]
      >`select id from chat_messages where conversation_id=${conversationId} and id=${input.replyToMessageId}`;
      if (!reply) throw new AuthError("CHAT_CONFLICT", "reply target is unavailable");
    }
    const sequence = await this.nextSequence(tx, conversationId),
      id = randomUUID();
    const [row] = await tx<MessageRow[]>`
      insert into chat_messages(id,conversation_id,sender_account_id,client_message_id,client_payload_hash,sequence,body,reply_to_message_id)
      values(${id},${conversationId},${accountId},${input.clientMessageId},${hash},${sequence},${input.body},${input.replyToMessageId ?? null}) returning *
    `;
    if (!row) throw new Error("chat message insert failed");
    await tx`insert into collaboration_resources(organization_id,resource_type,resource_id)values(${organizationId},'message',${id})`;
    await this.storeAttachments(
      tx,
      organizationId,
      conversationId,
      id,
      accountId,
      input.attachments,
    );
    await this.appendEvent(tx, {
      conversationId,
      sequence,
      eventType: "message.sent",
      messageId: id,
      actorAccountId: accountId,
      payload: {
        body: input.body,
        replyToMessageId: input.replyToMessageId ?? null,
        attachmentCount: input.attachments.length,
      },
    });
    return this.publicMessage(tx, row);
  }
  private async storeAttachments(
    tx: TransactionClient,
    organizationId: string,
    conversationId: string,
    messageId: string,
    actorAccountId: string,
    attachments: ChatAttachment[],
  ) {
    const members = await tx<{ account_id: string }[]>`
      select account_id from conversation_members where conversation_id=${conversationId} and left_at is null
    `;
    for (const [position, attachment] of attachments.entries()) {
      const targetType = attachment.type === "file" ? "file" : "work_item";
      const targetId = attachment.type === "file" ? attachment.entryId : attachment.workItemId;
      if (attachment.type === "file") {
        for (const member of members) {
          try {
            await requireFilePermission(tx, {
              accountId: member.account_id,
              spaceId: attachment.spaceId,
              entryId: attachment.entryId,
              permission: "read",
            });
          } catch (error) {
            if (error instanceof AuthError)
              throw new AuthError("CHAT_FORBIDDEN", "attachment is not readable by every member");
            throw error;
          }
        }
      } else {
        const [work] = await tx<{ id: string; type: string }[]>`
          select id,type from work_items where id=${attachment.workItemId} and organization_id=${organizationId}
        `;
        if (!work || work.type !== attachment.type)
          throw new AuthError("CHAT_FORBIDDEN", "attached work item is unavailable");
      }
      const [resource] = await tx<{ exists: boolean }[]>`
        select exists(select 1 from collaboration_resources where organization_id=${organizationId} and resource_type=${targetType} and resource_id=${targetId}) exists
      `;
      if (!resource?.exists) throw new AuthError("CHAT_FORBIDDEN", "attachment is unavailable");
      await tx`
        insert into chat_message_attachments(message_id,position,attachment_type,target_id,space_id)
        values(${messageId},${position},${attachment.type},${targetId},${attachment.type === "file" ? attachment.spaceId : null})
      `;
      await tx`
        insert into resource_links(organization_id,source_type,source_id,target_type,target_id,relation_type,created_by_account_id)
        values(${organizationId},'message',${messageId},${targetType},${targetId},'attachment',${actorAccountId})
        on conflict do nothing
      `;
      await tx`
        insert into resource_links(organization_id,source_type,source_id,target_type,target_id,relation_type,created_by_account_id)
        values(${organizationId},${targetType},${targetId},'message',${messageId},'attached_by_message',${actorAccountId})
        on conflict do nothing
      `;
    }
  }
  public async listMessages(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    conversationId: string,
    raw: unknown,
  ) {
    const input = ChatMessageListQuery.parse(raw);
    await requireConversationAccess(tx, accountId, organizationId, conversationId);
    const rows = await tx<
      MessageRow[]
    >`select * from chat_messages where conversation_id=${conversationId} and sequence>${input.afterSequence} order by sequence,id limit ${input.limit}`;
    return {
      items: await Promise.all(rows.map((row) => this.publicMessage(tx, row))),
      nextCursor: rows.length === input.limit ? Number(rows.at(-1)!.sequence) : null,
    };
  }
  private async ownedActiveMessage(
    tx: TransactionClient,
    accountId: string,
    conversationId: string,
    messageId: string,
  ) {
    const [row] = await tx<
      MessageRow[]
    >`select * from chat_messages where id=${messageId} and conversation_id=${conversationId}`;
    if (!row) throw new AuthError("CHAT_NOT_FOUND", "message was not found");
    if (row.sender_account_id !== accountId)
      throw new AuthError("CHAT_FORBIDDEN", "message can only be changed by its sender");
    if (row.status !== "active")
      throw new AuthError("CHAT_CONFLICT", "message is already retracted");
    return row;
  }
  public async editMessage(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    conversationId: string,
    messageId: string,
    raw: unknown,
  ) {
    const input = ChatMessageEditRequest.parse(raw);
    await requireConversationAccess(tx, accountId, organizationId, conversationId);
    await this.ownedActiveMessage(tx, accountId, conversationId, messageId);
    const sequence = await this.nextSequence(tx, conversationId);
    const [row] = await tx<
      MessageRow[]
    >`update chat_messages set body=${input.body},edited_at=now() where id=${messageId} returning *`;
    await this.appendEvent(tx, {
      conversationId,
      sequence,
      eventType: "message.edited",
      messageId,
      actorAccountId: accountId,
      payload: { body: input.body },
    });
    if (!row) throw new Error("message edit failed");
    return this.publicMessage(tx, row);
  }
  public async retractMessage(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    conversationId: string,
    messageId: string,
  ) {
    await requireConversationAccess(tx, accountId, organizationId, conversationId);
    await this.ownedActiveMessage(tx, accountId, conversationId, messageId);
    const sequence = await this.nextSequence(tx, conversationId);
    const [row] = await tx<
      MessageRow[]
    >`update chat_messages set body=null,status='retracted',retracted_at=now() where id=${messageId} returning *`;
    await this.appendEvent(tx, {
      conversationId,
      sequence,
      eventType: "message.retracted",
      messageId,
      actorAccountId: accountId,
      payload: {},
    });
    if (!row) throw new Error("message retract failed");
    return this.publicMessage(tx, row);
  }
  public async setReaction(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    conversationId: string,
    messageId: string,
    raw: unknown,
  ) {
    const input = ChatReactionSetRequest.parse(raw);
    await requireConversationAccess(tx, accountId, organizationId, conversationId);
    const [target] = await tx<
      { id: string }[]
    >`select id from chat_messages where id=${messageId} and conversation_id=${conversationId}`;
    if (!target) throw new AuthError("CHAT_NOT_FOUND", "message was not found");
    const changed = input.active
      ? await tx`insert into chat_reactions(conversation_id,message_id,account_id,emoji)values(${conversationId},${messageId},${accountId},${input.emoji})on conflict do nothing returning message_id`
      : await tx`delete from chat_reactions where message_id=${messageId} and account_id=${accountId} and emoji=${input.emoji} returning message_id`;
    if (changed.length === 0)
      return { messageId, accountId, emoji: input.emoji, active: input.active, sequence: null };
    const sequence = await this.nextSequence(tx, conversationId);
    await this.appendEvent(tx, {
      conversationId,
      sequence,
      eventType: input.active ? "reaction.added" : "reaction.removed",
      messageId,
      actorAccountId: accountId,
      payload: { emoji: input.emoji },
    });
    return { messageId, accountId, emoji: input.emoji, active: input.active, sequence };
  }
  public async listEvents(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    conversationId: string,
    raw: unknown,
  ) {
    const input = ChatMessageListQuery.parse(raw);
    await requireConversationAccess(tx, accountId, organizationId, conversationId);
    const rows = await tx<
      EventRow[]
    >`select * from chat_events where conversation_id=${conversationId} and sequence>${input.afterSequence} order by sequence,id limit ${input.limit}`;
    return {
      items: rows.map(event),
      nextCursor: rows.length === input.limit ? Number(rows.at(-1)!.sequence) : null,
    };
  }
  public async convertMessage(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    conversationId: string,
    messageId: string,
    raw: unknown,
    idempotencyKey: string,
  ) {
    const input = ChatMessageConvertRequest.parse(raw);
    if (!idempotencyKey.trim() || idempotencyKey.length > 200)
      throw new AuthError("VALIDATION_FAILED", "valid conversion key required");
    await requireConversationAccess(tx, accountId, organizationId, conversationId);
    const [source] = await tx<MessageRow[]>`
      select * from chat_messages where id=${messageId} and conversation_id=${conversationId}
    `;
    if (!source || source.status !== "active")
      throw new AuthError("CHAT_CONFLICT", "message cannot be converted");
    const hash = payloadHash(input);
    await tx`select pg_advisory_xact_lock(hashtextextended(${`${messageId}:${idempotencyKey}`},0))`;
    const [existing] = await tx<{ request_hash: string; work_item_id: string }[]>`
      select request_hash,work_item_id from chat_message_conversions
      where message_id=${messageId} and idempotency_key=${idempotencyKey}
    `;
    if (existing) {
      if (existing.request_hash !== hash)
        throw new AuthError("CHAT_CONFLICT", "conversion key was reused with different input");
      return this.work.read(tx, accountId, organizationId, existing.work_item_id);
    }
    const created = await this.work.create(tx, accountId, organizationId, {
      type: input.type,
      title: input.title,
      description: `来自聊天消息 ${messageId}`,
      priority: "normal",
      dueAt: input.dueAt,
      meetingStartsAt: input.meetingStartsAt,
      assigneeAccountIds: input.assigneeAccountIds,
      sendSms: input.sendSms,
    });
    await tx`
      insert into chat_message_conversions(message_id,idempotency_key,request_hash,work_item_id,created_by_account_id)
      values(${messageId},${idempotencyKey},${hash},${created.item.id},${accountId})
    `;
    for (const [sourceType, sourceId, targetType, targetId, relation] of [
      ["message", messageId, "work_item", created.item.id, "converted_to"],
      ["work_item", created.item.id, "message", messageId, "converted_from"],
    ] as const)
      await tx`
        insert into resource_links(organization_id,source_type,source_id,target_type,target_id,relation_type,created_by_account_id)
        values(${organizationId},${sourceType},${sourceId},${targetType},${targetId},${relation},${accountId})
        on conflict do nothing
      `;
    return created;
  }
}
