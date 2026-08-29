import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { PartnerService } from "../../src/partners/partner-service.js";
import { InteractionService } from "../../src/partners/interaction-service.js";
import { BlindIndex } from "../../src/security/blind-index.js";
import { SensitiveFieldCipher } from "../../src/security/sensitive-field-cipher.js";
import { FileService } from "../../src/files/file-service.js";
import { createOrganizationSpace } from "../../src/spaces/space-bootstrap.js";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
let sql: DatabaseClient;
beforeAll(async () => {
  await resetTestDatabase(url);
  await migrateDatabase(url);
  sql = createDatabaseClient(url);
}, 30000);
beforeEach(async () => {
  await sql`truncate table audit_events, outbox_events, session_refresh_tokens, sessions, devices, memberships, organizations, phone_verifications, principals, accounts cascade`;
});
afterAll(async () => sql?.end());
async function fixture() {
  const ids: string[] = [];
  for (const [i, n] of ["Admin", "Alice", "Bob"].entries()) {
    const [r] = await sql<
      { id: string }[]
    >`insert into accounts (display_name,password_hash,phone_e164,phone_verified_at) values (${n},'hash',${`+861380013848${i}`},now()) returning id`;
    if (!r) throw new Error();
    ids.push(r.id);
  }
  const [admin, alice, bob] = ids;
  const [orgA] = await sql<
    { id: string }[]
  >`insert into organizations(name) values('A') returning id`;
  const [orgB] = await sql<
    { id: string }[]
  >`insert into organizations(name) values('B') returning id`;
  if (!admin || !alice || !bob || !orgA || !orgB) throw new Error();
  await sql`insert into memberships(organization_id,account_id,role,status) values (${orgA.id},${admin},'org_owner','active'),(${orgA.id},${alice},'member','active'),(${orgA.id},${bob},'member','active'),(${orgB.id},${admin},'org_owner','active')`;
  return { admin, alice, bob, orgA: orgA.id, orgB: orgB.id };
}
const services = () => {
  const partners = new PartnerService({
    cipher: new SensitiveFieldCipher({
      activeVersion: 1,
      keys: new Map([[1, Buffer.alloc(32, 1)]]),
    }),
    blindIndex: new BlindIndex(Buffer.alloc(32, 2)),
  });
  return { partners, interactions: new InteractionService(partners) };
};

describe("partner interactions", () => {
  test("appends corrections without mutating history", async () => {
    const a = await fixture(),
      s = services();
    const p = await sql.begin((tx) =>
      s.partners.create(tx, a.alice, a.orgA, { name: "张三", cooperationStage: "lead", tags: [] }),
    );
    const first = await sql.begin((tx) =>
      s.interactions.add(
        tx,
        a.alice,
        a.orgA,
        p.id,
        {
          contactedAt: "2026-08-29T08:00:00.000Z",
          channel: "phone",
          summary: "初次联系",
          requiresFollowUp: false,
          links: [],
        },
        "interaction-1",
      ),
    );
    const correction = await sql.begin((tx) =>
      s.interactions.add(
        tx,
        a.alice,
        a.orgA,
        p.id,
        {
          contactedAt: "2026-08-29T08:10:00.000Z",
          channel: "phone",
          summary: "修正摘要",
          requiresFollowUp: false,
          correctsInteractionId: first.id,
          links: [],
        },
        "interaction-2",
      ),
    );
    expect(correction.correctsInteractionId).toBe(first.id);
    await expect(
      sql`update partner_interactions set summary='tamper' where id=${first.id}`,
    ).rejects.toThrow(/append-only/);
    await expect(sql`delete from partner_interactions where id=${first.id}`).rejects.toThrow(
      /append-only/,
    );
    expect(await sql.begin((tx) => s.interactions.list(tx, a.alice, a.orgA, p.id))).toHaveLength(2);
  });
  test("replays one interaction and one follow-up task for a repeated idempotency key", async () => {
    const a = await fixture(),
      s = services();
    const p = await sql.begin((tx) =>
      s.partners.create(tx, a.alice, a.orgA, { name: "张三", cooperationStage: "lead", tags: [] }),
    );
    const input = {
      contactedAt: "2026-08-29T08:00:00.000Z",
      channel: "wechat",
      summary: "需要材料",
      requiresFollowUp: true,
      followUp: { type: "task", title: "发送材料" },
      links: [],
    };
    const one = await sql.begin((tx) =>
      s.interactions.add(tx, a.alice, a.orgA, p.id, input, "same-key"),
    );
    const two = await sql.begin((tx) =>
      s.interactions.add(tx, a.alice, a.orgA, p.id, input, "same-key"),
    );
    expect(two.id).toBe(one.id);
    const [counts] = await sql<
      { interactions: number; work: number }[]
    >`select (select count(*)::int from partner_interactions) interactions,(select count(*)::int from work_items where title='发送材料') work`;
    expect(counts).toEqual({ interactions: 1, work: 1 });
  });
  test("rejects cross-organization work and unreadable file links atomically", async () => {
    const a = await fixture(),
      s = services();
    const p = await sql.begin((tx) =>
      s.partners.create(tx, a.alice, a.orgA, { name: "张三", cooperationStage: "lead", tags: [] }),
    );
    const [outside] = await sql<
      { id: string }[]
    >`insert into work_items(organization_id,type,title,priority,created_by_account_id) values(${a.orgB},'task','outside','normal',${a.admin}) returning id`;
    if (!outside) throw new Error();
    await expect(
      sql.begin((tx) =>
        s.interactions.add(
          tx,
          a.alice,
          a.orgA,
          p.id,
          {
            contactedAt: "2026-08-29T08:00:00.000Z",
            channel: "meeting",
            summary: "bad",
            requiresFollowUp: false,
            links: [{ type: "task", workItemId: outside.id }],
          },
          "bad-work",
        ),
      ),
    ).rejects.toMatchObject({ code: "PARTNER_FORBIDDEN" });
    const space = await sql.begin((tx) => createOrganizationSpace(tx, a.orgA, a.admin));
    const folder = await new FileService(sql).createFolder(a.bob, space.id, {
      parentId: space.rootFolderId,
      name: "Bob private",
      accessScope: "restricted",
      grants: [],
    });
    const [file] = await sql<
      { id: string }[]
    >`insert into file_entries(space_id,parent_id,kind,name,normalized_name,created_by_account_id) values(${space.id},${folder.id},'file','secret.txt','secret.txt',${a.bob}) returning id`;
    if (!file) throw new Error();
    await expect(
      sql.begin((tx) =>
        s.interactions.add(
          tx,
          a.alice,
          a.orgA,
          p.id,
          {
            contactedAt: "2026-08-29T08:00:00.000Z",
            channel: "meeting",
            summary: "bad file",
            requiresFollowUp: false,
            links: [{ type: "file", spaceId: space.id, entryId: file.id }],
          },
          "bad-file",
        ),
      ),
    ).rejects.toMatchObject({ code: "PARTNER_FORBIDDEN" });
    expect(
      (await sql<{ count: number }[]>`select count(*)::int count from partner_interactions`)[0]
        ?.count,
    ).toBe(0);
  });
  test("rejects a removed owner's old session", async () => {
    const a = await fixture(),
      s = services();
    const p = await sql.begin((tx) =>
      s.partners.create(tx, a.alice, a.orgA, { name: "张三", cooperationStage: "lead", tags: [] }),
    );
    await sql`update memberships set status='removed',removed_at=now() where organization_id=${a.orgA} and account_id=${a.alice}`;
    await expect(
      sql.begin((tx) =>
        s.interactions.add(
          tx,
          a.alice,
          a.orgA,
          p.id,
          {
            contactedAt: "2026-08-29T08:00:00.000Z",
            channel: "phone",
            summary: "stale",
            requiresFollowUp: false,
            links: [],
          },
          "stale",
        ),
      ),
    ).rejects.toMatchObject({ code: "PARTNER_NOT_FOUND" });
  });
});
