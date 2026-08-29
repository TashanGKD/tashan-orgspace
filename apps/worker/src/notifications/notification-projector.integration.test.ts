import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "../../../api/src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../../api/src/db/migrate.js";
import { NotificationProjector } from "./notification-projector.js";
import { nextDailySummaryUtc, ReminderScheduler } from "./reminder-scheduler.js";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
let sql: DatabaseClient;
beforeAll(async () => {
  await resetTestDatabase(url);
  await migrateDatabase(url);
  sql = createDatabaseClient(url);
}, 30000);
beforeEach(async () => {
  await sql`truncate table audit_events,outbox_events,session_refresh_tokens,sessions,devices,memberships,organizations,phone_verifications,principals,accounts cascade`;
});
afterAll(async () => sql?.end());
async function fixture() {
  const [owner] = await sql<
    { id: string }[]
  >`insert into accounts(display_name,password_hash,phone_e164,phone_verified_at)values('Owner','hash','+8613800138511',now())returning id`;
  const [member] = await sql<
    { id: string }[]
  >`insert into accounts(display_name,password_hash,phone_e164,phone_verified_at)values('Member','hash','+8613800138512',now())returning id`;
  const [org] = await sql<
    { id: string }[]
  >`insert into organizations(name)values('Notify')returning id`;
  if (!owner || !member || !org) throw new Error();
  await sql`insert into memberships(organization_id,account_id,role,status)values(${org.id},${owner.id},'org_owner','active'),(${org.id},${member.id},'member','active')`;
  return { owner: owner.id, member: member.id, org: org.id };
}
async function workEvent(
  a: Awaited<ReturnType<typeof fixture>>,
  input: {
    type: "task" | "meeting" | "approval";
    priority?: "normal" | "urgent";
    dueAt?: Date;
    startsAt?: Date;
    sendSms?: boolean;
  },
) {
  const [work] = await sql<
    { id: string }[]
  >`insert into work_items(organization_id,type,title,priority,due_at,meeting_starts_at,created_by_account_id)values(${a.org},${input.type},'Work',${input.priority ?? "normal"},${input.dueAt ?? null},${input.startsAt ?? null},${a.owner})returning id`;
  if (!work) throw new Error();
  await sql`insert into work_assignments(work_item_id,assignee_account_id,assigned_by_account_id)values(${work.id},${a.member},${a.owner})`;
  await sql`insert into collaboration_resources(organization_id,resource_type,resource_id)values(${a.org},'work_item',${work.id})`;
  const [event] = await sql<
    { id: string }[]
  >`insert into domain_events(organization_id,aggregate_type,aggregate_id,sequence,event_type,schema_version,actor_account_id,payload)values(${a.org},'work_item',${work.id},1,'work.created',1,${a.owner},${sql.json({ sendSms: input.sendSms ?? false })})returning id`;
  if (!event) throw new Error();
  return event.id;
}
describe("notification projection", () => {
  test("schedules local daily summaries across both DST boundaries", async () => {
    expect(
      nextDailySummaryUtc(new Date("2026-03-07T23:30:00Z"), "America/New_York").toISOString(),
    ).toBe("2026-03-08T22:00:00.000Z");
    expect(
      nextDailySummaryUtc(new Date("2026-10-31T22:30:00Z"), "America/New_York").toISOString(),
    ).toBe("2026-11-01T23:00:00.000Z");
    const a = await fixture();
    await sql`insert into notification_preferences(organization_id,account_id,daily_summary_enabled)values(${a.org},${a.member},false)`;
    const scheduler = new ReminderScheduler({
      sql,
      workerId: "daily-worker",
      clock: () => new Date("2026-03-07T23:30:00Z"),
    });
    expect(await scheduler.scheduleDailySummary(a.org, "America/New_York")).toBe(1);
    const rows = await sql<{ recipient_account_id: string; scheduled_for: Date }[]>`
      select recipient_account_id,scheduled_for from scheduled_reminders
    `;
    expect(rows).toEqual([
      { recipient_account_id: a.owner, scheduled_for: new Date("2026-03-08T22:00:00Z") },
    ]);
  });
  test("projects duplicate events once and schedules exact one-hour reminders", async () => {
    const a = await fixture(),
      now = new Date("2026-08-29T08:00:00.000Z"),
      event = await workEvent(a, { type: "task", dueAt: new Date("2026-08-29T10:00:00.000Z") });
    const p = new NotificationProjector(sql);
    await p.project(event);
    await p.project(event);
    const [counts] = await sql<
      { notifications: number; reminders: number; sms: number }[]
    >`select(select count(*)::int from notifications)notifications,(select count(*)::int from scheduled_reminders)reminders,(select count(*)::int from notification_delivery_attempts where channel='sms')sms`;
    expect(counts).toEqual({ notifications: 1, reminders: 1, sms: 0 });
    const [r] = await sql<{ scheduled_for: Date }[]>`select scheduled_for from scheduled_reminders`;
    expect(r?.scheduled_for.toISOString()).toBe("2026-08-29T09:00:00.000Z");
    expect(now.toISOString()).toContain("08:00");
  });
  test("creates immediate SMS attempts for approvals and urgent work, optional for ordinary tasks", async () => {
    const a = await fixture(),
      p = new NotificationProjector(sql);
    for (const input of [
      { type: "approval" as const },
      { type: "task" as const, priority: "urgent" as const },
      { type: "task" as const, sendSms: true },
    ])
      await p.project(await workEvent(a, input));
    const rows = await sql<
      { event_type: string }[]
    >`select event_type from notifications order by created_at`;
    expect(rows.map((x) => x.event_type)).toEqual([
      "approval_requested",
      "emergency",
      "ordinary_task",
    ]);
    expect(
      (
        await sql<
          { count: number }[]
        >`select count(*)::int count from notification_delivery_attempts where channel='sms'`
      )[0]?.count,
    ).toBe(3);
  });
  test("persists meeting and partner reminders and recovers an expired lease after restart", async () => {
    const a = await fixture(),
      p = new NotificationProjector(sql);
    await p.project(
      await workEvent(a, { type: "meeting", startsAt: new Date("2026-08-29T12:00:00.000Z") }),
    );
    const partnerId = crypto.randomUUID();
    await sql`insert into partners(id,organization_id,owner_account_id,created_by_account_id,name,cooperation_stage,next_follow_up_at)values(${partnerId},${a.org},${a.member},${a.owner},'Partner','active','2026-08-29T13:00:00Z')`;
    await sql`insert into collaboration_resources(organization_id,resource_type,resource_id)values(${a.org},'partner',${partnerId})`;
    const [event] = await sql<
      { id: string }[]
    >`insert into domain_events(organization_id,aggregate_type,aggregate_id,sequence,event_type,schema_version,actor_account_id,payload)values(${a.org},'partner',${partnerId},1,'partner.follow_up_scheduled',1,${a.owner},'{}')returning id`;
    await p.project(event!.id);
    await sql`update scheduled_reminders set status='processing',lease_owner='dead-worker',lease_expires_at='2026-08-29T10:00:00Z'`;
    const scheduler = new ReminderScheduler({
      sql,
      workerId: "restart-worker",
      clock: () => new Date("2026-08-29T14:00:00Z"),
    });
    expect(await scheduler.processOnce()).toBe(2);
    expect(
      (
        await sql<
          { count: number }[]
        >`select count(*)::int count from notification_delivery_attempts where channel='sms'`
      )[0]?.count,
    ).toBe(2);
    expect(
      (
        await sql<
          { count: number }[]
        >`select count(*)::int count from scheduled_reminders where status='done'`
      )[0]?.count,
    ).toBe(2);
  });
});
