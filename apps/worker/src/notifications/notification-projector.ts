import type { DatabaseClient } from "../outbox-loop.js";
import type { TransactionClient } from "../../../api/src/db/transaction.js";

interface DomainRow {
  id: string;
  organization_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
}
export class NotificationProjector {
  public constructor(private readonly sql: DatabaseClient) {}
  public async project(domainEventId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      const [event] = await tx<
        DomainRow[]
      >`select id,organization_id,aggregate_type,aggregate_id,event_type,payload from domain_events where id=${domainEventId}`;
      if (!event) return;
      if (event.aggregate_type === "work_item") await this.work(tx, event);
      else if (
        event.aggregate_type === "process_instance" &&
        event.event_type === "process.started"
      )
        await this.process(tx, event);
      else if (
        event.aggregate_type === "partner" &&
        [
          "partner.created",
          "partner.updated",
          "partner.interaction_added",
          "partner.interaction_corrected",
          "partner.follow_up_scheduled",
        ].includes(event.event_type)
      )
        await this.partner(tx, event);
    });
  }
  private async work(tx: TransactionClient, event: DomainRow) {
    const [work] = await tx<
      {
        type: string;
        title: string;
        priority: string;
        due_at: Date | null;
        meeting_starts_at: Date | null;
      }[]
    >`select type,title,priority,due_at,meeting_starts_at from work_items where id=${event.aggregate_id} and organization_id=${event.organization_id}`;
    if (!work) return;
    const recipients = await tx<
      { assignee_account_id: string }[]
    >`select assignee_account_id from work_assignments where work_item_id=${event.aggregate_id}`;
    for (const r of recipients) {
      const type =
        work.type === "approval" || work.type === "change_request"
          ? "approval_requested"
          : work.priority === "urgent"
            ? "emergency"
            : "ordinary_task";
      const sms = type !== "ordinary_task" || event.payload.sendSms === true;
      await this.notify(tx, event, r.assignee_account_id, type, work.title, sms);
      if (work.due_at)
        await this.remind(
          tx,
          event,
          r.assignee_account_id,
          "deadline_one_hour",
          new Date(work.due_at.getTime() - 3600000),
          work.title,
        );
      if (work.meeting_starts_at)
        await this.remind(
          tx,
          event,
          r.assignee_account_id,
          "meeting_one_hour",
          new Date(work.meeting_starts_at.getTime() - 3600000),
          work.title,
        );
    }
  }
  private async process(tx: TransactionClient, event: DomainRow) {
    const rows = await tx<
      { approver_account_id: string }[]
    >`select approver_account_id from process_instance_steps where process_instance_id=${event.aggregate_id} and status='pending'`;
    for (const r of rows)
      await this.notify(
        tx,
        event,
        r.approver_account_id,
        "approval_requested",
        "新的审批请求",
        true,
      );
  }
  private async partner(tx: TransactionClient, event: DomainRow) {
    const [p] = await tx<
      { owner_account_id: string; name: string; next_follow_up_at: Date | null }[]
    >`select owner_account_id,name,next_follow_up_at from partners where id=${event.aggregate_id} and organization_id=${event.organization_id}`;
    const key = p?.next_follow_up_at
      ? `partner:${event.organization_id}:${event.aggregate_id}:${p.next_follow_up_at.toISOString()}`
      : null;
    await tx`
      update scheduled_reminders set status='cancelled',lease_owner=null,lease_expires_at=null,updated_at=now()
      where organization_id=${event.organization_id} and resource_type='partner'
        and resource_id=${event.aggregate_id} and event_type='partner_follow_up'
        and status in('pending','processing') and deterministic_key<>${key ?? "cancel-all"}
    `;
    if (p?.next_follow_up_at && key)
      await tx`
        insert into scheduled_reminders(
          organization_id,recipient_account_id,event_type,resource_type,resource_id,
          scheduled_for,deterministic_key,payload
        ) values(
          ${event.organization_id},${p.owner_account_id},'partner_follow_up','partner',
          ${event.aggregate_id},${p.next_follow_up_at},${key},${tx.json({ title: p.name })}
        ) on conflict(deterministic_key) do nothing
      `;
  }
  private async notify(
    tx: TransactionClient,
    event: DomainRow,
    recipient: string,
    eventType: string,
    title: string,
    sms: boolean,
  ) {
    const key = `domain:${event.id}:${recipient}:${eventType}`;
    await tx`insert into notifications(organization_id,recipient_account_id,event_type,title,body,resource_type,resource_id,deduplication_key)values(${event.organization_id},${recipient},${eventType},${title},${title},${event.aggregate_type},${event.aggregate_id},${key})on conflict(deduplication_key)do nothing`;
    if (sms) {
      const [n] = await tx<
        { id: string }[]
      >`select id from notifications where deduplication_key=${key}`;
      if (n)
        await tx`insert into notification_delivery_attempts(notification_id,channel,status,idempotency_key)values(${n.id},'sms','pending',${`sms:${key}`})on conflict(idempotency_key)do nothing`;
    }
  }
  private async remind(
    tx: TransactionClient,
    event: DomainRow,
    recipient: string,
    eventType: string,
    when: Date,
    title: string,
  ) {
    const key = `reminder:${event.id}:${recipient}:${eventType}`;
    await tx`insert into scheduled_reminders(organization_id,recipient_account_id,event_type,resource_type,resource_id,scheduled_for,deterministic_key,payload)values(${event.organization_id},${recipient},${eventType},${event.aggregate_type},${event.aggregate_id},${when},${key},${tx.json({ title })})on conflict(deterministic_key)do nothing`;
  }
}
