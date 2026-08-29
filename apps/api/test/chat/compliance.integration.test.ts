import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { ChatService } from "../../src/chat/chat-service.js";
import { ComplianceService } from "../../src/chat/compliance-service.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";

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
    values('Alice','hash','+8613800138781',now())returning id
  `;
  const [bob] = await sql<{ id: string }[]>`
    insert into accounts(display_name,password_hash,phone_e164,phone_verified_at)
    values('Bob','hash','+8613800138782',now())returning id
  `;
  const [org] = await sql<
    { id: string }[]
  >`insert into organizations(name)values('Compliance')returning id`;
  if (!alice || !bob || !org) throw new Error("fixture failed");
  await sql`insert into memberships(organization_id,account_id,role,status)values(${org.id},${alice.id},'org_owner','active'),(${org.id},${bob.id},'member','active')`;
  const chat = new ChatService();
  const conversation = await sql.begin((tx) =>
    chat.createDirect(tx, alice.id, org.id, { accountId: bob.id }),
  );
  return { alice: alice.id, bob: bob.id, org: org.id, conversation: conversation.id, chat };
}

async function restrictedFile(organizationId: string, ownerId: string) {
  const spaceId = crypto.randomUUID(),
    rootId = crypto.randomUUID(),
    fileId = crypto.randomUUID();
  await sql.begin(async (tx) => {
    await tx`set constraints all deferred`;
    await tx`insert into spaces(id,type,organization_id,quota_bytes,root_folder_id)values(${spaceId},'organization',${organizationId},536870912000,${rootId})`;
    await tx`insert into file_entries(id,space_id,parent_id,kind,name,normalized_name,created_by_account_id)values(${rootId},${spaceId},null,'folder','Root','root',${ownerId}),(${fileId},${spaceId},${rootId},'file','Secret.txt','secret.txt',${ownerId})`;
    await tx`insert into folder_access_policies(folder_id,scope,updated_by_account_id)values(${rootId},'restricted',${ownerId})`;
    await tx`insert into folder_grants(folder_id,account_id,role,granted_by_account_id)values(${rootId},${ownerId},'manager',${ownerId})`;
    await tx`insert into collaboration_resources(organization_id,resource_type,resource_id)values(${organizationId},'file',${fileId})`;
  });
  return { spaceId, fileId };
}

describe("chat attachments, conversion and compliance", () => {
  test("rejects an attachment that any conversation member cannot read", async () => {
    const a = await fixture(),
      file = await restrictedFile(a.org, a.alice);
    await expect(
      sql.begin((tx) =>
        a.chat.sendMessage(tx, a.alice, a.org, a.conversation, {
          clientMessageId: crypto.randomUUID(),
          body: "请看附件",
          attachments: [{ type: "file", spaceId: file.spaceId, entryId: file.fileId }],
        }),
      ),
    ).rejects.toMatchObject({ code: "CHAT_FORBIDDEN" });
  });

  test("converts one message to one task for the same conversion key", async () => {
    const a = await fixture();
    const message = await sql.begin((tx) =>
      a.chat.sendMessage(tx, a.alice, a.org, a.conversation, {
        clientMessageId: crypto.randomUUID(),
        body: "整理会议纪要",
      }),
    );
    const input = { type: "task", title: "整理会议纪要", assigneeAccountIds: [a.bob] };
    const first = await sql.begin((tx) =>
      a.chat.convertMessage(tx, a.alice, a.org, a.conversation, message.id, input, "convert-1"),
    );
    const replay = await sql.begin((tx) =>
      a.chat.convertMessage(tx, a.alice, a.org, a.conversation, message.id, input, "convert-1"),
    );
    expect(replay.item.id).toBe(first.item.id);
    const [count] = await sql<{ count: number }[]>`
      select count(*)::int count from work_items where title='整理会议纪要'
    `;
    expect(count?.count).toBe(1);
  });

  test("keeps withdrawn history out of normal body reads but available to time-bounded owner review", async () => {
    const a = await fixture(),
      compliance = new ComplianceService();
    const message = await sql.begin((tx) =>
      a.chat.sendMessage(tx, a.alice, a.org, a.conversation, {
        clientMessageId: crypto.randomUUID(),
        body: "需要保留的原文",
      }),
    );
    await sql.begin((tx) => a.chat.retractMessage(tx, a.alice, a.org, a.conversation, message.id));
    const normal = await sql.begin((tx) =>
      a.chat.listMessages(tx, a.bob, a.org, a.conversation, {}),
    );
    expect(normal.items[0]).toMatchObject({ status: "retracted", body: null });
    const request = {
      conversationId: a.conversation,
      reason: "调查组织信息泄露事件",
      startsAt: "2026-08-28T00:00:00.000Z",
      endsAt: "2026-08-30T00:00:00.000Z",
    };
    await expect(
      sql.begin((tx) => compliance.createReview(tx, a.bob, a.org, request)),
    ).rejects.toMatchObject({ code: "CHAT_FORBIDDEN" });
    const review = await sql.begin((tx) => compliance.createReview(tx, a.alice, a.org, request));
    const result = await sql.begin((tx) => compliance.readReview(tx, a.alice, a.org, review.id));
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "message.sent", body: "需要保留的原文" }),
        expect.objectContaining({ eventType: "message.retracted" }),
      ]),
    );
  });
});
