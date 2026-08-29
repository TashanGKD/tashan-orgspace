import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { NotificationPolicyService } from "../../src/notifications/notification-policy-service.js";
import { NotificationService } from "../../src/notifications/notification-service.js";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
let sql: DatabaseClient;

beforeAll(async () => {
  await resetTestDatabase(url);
  await migrateDatabase(url);
  sql = createDatabaseClient(url);
}, 30_000);
beforeEach(async () => {
  await sql`truncate table audit_events,outbox_events,session_refresh_tokens,sessions,devices,memberships,organizations,phone_verifications,principals,accounts cascade`;
});
afterAll(async () => sql?.end());

async function fixture() {
  const [admin] = await sql<
    { id: string }[]
  >`insert into accounts(display_name,password_hash,phone_e164,phone_verified_at)values('Admin','hash','+8613800138601',now())returning id`;
  const [member] = await sql<
    { id: string }[]
  >`insert into accounts(display_name,password_hash,phone_e164,phone_verified_at)values('Member','hash','+8613800138602',now())returning id`;
  const [other] = await sql<
    { id: string }[]
  >`insert into accounts(display_name,password_hash,phone_e164,phone_verified_at)values('Other','hash','+8613800138603',now())returning id`;
  const [org] = await sql<
    { id: string }[]
  >`insert into organizations(name)values('Notify')returning id`;
  if (!admin || !member || !other || !org) throw new Error("fixture failed");
  await sql`insert into memberships(organization_id,account_id,role,status)values(${org.id},${admin.id},'org_owner','active'),(${org.id},${member.id},'member','active'),(${org.id},${other.id},'member','active')`;
  const [mine] = await sql<
    { id: string }[]
  >`insert into notifications(organization_id,recipient_account_id,event_type,title,body,deduplication_key)values(${org.id},${member.id},'emergency','紧急通知','请立即处理','mine')returning id`;
  const [theirs] = await sql<
    { id: string }[]
  >`insert into notifications(organization_id,recipient_account_id,event_type,title,body,deduplication_key)values(${org.id},${other.id},'ordinary_task','其他成员通知','不可见','theirs')returning id`;
  if (!mine || !theirs) throw new Error("notification fixture failed");
  return { admin: admin.id, member: member.id, other: other.id, org: org.id, mine: mine.id };
}

describe("notification surfaces", () => {
  test("lists and reads only the authenticated member's notifications", async () => {
    const a = await fixture();
    const service = new NotificationService();
    const list = await sql.begin((tx) => service.list(tx, a.member, a.org, {}));
    expect(list.items.map((item) => item.id)).toEqual([a.mine]);
    await expect(sql.begin((tx) => service.read(tx, a.other, a.org, a.mine))).rejects.toMatchObject(
      {
        code: "NOTIFICATION_NOT_FOUND",
      },
    );
    expect(await sql.begin((tx) => service.read(tx, a.member, a.org, a.mine))).toMatchObject({
      id: a.mine,
      status: "unread",
    });
  });

  test("marks a member's notification read without changing another record", async () => {
    const a = await fixture();
    const service = new NotificationService();
    const result = await sql.begin((tx) => service.markRead(tx, a.member, a.org, a.mine));
    expect(result).toMatchObject({ id: a.mine, status: "read" });
    expect(result.readAt).toMatch(/Z$/);
  });

  test("allows only the daily summary preference to be disabled", async () => {
    const a = await fixture();
    const policy = new NotificationPolicyService();
    expect(await sql.begin((tx) => policy.getPreference(tx, a.member, a.org))).toEqual({
      organizationId: a.org,
      accountId: a.member,
      dailySummaryEnabled: true,
    });
    await expect(
      sql.begin((tx) =>
        policy.setPreference(tx, a.member, a.org, {
          dailySummaryEnabled: false,
          deadlineOneHourEnabled: false,
        }),
      ),
    ).rejects.toThrow();
    expect(
      await sql.begin((tx) =>
        policy.setPreference(tx, a.member, a.org, { dailySummaryEnabled: false }),
      ),
    ).toMatchObject({ dailySummaryEnabled: false });
  });

  test("limits policy publication to administrators and preserves versions", async () => {
    const a = await fixture();
    const policy = new NotificationPolicyService();
    const current = await sql.begin((tx) => policy.getPolicy(tx, a.admin, a.org));
    expect(current).toMatchObject({ policyVersion: 1, timezone: "Asia/Shanghai" });
    await expect(sql.begin((tx) => policy.getPolicy(tx, a.member, a.org))).rejects.toMatchObject({
      code: "NOTIFICATION_FORBIDDEN",
    });
    const next = await sql.begin((tx) =>
      policy.publish(tx, a.admin, a.org, {
        timezone: "America/New_York",
        expectedVersion: current.organizationVersion,
      }),
    );
    expect(next).toMatchObject({ policyVersion: 2, timezone: "America/New_York" });
  });
});
