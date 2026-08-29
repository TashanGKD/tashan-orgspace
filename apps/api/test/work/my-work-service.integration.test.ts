import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { ChatService } from "../../src/chat/chat-service.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { MyWorkService } from "../../src/work/my-work-service.js";

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
  const [alice] = await sql<{ id: string }[]>`
    insert into accounts(display_name,password_hash,phone_e164,phone_verified_at)
    values('Alice','hash','+8613800138751',now())returning id
  `;
  const [bob] = await sql<{ id: string }[]>`
    insert into accounts(display_name,password_hash,phone_e164,phone_verified_at)
    values('Bob','hash','+8613800138752',now())returning id
  `;
  const [orgA] = await sql<
    { id: string }[]
  >`insert into organizations(name)values('Org A')returning id`;
  const [orgB] = await sql<
    { id: string }[]
  >`insert into organizations(name)values('Org B')returning id`;
  await sql`insert into memberships(organization_id,account_id,role,status)values(${orgA!.id},${alice!.id},'member','active'),(${orgA!.id},${bob!.id},'org_owner','active'),(${orgB!.id},${alice!.id},'member','active'),(${orgB!.id},${bob!.id},'org_owner','active')`;
  const [task] = await sql<
    { id: string }[]
  >`insert into work_items(organization_id,type,title,created_by_account_id)values(${orgA!.id},'task','任务 A',${bob!.id})returning id`;
  const [meeting] = await sql<
    { id: string }[]
  >`insert into work_items(organization_id,type,title,meeting_starts_at,created_by_account_id)values(${orgB!.id},'meeting','会议 B',now()+interval '1 day',${bob!.id})returning id`;
  await sql`insert into work_assignments(work_item_id,assignee_account_id,assigned_by_account_id)values(${task!.id},${alice!.id},${bob!.id}),(${meeting!.id},${alice!.id},${bob!.id})`;
  await sql`insert into collaboration_resources(organization_id,resource_type,resource_id)values(${orgA!.id},'work_item',${task!.id}),(${orgB!.id},'work_item',${meeting!.id})`;
  await sql`insert into scheduled_reminders(organization_id,recipient_account_id,event_type,resource_type,resource_id,scheduled_for,deterministic_key,payload)values(${orgA!.id},${alice!.id},'deadline_one_hour','work_item',${task!.id},now()+interval '1 hour','my-work-reminder',${sql.json({ title: "任务 A 即将截止" })})`;
  const [definition] = await sql<
    { id: string }[]
  >`insert into process_definitions(organization_id,name,created_by_account_id)values(${orgA!.id},'审批流程',${bob!.id})returning id`;
  const [version] = await sql<
    { id: string }[]
  >`insert into process_definition_versions(definition_id,version_number,mode,status,created_by_account_id,published_at)values(${definition!.id},1,'single','published',${bob!.id},now())returning id`;
  const [instance] = await sql<
    { id: string }[]
  >`insert into process_instances(organization_id,definition_version_id,initiator_account_id,subject)values(${orgA!.id},${version!.id},${bob!.id},${sql.json({ title: "待审批申请" })})returning id`;
  await sql`insert into process_instance_steps(process_instance_id,position,approver_account_id,status)values(${instance!.id},1,${alice!.id},'pending')`;
  const chat = new ChatService();
  const conversation = await sql.begin((tx) =>
    chat.createDirect(tx, bob!.id, orgA!.id, { accountId: alice!.id }),
  );
  await sql.begin((tx) =>
    chat.sendMessage(tx, bob!.id, orgA!.id, conversation.id, {
      clientMessageId: crypto.randomUUID(),
      body: "请查看任务",
      mentionAccountIds: [alice!.id],
    }),
  );
  return { alice: alice!.id, orgA: orgA!.id, orgB: orgB!.id };
}

describe("My Work", () => {
  test("aggregates cross-organization tasks, meetings, reminders and mentions as references", async () => {
    const a = await fixture(),
      service = new MyWorkService();
    const result = await sql.begin((tx) => service.list(tx, a.alice, {}));
    expect(new Set(result.items.map((item) => item.kind))).toEqual(
      new Set(["task", "meeting", "approval", "reminder", "mention"]),
    );
    expect(new Set(result.items.map((item) => item.organizationId))).toEqual(
      new Set([a.orgA, a.orgB]),
    );
    expect(result.items.every((item) => item.href.startsWith(`/org/${item.organizationId}/`))).toBe(
      true,
    );
  });

  test("drops every reference from an organization immediately after membership loss", async () => {
    const a = await fixture(),
      service = new MyWorkService();
    await sql`update memberships set status='removed',removed_at=now() where organization_id=${a.orgA} and account_id=${a.alice}`;
    const result = await sql.begin((tx) => service.list(tx, a.alice, {}));
    expect(result.items.some((item) => item.organizationId === a.orgA)).toBe(false);
    expect(result.items.some((item) => item.organizationId === a.orgB)).toBe(true);
  });
});
