import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { NotificationPolicyService } from "../../src/notifications/notification-policy-service.js";
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
  const [admin] = await sql<
    { id: string }[]
  >`insert into accounts(display_name,password_hash,phone_e164,phone_verified_at)values('Admin','hash','+8613800138501',now())returning id`;
  const [member] = await sql<
    { id: string }[]
  >`insert into accounts(display_name,password_hash,phone_e164,phone_verified_at)values('Member','hash','+8613800138502',now())returning id`;
  const [org] = await sql<
    { id: string }[]
  >`insert into organizations(name)values('Notify')returning id`;
  if (!admin || !member || !org) throw new Error();
  await sql`insert into memberships(organization_id,account_id,role,status)values(${org.id},${admin.id},'org_owner','active'),(${org.id},${member.id},'member','active')`;
  return { admin: admin.id, member: member.id, org: org.id };
}
describe("notification policy", () => {
  test("keeps mandatory immediate and one-hour SMS rules fixed", async () => {
    const a = await fixture(),
      s = new NotificationPolicyService();
    const p = await sql.begin((tx) => s.ensureDefault(tx, a.admin, a.org));
    expect(p.rules).toMatchObject({
      approval_requested: { sms: "immediate" },
      emergency: { sms: "immediate" },
      ordinary_task: { sms: "optional" },
      deadline_one_hour: { sms: "mandatory" },
      meeting_one_hour: { sms: "mandatory" },
      daily_summary: { sms: "preference" },
    });
    expect(
      await sql.begin((tx) => s.resolve(tx, a.member, a.org, "ordinary_task", false)),
    ).toMatchObject({ sms: false });
    expect(
      await sql.begin((tx) => s.resolve(tx, a.member, a.org, "ordinary_task", true)),
    ).toMatchObject({ sms: true });
  });
  test("allows members to disable only daily summary", async () => {
    const a = await fixture(),
      s = new NotificationPolicyService();
    await sql.begin((tx) => s.ensureDefault(tx, a.admin, a.org));
    await sql.begin((tx) => s.setPreference(tx, a.member, a.org, { dailySummaryEnabled: false }));
    expect(
      await sql.begin((tx) => s.resolve(tx, a.member, a.org, "daily_summary", false)),
    ).toMatchObject({ sms: false });
    expect(
      await sql.begin((tx) => s.resolve(tx, a.member, a.org, "approval_requested", false)),
    ).toMatchObject({ sms: true });
  });
  test("cancels an already scheduled daily summary when a member opts out", async () => {
    const a = await fixture(),
      s = new NotificationPolicyService();
    await sql`
      insert into scheduled_reminders(
        organization_id,recipient_account_id,event_type,resource_type,resource_id,
        scheduled_for,deterministic_key,payload
      ) values(
        ${a.org},${a.member},'daily_summary','organization',${a.org},
        '2026-08-29T10:00:00Z','daily-existing','{}'
      )
    `;
    await sql.begin((tx) => s.setPreference(tx, a.member, a.org, { dailySummaryEnabled: false }));
    const [row] = await sql<{ status: string; lease_owner: string | null }[]>`
      select status,lease_owner from scheduled_reminders where deterministic_key='daily-existing'
    `;
    expect(row).toEqual({ status: "cancelled", lease_owner: null });
  });
  test("publishes timezone versions and makes published policy immutable", async () => {
    const a = await fixture(),
      s = new NotificationPolicyService();
    const first = await sql.begin((tx) => s.ensureDefault(tx, a.admin, a.org));
    const next = await sql.begin((tx) =>
      s.publish(tx, a.admin, a.org, {
        timezone: "America/New_York",
        expectedVersion: first.organizationVersion,
      }),
    );
    expect(next).toMatchObject({
      timezone: "America/New_York",
      policyVersion: 2,
      organizationVersion: 2,
    });
    await expect(
      sql`update notification_policy_versions set timezone='UTC' where id=${next.id}`,
    ).rejects.toThrow(/immutable/);
    await expect(
      sql.begin((tx) => s.publish(tx, a.admin, a.org, { timezone: "UTC", expectedVersion: 1 })),
    ).rejects.toMatchObject({ code: "NOTIFICATION_VERSION_CONFLICT" });
  });
});
