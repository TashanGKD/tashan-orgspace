import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { PartnerService } from "../../src/partners/partner-service.js";
import { BlindIndex } from "../../src/security/blind-index.js";
import { SensitiveFieldCipher } from "../../src/security/sensitive-field-cipher.js";

const url = process.env.TEST_DATABASE_URL;
if (url === undefined) throw new Error("TEST_DATABASE_URL is required");
let sql: DatabaseClient;
beforeAll(async () => {
  await resetTestDatabase(url);
  await migrateDatabase(url);
  sql = createDatabaseClient(url);
}, 30_000);
beforeEach(async () => {
  await sql`truncate table audit_events, outbox_events, session_refresh_tokens, sessions, devices, memberships, organizations, phone_verifications, principals, accounts cascade`;
});
afterAll(async () => sql?.end());

async function fixture() {
  const ids: string[] = [];
  for (const [index, name] of ["Admin", "Alice", "Bob", "Outside"].entries()) {
    const [row] = await sql<
      { id: string }[]
    >`insert into accounts (display_name, password_hash, phone_e164, phone_verified_at) values (${name}, 'hash', ${`+861380013847${index}`}, now()) returning id`;
    if (!row) throw new Error("account missing");
    ids.push(row.id);
  }
  const [admin, alice, bob, outside] = ids;
  const [orgA] = await sql<
    { id: string }[]
  >`insert into organizations (name) values ('Partner A') returning id`;
  const [orgB] = await sql<
    { id: string }[]
  >`insert into organizations (name) values ('Partner B') returning id`;
  if (!admin || !alice || !bob || !outside || !orgA || !orgB) throw new Error("fixture failed");
  await sql`insert into memberships (organization_id, account_id, role, status) values (${orgA.id}, ${admin}, 'org_owner', 'active'), (${orgA.id}, ${alice}, 'member', 'active'), (${orgA.id}, ${bob}, 'member', 'active'), (${orgB.id}, ${outside}, 'member', 'active')`;
  return { admin, alice, bob, outside, orgA: orgA.id, orgB: orgB.id };
}
const service = () =>
  new PartnerService({
    cipher: new SensitiveFieldCipher({
      activeVersion: 1,
      keys: new Map([[1, Buffer.alloc(32, 1)]]),
    }),
    blindIndex: new BlindIndex(Buffer.alloc(32, 2)),
  });

describe("partner service", () => {
  test("isolates owner records and gives administrators explicit all scope", async () => {
    const a = await fixture();
    const partners = service();
    const mine = await sql.begin((tx) =>
      partners.create(tx, a.alice, a.orgA, {
        name: "张三",
        organizationName: "研究院",
        phone: "13812345678",
        cooperationStage: "contacting",
        tags: [],
      }),
    );
    await sql.begin((tx) =>
      partners.create(tx, a.bob, a.orgA, { name: "李四", cooperationStage: "lead", tags: [] }),
    );
    expect(await sql.begin((tx) => partners.list(tx, a.alice, a.orgA, { owner: "self" }))).toEqual([
      expect.objectContaining({ id: mine.id, phoneMasked: "+86 138****5678" }),
    ]);
    expect(
      await sql.begin((tx) => partners.list(tx, a.admin, a.orgA, { owner: "all" })),
    ).toHaveLength(2);
    await expect(
      sql.begin((tx) => partners.list(tx, a.alice, a.orgA, { owner: "all" })),
    ).rejects.toMatchObject({ code: "PARTNER_NOT_FOUND" });
  });

  test("returns the same not-found response for another member and a random ID", async () => {
    const a = await fixture();
    const partners = service();
    const created = await sql.begin((tx) =>
      partners.create(tx, a.alice, a.orgA, { name: "张三", cooperationStage: "lead", tags: [] }),
    );
    for (const id of [created.id, crypto.randomUUID()])
      await expect(sql.begin((tx) => partners.read(tx, a.bob, a.orgA, id))).rejects.toMatchObject({
        code: "PARTNER_NOT_FOUND",
      });
  });

  test("stores no contact plaintext and decrypts only authorized detail", async () => {
    const a = await fixture();
    const partners = service();
    const created = await sql.begin((tx) =>
      partners.create(tx, a.alice, a.orgA, {
        name: "张三",
        phone: "13812345678",
        wechat: "wx-secret",
        email: "z@example.com",
        address: "北京市海淀区",
        cooperationStage: "active",
        tags: [],
      }),
    );
    const [stored] = await sql<
      {
        phone_cipher: unknown;
        wechat_cipher: unknown;
        email_cipher: unknown;
        address_cipher: unknown;
        phone_blind_index: string;
      }[]
    >`select phone_cipher, wechat_cipher, email_cipher, address_cipher, phone_blind_index from partners where id = ${created.id}`;
    expect(JSON.stringify(stored)).not.toMatch(/13812345678|wx-secret|z@example|海淀/);
    expect(stored?.phone_blind_index).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await sql.begin((tx) => partners.read(tx, a.alice, a.orgA, created.id))).toMatchObject({
      phone: "+8613812345678",
      wechat: "wx-secret",
      email: "z@example.com",
      address: "北京市海淀区",
    });
    const updated = await sql.begin((tx) =>
      partners.update(tx, a.alice, a.orgA, created.id, {
        phone: "13987654321",
        expectedVersion: 1,
      }),
    );
    expect(updated.phone).toBe("+8613987654321");
    const [after] = await sql<{ phone_cipher: unknown }[]>`
      select phone_cipher from partners where id = ${created.id}
    `;
    expect(JSON.stringify(after)).not.toContain("13987654321");
  });

  test("archives, restores, transfers and moves removed owners to awaiting owner", async () => {
    const a = await fixture();
    const partners = service();
    const created = await sql.begin((tx) =>
      partners.create(tx, a.alice, a.orgA, { name: "张三", cooperationStage: "lead", tags: [] }),
    );
    const archived = await sql.begin((tx) =>
      partners.archive(tx, a.alice, a.orgA, created.id, { expectedVersion: 1 }),
    );
    expect(archived.recordState).toBe("archived");
    const restored = await sql.begin((tx) =>
      partners.restore(tx, a.alice, a.orgA, created.id, { expectedVersion: 2 }),
    );
    expect(restored.recordState).toBe("active");
    await expect(
      sql.begin((tx) =>
        partners.transfer(tx, a.alice, a.orgA, created.id, {
          accountId: a.outside,
          expectedVersion: 3,
        }),
      ),
    ).rejects.toMatchObject({ code: "PARTNER_FORBIDDEN" });
    const transferred = await sql.begin((tx) =>
      partners.transfer(tx, a.alice, a.orgA, created.id, { accountId: a.bob, expectedVersion: 3 }),
    );
    expect(transferred.ownerAccountId).toBe(a.bob);
    await sql`update memberships set status = 'removed', removed_at = now() where organization_id = ${a.orgA} and account_id = ${a.bob}`;
    expect(await sql.begin((tx) => partners.reconcileRemovedOwners(tx, a.orgA))).toBe(1);
    expect(
      await sql.begin((tx) =>
        partners.list(tx, a.admin, a.orgA, { owner: "all", recordState: "awaiting_owner" }),
      ),
    ).toEqual([expect.objectContaining({ id: created.id })]);
  });
});
