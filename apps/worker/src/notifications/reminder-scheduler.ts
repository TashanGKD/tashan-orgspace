import type { DatabaseClient } from "../outbox-loop.js";
interface ReminderRow {
  id: string;
  organization_id: string;
  recipient_account_id: string;
  event_type: string;
  resource_type: string;
  resource_id: string;
  payload: Record<string, unknown>;
}
function partsAt(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}
function localToUtc(timeZone: string, year: number, month: number, day: number, hour: number) {
  const target = Date.UTC(year, month - 1, day, hour);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shown = partsAt(new Date(guess), timeZone);
    const displayed = Date.UTC(
      shown.year,
      shown.month - 1,
      shown.day,
      shown.hour,
      shown.minute,
      shown.second,
    );
    guess += target - displayed;
  }
  return new Date(guess);
}
export function nextDailySummaryUtc(after: Date, timeZone: string): Date {
  const local = partsAt(after, timeZone);
  let result = localToUtc(timeZone, local.year, local.month, local.day, 18);
  if (result.getTime() <= after.getTime()) {
    const next = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
    result = localToUtc(
      timeZone,
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      18,
    );
  }
  return result;
}
export class ReminderScheduler {
  private stopping = false;
  private readonly clock: () => Date;
  private readonly poll: number;
  public constructor(
    private readonly options: {
      sql: DatabaseClient;
      workerId: string;
      clock?: () => Date;
      pollMilliseconds?: number;
    },
  ) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(options.workerId))
      throw new Error("worker ID invalid");
    this.clock = options.clock ?? (() => new Date());
    this.poll = options.pollMilliseconds ?? 500;
  }
  public async processOnce(): Promise<number> {
    if (this.stopping) return 0;
    const now = this.clock(),
      lease = new Date(now.getTime() + 60000);
    const rows = await this.options.sql<ReminderRow[]>`
      with candidates as (
        select id from scheduled_reminders
        where scheduled_for <= ${now}
          and (status = 'pending' or (status = 'processing' and lease_expires_at <= ${now}))
        order by scheduled_for, id for update skip locked limit 50
      )
      update scheduled_reminders reminder set
        status = 'processing', attempts = attempts + 1,
        lease_owner = ${this.options.workerId}, lease_expires_at = ${lease}, updated_at = ${now}
      from candidates where reminder.id = candidates.id
      returning reminder.id, reminder.organization_id, reminder.recipient_account_id,
        reminder.event_type, reminder.resource_type, reminder.resource_id, reminder.payload
    `;
    for (const row of rows) await this.deliver(row);
    return rows.length;
  }
  public async scheduleDailySummary(
    organizationId: string,
    timeZone: string,
    after = this.clock(),
  ) {
    const scheduledFor = nextDailySummaryUtc(after, timeZone);
    const rows = await this.options.sql<{ account_id: string }[]>`
      select membership.account_id from memberships membership
      left join notification_preferences preference on preference.organization_id=membership.organization_id and preference.account_id=membership.account_id
      where membership.organization_id=${organizationId} and membership.status='active'
        and coalesce(preference.daily_summary_enabled,true)
    `;
    let inserted = 0;
    for (const row of rows) {
      const result = await this.options.sql`
        insert into scheduled_reminders(organization_id,recipient_account_id,event_type,resource_type,resource_id,scheduled_for,deterministic_key,payload)
        values(${organizationId},${row.account_id},'daily_summary','organization',${organizationId},${scheduledFor},${`daily:${organizationId}:${row.account_id}:${scheduledFor.toISOString().slice(0, 10)}`},${this.options.sql.json({ title: "每日工作汇总", timeZone })})
        on conflict(deterministic_key) do nothing returning id
      `;
      inserted += result.length;
    }
    return inserted;
  }
  private async deliver(row: ReminderRow) {
    await this.options.sql.begin(async (tx) => {
      const key = `reminder:${row.id}`;
      await tx`insert into notifications(organization_id,recipient_account_id,event_type,title,body,resource_type,resource_id,deduplication_key)values(${row.organization_id},${row.recipient_account_id},${row.event_type},${String(row.payload.title ?? "提醒")},${String(row.payload.title ?? "提醒")},${row.resource_type},${row.resource_id},${key})on conflict(deduplication_key)do nothing`;
      const [n] = await tx<
        { id: string }[]
      >`select id from notifications where deduplication_key=${key}`;
      if (n)
        await tx`insert into notification_delivery_attempts(reminder_id,channel,status,idempotency_key)values(${row.id},'sms','pending',${`sms:${key}`})on conflict(idempotency_key)do nothing`;
      await tx`update scheduled_reminders set status='done',lease_owner=null,lease_expires_at=null,updated_at=${this.clock()} where id=${row.id} and lease_owner=${this.options.workerId}`;
    });
  }
  public async run() {
    while (!this.stopping) {
      const n = await this.processOnce();
      if (n === 0 && !this.stopping) await new Promise((r) => setTimeout(r, this.poll));
    }
  }
  public stop() {
    this.stopping = true;
  }
}
