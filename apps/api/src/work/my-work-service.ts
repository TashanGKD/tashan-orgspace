import { MyWorkListQuery, MyWorkListResponse } from "@tashan/contracts";
import type { TransactionClient } from "../db/transaction.js";

export class MyWorkService {
  public async list(tx: TransactionClient, accountId: string, raw: unknown) {
    const input = MyWorkListQuery.parse(raw);
    const work = await tx<
      {
        id: string;
        organization_id: string;
        organization_name: string;
        type: "task" | "meeting" | "approval" | "change_request";
        title: string;
        status: string;
        due_at: Date | null;
        meeting_starts_at: Date | null;
        updated_at: Date;
      }[]
    >`
      select item.id,item.organization_id,organization.name organization_name,item.type,item.title,
        item.status,item.due_at,item.meeting_starts_at,item.updated_at
      from work_assignments assignment join work_items item on item.id=assignment.work_item_id
      join organizations organization on organization.id=item.organization_id
      join memberships membership on membership.organization_id=item.organization_id
        and membership.account_id=${accountId} and membership.status='active'
      where assignment.assignee_account_id=${accountId} and item.status='open'
    `;
    const approvals = await tx<
      {
        id: string;
        organization_id: string;
        organization_name: string;
        title: string;
        updated_at: Date;
      }[]
    >`
      select instance.id,instance.organization_id,organization.name organization_name,
        coalesce(instance.subject->>'title','待处理审批') title,instance.updated_at
      from process_instance_steps step join process_instances instance on instance.id=step.process_instance_id
      join organizations organization on organization.id=instance.organization_id
      join memberships membership on membership.organization_id=instance.organization_id
        and membership.account_id=${accountId} and membership.status='active'
      where step.approver_account_id=${accountId} and step.status='pending' and instance.status='pending'
    `;
    const reminders = await tx<
      {
        id: string;
        organization_id: string;
        organization_name: string;
        event_type: string;
        resource_type: string;
        resource_id: string;
        scheduled_for: Date;
        payload: Record<string, unknown>;
        status: string;
      }[]
    >`
      select reminder.id,reminder.organization_id,organization.name organization_name,
        reminder.event_type,reminder.resource_type,reminder.resource_id,reminder.scheduled_for,
        reminder.payload,reminder.status
      from scheduled_reminders reminder join organizations organization on organization.id=reminder.organization_id
      join memberships membership on membership.organization_id=reminder.organization_id
        and membership.account_id=${accountId} and membership.status='active'
      where reminder.recipient_account_id=${accountId} and reminder.status in('pending','processing')
    `;
    const mentions = await tx<
      {
        message_id: string;
        conversation_id: string;
        organization_id: string;
        organization_name: string;
        sender_name: string;
        body: string;
        created_at: Date;
      }[]
    >`
      select message.id message_id,message.conversation_id,conversation.organization_id,
        organization.name organization_name,sender.display_name sender_name,message.body,message.created_at
      from chat_mentions mention join chat_messages message on message.id=mention.message_id
      join conversations conversation on conversation.id=message.conversation_id
      join conversation_members conversation_member on conversation_member.conversation_id=conversation.id
        and conversation_member.account_id=${accountId} and conversation_member.left_at is null
      join memberships membership on membership.organization_id=conversation.organization_id
        and membership.account_id=${accountId} and membership.status='active'
      join organizations organization on organization.id=conversation.organization_id
      join accounts sender on sender.id=message.sender_account_id
      where mention.mentioned_account_id=${accountId} and message.status='active'
    `;
    const items = [
      ...work.map((row) => {
        const kind = row.type === "meeting" ? "meeting" : row.type === "task" ? "task" : "approval";
        const section =
          kind === "meeting" ? "meetings" : kind === "approval" ? "approvals" : "tasks";
        const sortAt = row.meeting_starts_at ?? row.due_at ?? row.updated_at;
        return {
          id: `work:${row.id}`,
          kind,
          organizationId: row.organization_id,
          organizationName: row.organization_name,
          title: row.title,
          status: row.status,
          dueAt: (row.meeting_starts_at ?? row.due_at)?.toISOString() ?? null,
          href: `/org/${row.organization_id}/${section}/${row.id}`,
          resource: {
            organizationId: row.organization_id,
            resourceType: "work_item" as const,
            resourceId: row.id,
          },
          sortAt: sortAt.toISOString(),
        };
      }),
      ...approvals.map((row) => ({
        id: `process:${row.id}`,
        kind: "approval" as const,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        title: row.title,
        status: "pending",
        dueAt: null,
        href: `/org/${row.organization_id}/approvals`,
        resource: {
          organizationId: row.organization_id,
          resourceType: "process_instance" as const,
          resourceId: row.id,
        },
        sortAt: row.updated_at.toISOString(),
      })),
      ...reminders.map((row) => {
        const resource =
          row.resource_type === "work_item" || row.resource_type === "partner"
            ? {
                organizationId: row.organization_id,
                resourceType: row.resource_type,
                resourceId: row.resource_id,
              }
            : null;
        const href =
          row.resource_type === "partner"
            ? `/org/${row.organization_id}/partners/${row.resource_id}`
            : row.event_type === "meeting_one_hour"
              ? `/org/${row.organization_id}/meetings/${row.resource_id}`
              : row.resource_type === "work_item"
                ? `/org/${row.organization_id}/tasks/${row.resource_id}`
                : `/org/${row.organization_id}/home`;
        return {
          id: `reminder:${row.id}`,
          kind: "reminder" as const,
          organizationId: row.organization_id,
          organizationName: row.organization_name,
          title: String(row.payload.title ?? "提醒"),
          status: row.status,
          dueAt: row.scheduled_for.toISOString(),
          href,
          resource,
          sortAt: row.scheduled_for.toISOString(),
        };
      }),
      ...mentions.map((row) => ({
        id: `mention:${row.message_id}:${accountId}`,
        kind: "mention" as const,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        title: `${row.sender_name} 提到了你`,
        status: "unread",
        dueAt: null,
        href: `/org/${row.organization_id}/messages/${row.conversation_id}`,
        resource: {
          organizationId: row.organization_id,
          resourceType: "message" as const,
          resourceId: row.message_id,
        },
        sortAt: row.created_at.toISOString(),
      })),
    ]
      .filter((item) => input.kind === undefined || item.kind === input.kind)
      .sort((left, right) => Date.parse(left.sortAt) - Date.parse(right.sortAt))
      .slice(0, input.limit);
    return MyWorkListResponse.parse({ items });
  }
}
