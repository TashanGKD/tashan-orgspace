import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "../../../api/src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../../api/src/db/migrate.js";
import { AliyunSmsDelivery, type SmsProvider } from "./aliyun-delivery.js";
import { PostgresSmsDeliveryStore } from "./postgres-sms-delivery-store.js";
import { SmsDeliveryLoop } from "./sms-delivery-loop.js";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error();
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
  const [account] = await sql<
    { id: string }[]
  >`insert into accounts(display_name,password_hash,phone_e164,phone_verified_at)values('Member','hash','+8613800138521',now())returning id`;
  const [org] = await sql<
    { id: string }[]
  >`insert into organizations(name)values('SMS')returning id`;
  if (!account || !org) throw new Error();
  const [notification] = await sql<
    { id: string }[]
  >`insert into notifications(organization_id,recipient_account_id,event_type,title,body,deduplication_key)values(${org.id},${account.id},'emergency','紧急通知','请立即处理','notice-1')returning id`;
  const [attempt] = await sql<
    { id: string }[]
  >`insert into notification_delivery_attempts(notification_id,channel,status,idempotency_key,lease_owner,lease_expires_at)values(${notification!.id},'sms','pending','sms-notice','dead-worker',now()-interval '1 minute')returning id`;
  return attempt!.id;
}
describe("SMS delivery loop", () => {
  test("reclaims an expired lease, resolves phone in memory and persists no phone", async () => {
    const id = await fixture();
    const provider: SmsProvider = {
      lookup: vi.fn().mockResolvedValue({ status: "not_found" }),
      send: vi.fn().mockResolvedValue({ requestId: "req", bizId: "biz" }),
    };
    const now = new Date(Date.now() + 60_000);
    const store = new PostgresSmsDeliveryStore({
      sql,
      templateCode: "SMS_NOTICE",
      templateParamKey: null,
      clock: () => now,
    });
    const loop = new SmsDeliveryLoop({
      sql,
      delivery: new AliyunSmsDelivery({ provider, store }),
      workerId: "sms-worker",
      clock: () => now,
    });
    expect(await loop.processOnce()).toBe(1);
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+8613800138521",
        templateParams: {},
      }),
    );
    const [row] = await sql<
      { status: string; provider_biz_id: string; lease_owner: string | null; serialized: string }[]
    >`select status,provider_biz_id,lease_owner,row_to_json(attempt)::text serialized from notification_delivery_attempts attempt where id=${id}`;
    expect(row).toMatchObject({ status: "accepted", provider_biz_id: "biz", lease_owner: null });
    expect(row?.serialized).not.toContain("13800138521");
  });
});
