import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { OrganizationService } from "../../src/organizations/organization-service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for organization integration tests");
}

let sql: DatabaseClient;
let organizations: OrganizationService;
let sequence = 0;

beforeAll(async () => {
  await resetTestDatabase(testDatabaseUrl);
  await migrateDatabase(testDatabaseUrl);
  sql = createDatabaseClient(testDatabaseUrl);
  organizations = new OrganizationService(sql);
}, 30_000);

beforeEach(async () => {
  await sql`truncate table audit_events, session_refresh_tokens, sessions, devices, memberships, organizations, phone_verifications, principals, accounts cascade`;
  sequence = 0;
});

afterAll(async () => {
  await sql?.end();
});

async function createAccount() {
  sequence += 1;
  const phone = `+8613800138${String(sequence).padStart(3, "0")}`;
  const [account] = await sql<{ id: string }[]>`
    insert into accounts (display_name, password_hash, phone_e164, phone_verified_at)
    values (${`Member ${sequence}`}, 'argon2id-fixture', ${phone}, now())
    returning id
  `;
  if (account === undefined) throw new Error("failed to create account fixture");
  return account.id;
}

describe("organization-scoped authorization", () => {
  test("valid member from another organization is forbidden", async () => {
    const ownerA = await createAccount();
    const ownerB = await createAccount();
    const orgA = await organizations.createOrganization(ownerA, "Organization A");
    await organizations.createOrganization(ownerB, "Organization B");

    await expect(organizations.listMembers(ownerB, orgA.id)).rejects.toMatchObject({
      code: "ORG_FORBIDDEN",
    });
  });

  test("ordinary member cannot add another member", async () => {
    const owner = await createAccount();
    const member = await createAccount();
    const target = await createAccount();
    const organization = await organizations.createOrganization(owner, "Tashan");
    await organizations.addMember(owner, organization.id, member, "member");

    await expect(
      organizations.addMember(member, organization.id, target, "member"),
    ).rejects.toMatchObject({ code: "ORG_FORBIDDEN" });
  });

  test("owner can add and list a member", async () => {
    const owner = await createAccount();
    const member = await createAccount();
    const organization = await organizations.createOrganization(owner, "Tashan");
    await organizations.addMember(owner, organization.id, member, "member");

    await expect(organizations.listMembers(member, organization.id)).resolves.toHaveLength(2);
  });
});
