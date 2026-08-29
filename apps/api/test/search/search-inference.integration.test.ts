import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { ChatService } from "../../src/chat/chat-service.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { SearchService } from "../../src/search/search-service.js";

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
  const people: Record<string, string> = {};
  for (const [index, name] of ["管理员", "量子成员", "量子同事", "已移除成员"].entries()) {
    const [row] = await sql<{ id: string }[]>`
      insert into accounts(display_name,password_hash,phone_e164,phone_verified_at)
      values(${name},'hash',${`+86138001386${String(index).padStart(2, "0")}`},now())returning id
    `;
    people[name] = row!.id;
  }
  const [org] = await sql<
    { id: string }[]
  >`insert into organizations(name)values('Search')returning id`;
  const admin = people["管理员"]!,
    bob = people["量子成员"]!,
    carol = people["量子同事"]!,
    removed = people["已移除成员"]!;
  await sql`
    insert into memberships(organization_id,account_id,role,status,removed_at)values
      (${org!.id},${admin},'org_owner','active',null),
      (${org!.id},${bob},'member','active',null),
      (${org!.id},${carol},'member','active',null),
      (${org!.id},${removed},'member','removed',now())
  `;
  await sql`insert into work_items(organization_id,type,title,description,created_by_account_id)values(${org!.id},'task','量子任务','公开工作',${admin})`;
  await sql`insert into okr_objectives(organization_id,owner_account_id,title,cycle)values(${org!.id},${bob},'量子目标','2026-Q3')`;
  await sql`insert into partners(organization_id,owner_account_id,created_by_account_id,name,cooperation_stage,tags)values(${org!.id},${bob},${bob},'量子合作方 Bob','lead','{}'),(${org!.id},${carol},${carol},'量子合作方 Carol','lead','{}')`;

  const spaceId = crypto.randomUUID(),
    rootId = crypto.randomUUID(),
    restrictedId = crypto.randomUUID();
  await sql.begin(async (tx) => {
    await tx`set constraints all deferred`;
    await tx`insert into spaces(id,type,organization_id,quota_bytes,root_folder_id)values(${spaceId},'organization',${org!.id},536870912000,${rootId})`;
    await tx`insert into file_entries(id,space_id,parent_id,kind,name,normalized_name,created_by_account_id)values(${rootId},${spaceId},null,'folder','Root','root',${admin}),(${restrictedId},${spaceId},${rootId},'folder','Restricted','restricted',${carol})`;
    await tx`insert into folder_access_policies(folder_id,scope,updated_by_account_id)values(${rootId},'organization_public',${admin}),(${restrictedId},'restricted',${carol})`;
    await tx`insert into folder_grants(folder_id,account_id,role,granted_by_account_id)values(${rootId},${admin},'manager',${admin}),(${restrictedId},${carol},'manager',${carol})`;
    await tx`insert into file_entries(space_id,parent_id,kind,name,normalized_name,created_by_account_id)values(${spaceId},${rootId},'file','量子公开文件','量子公开文件',${admin}),(${spaceId},${restrictedId},'file','量子秘密文件','量子秘密文件',${carol})`;
  });

  const chat = new ChatService();
  const bobChat = await sql.begin((tx) =>
    chat.createDirect(tx, admin, org!.id, { accountId: bob }),
  );
  const bobMessage = await sql.begin((tx) =>
    chat.sendMessage(tx, admin, org!.id, bobChat.id, {
      clientMessageId: crypto.randomUUID(),
      body: "量子公开消息",
    }),
  );
  const withdrawn = await sql.begin((tx) =>
    chat.sendMessage(tx, admin, org!.id, bobChat.id, {
      clientMessageId: crypto.randomUUID(),
      body: "量子撤回消息",
    }),
  );
  await sql.begin((tx) => chat.retractMessage(tx, admin, org!.id, bobChat.id, withdrawn.id));
  const carolChat = await sql.begin((tx) =>
    chat.createDirect(tx, admin, org!.id, { accountId: carol }),
  );
  await sql.begin((tx) =>
    chat.sendMessage(tx, admin, org!.id, carolChat.id, {
      clientMessageId: crypto.randomUUID(),
      body: "量子秘密消息",
    }),
  );
  return { org: org!.id, admin, bob, removed, bobMessage: bobMessage.id };
}

describe("authorized search", () => {
  test("returns only authorized references and counts without restricted inference", async () => {
    const a = await fixture(),
      service = new SearchService();
    const result = await sql.begin((tx) =>
      service.search(tx, a.bob, a.org, { query: "量子", limit: 30 }),
    );
    const hits = result.groups.flatMap((group) => group.items);
    expect(new Set(result.groups.map((group) => group.type))).toEqual(
      new Set(["file", "work_item", "objective", "partner", "member", "message"]),
    );
    expect(hits.some((hit) => hit.title.includes("秘密"))).toBe(false);
    expect(hits.some((hit) => hit.title.includes("撤回"))).toBe(false);
    expect(hits.filter((hit) => hit.type === "partner")).toHaveLength(1);
    expect(hits.filter((hit) => hit.type === "message")).toHaveLength(1);
    expect(result.totalAuthorized).toBe(hits.length);
    expect(JSON.stringify(result)).not.toContain("量子合作方 Carol");
  });

  test("lets administrators see organization records but still returns no hidden totals", async () => {
    const a = await fixture(),
      service = new SearchService();
    const result = await sql.begin((tx) =>
      service.search(tx, a.admin, a.org, { query: "量子", limit: 30 }),
    );
    const hits = result.groups.flatMap((group) => group.items);
    expect(hits.filter((hit) => hit.type === "partner")).toHaveLength(2);
    expect(hits.filter((hit) => hit.type === "message")).toHaveLength(2);
    expect(result).not.toHaveProperty("totalAvailable");
  });

  test("does not serve a stale result after organization membership is removed", async () => {
    const a = await fixture(),
      service = new SearchService();
    await expect(
      sql.begin((tx) => service.search(tx, a.removed, a.org, { query: "量子" })),
    ).rejects.toMatchObject({ code: "ORG_FORBIDDEN" });
  });
});
