import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { ChatService } from "../../src/chat/chat-service.js";

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
  const accounts: string[] = [];
  for (const [index, name] of ["Alice", "Bob", "Carol", "Diana"].entries()) {
    const [account] = await sql<{ id: string }[]>`
      insert into accounts(display_name,password_hash,phone_e164,phone_verified_at)
      values(${name},'hash',${`+86138001387${String(index).padStart(2, "0")}`},now()) returning id
    `;
    if (!account) throw new Error("account fixture failed");
    accounts.push(account.id);
  }
  const [orgA] = await sql<
    { id: string }[]
  >`insert into organizations(name)values('Org A')returning id`;
  const [orgB] = await sql<
    { id: string }[]
  >`insert into organizations(name)values('Org B')returning id`;
  if (!orgA || !orgB || accounts.length !== 4) throw new Error("organization fixture failed");
  await sql`
    insert into memberships(organization_id,account_id,role,status) values
      (${orgA.id},${accounts[0]!},'org_owner','active'),
      (${orgA.id},${accounts[1]!},'member','active'),
      (${orgA.id},${accounts[2]!},'member','active'),
      (${orgB.id},${accounts[0]!},'org_owner','active'),
      (${orgB.id},${accounts[3]!},'member','active')
  `;
  return {
    alice: accounts[0]!,
    bob: accounts[1]!,
    carol: accounts[2]!,
    diana: accounts[3]!,
    orgA: orgA.id,
    orgB: orgB.id,
  };
}

describe("chat service", () => {
  test("creates direct chat only when both people share the selected organization", async () => {
    const a = await fixture();
    const service = new ChatService();
    await expect(
      sql.begin((tx) => service.createDirect(tx, a.alice, a.orgA, { accountId: a.diana })),
    ).rejects.toMatchObject({ code: "CHAT_FORBIDDEN" });
    const conversation = await sql.begin((tx) =>
      service.createDirect(tx, a.alice, a.orgA, { accountId: a.bob }),
    );
    expect(conversation).toMatchObject({ organizationId: a.orgA, kind: "direct" });
    expect(conversation.members.map((member) => member.accountId).sort()).toEqual(
      [a.alice, a.bob].sort(),
    );
  });

  test("does not let an organization member infer a group they did not join", async () => {
    const a = await fixture();
    const service = new ChatService();
    const conversation = await sql.begin((tx) =>
      service.createGroup(tx, a.alice, a.orgA, {
        title: "项目群",
        memberAccountIds: [a.bob],
      }),
    );
    await expect(
      sql.begin((tx) => service.readConversation(tx, a.carol, a.orgA, conversation.id)),
    ).rejects.toMatchObject({ code: "CHAT_NOT_FOUND" });
  });

  test("deduplicates the same client message ID and rejects a changed replay", async () => {
    const a = await fixture();
    const service = new ChatService();
    const conversation = await sql.begin((tx) =>
      service.createDirect(tx, a.alice, a.orgA, { accountId: a.bob }),
    );
    const input = { clientMessageId: crypto.randomUUID(), body: "你好" };
    const first = await sql.begin((tx) =>
      service.sendMessage(tx, a.alice, a.orgA, conversation.id, input),
    );
    const replay = await sql.begin((tx) =>
      service.sendMessage(tx, a.alice, a.orgA, conversation.id, input),
    );
    expect(replay).toEqual(first);
    await expect(
      sql.begin((tx) =>
        service.sendMessage(tx, a.alice, a.orgA, conversation.id, {
          ...input,
          body: "被篡改的重放",
        }),
      ),
    ).rejects.toMatchObject({ code: "CHAT_CONFLICT" });
  });

  test("deduplicates two concurrent sends from the same client message ID", async () => {
    const a = await fixture();
    const service = new ChatService();
    const conversation = await sql.begin((tx) =>
      service.createDirect(tx, a.alice, a.orgA, { accountId: a.bob }),
    );
    const input = { clientMessageId: crypto.randomUUID(), body: "只发送一次" };
    const [left, right] = await Promise.all([
      sql.begin((tx) => service.sendMessage(tx, a.alice, a.orgA, conversation.id, input)),
      sql.begin((tx) => service.sendMessage(tx, a.alice, a.orgA, conversation.id, input)),
    ]);
    expect(right).toEqual(left);
    const [count] = await sql<{ count: number }[]>`
      select count(*)::int count from chat_messages where conversation_id=${conversation.id}
    `;
    expect(count?.count).toBe(1);
  });

  test("assigns one gap-free server sequence under concurrent sends", async () => {
    const a = await fixture();
    const service = new ChatService();
    const conversation = await sql.begin((tx) =>
      service.createDirect(tx, a.alice, a.orgA, { accountId: a.bob }),
    );
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        sql.begin((tx) =>
          service.sendMessage(tx, index % 2 === 0 ? a.alice : a.bob, a.orgA, conversation.id, {
            clientMessageId: crypto.randomUUID(),
            body: `消息 ${index}`,
          }),
        ),
      ),
    );
    const history = await sql.begin((tx) =>
      service.listMessages(tx, a.alice, a.orgA, conversation.id, {}),
    );
    expect(history.items.map((message) => message.sequence)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
  });

  test("appends edit, reaction and retract events without mutating event history", async () => {
    const a = await fixture();
    const service = new ChatService();
    const conversation = await sql.begin((tx) =>
      service.createDirect(tx, a.alice, a.orgA, { accountId: a.bob }),
    );
    const message = await sql.begin((tx) =>
      service.sendMessage(tx, a.alice, a.orgA, conversation.id, {
        clientMessageId: crypto.randomUUID(),
        body: "初稿",
      }),
    );
    await sql.begin((tx) =>
      service.editMessage(tx, a.alice, a.orgA, conversation.id, message.id, { body: "修订" }),
    );
    await sql.begin((tx) =>
      service.setReaction(tx, a.bob, a.orgA, conversation.id, message.id, {
        emoji: "👍",
        active: true,
      }),
    );
    const retracted = await sql.begin((tx) =>
      service.retractMessage(tx, a.alice, a.orgA, conversation.id, message.id),
    );
    expect(retracted).toMatchObject({ status: "retracted", body: null });
    const events = await sql.begin((tx) =>
      service.listEvents(tx, a.bob, a.orgA, conversation.id, { afterSequence: 0 }),
    );
    expect(events.items.map((event) => event.eventType)).toEqual([
      "message.sent",
      "message.edited",
      "reaction.added",
      "message.retracted",
    ]);
    await expect(
      sql`update chat_events set event_type='tampered' where id=${events.items[0]!.id}`,
    ).rejects.toThrow(/append-only/);
  });
});
