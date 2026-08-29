import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { requireFilePermission } from "../../src/files/file-authorization.js";
import { FileRepository } from "../../src/files/file-repository.js";
import { createOrganizationSpace, createPersonalSpace } from "../../src/spaces/space-bootstrap.js";

const url = process.env.TEST_DATABASE_URL;
if (url === undefined) throw new Error("TEST_DATABASE_URL is required");
let sql: DatabaseClient;

beforeAll(async () => {
  await resetTestDatabase(url);
  await migrateDatabase(url);
  sql = createDatabaseClient(url);
}, 30_000);
beforeEach(async () => {
  await sql`truncate table audit_events, session_refresh_tokens, sessions, devices, memberships, organizations, phone_verifications, principals, accounts cascade`;
});
afterAll(async () => sql?.end());

async function account(phone: string) {
  const [row] = await sql<{ id: string }[]>`
    insert into accounts (display_name, password_hash, phone_e164, phone_verified_at)
    values (${phone}, 'hash', ${phone}, now()) returning id
  `;
  if (row === undefined) throw new Error("account fixture failed");
  return row.id;
}

describe("file authorization", () => {
  test("keeps personal spaces private", async () => {
    const owner = await account("+8613800138701");
    const other = await account("+8613800138702");
    const space = await sql.begin((transaction) => createPersonalSpace(transaction, owner));
    await expect(
      sql.begin((transaction) =>
        requireFilePermission(transaction, {
          accountId: owner,
          spaceId: space.id,
          permission: "manage",
        }),
      ),
    ).resolves.toMatchObject({ effectiveRole: "manager" });
    await expect(
      sql.begin((transaction) =>
        requireFilePermission(transaction, {
          accountId: other,
          spaceId: space.id,
          permission: "metadata",
        }),
      ),
    ).rejects.toMatchObject({ code: "SPACE_FORBIDDEN" });
  });

  test("uses public membership and restricted grants without an admin content bypass", async () => {
    const owner = await account("+8613800138711");
    const admin = await account("+8613800138712");
    const editor = await account("+8613800138713");
    const viewer = await account("+8613800138714");
    const outsider = await account("+8613800138715");
    const [organization] = await sql<
      { id: string }[]
    >`insert into organizations (name) values ('Org') returning id`;
    if (organization === undefined) throw new Error("org fixture failed");
    for (const [id, role] of [
      [owner, "org_owner"],
      [admin, "org_admin"],
      [editor, "member"],
      [viewer, "member"],
    ] as const) {
      await sql`insert into memberships (organization_id, account_id, role, status) values (${organization.id}, ${id}, ${role}, 'active')`;
    }
    const space = await sql.begin((transaction) =>
      createOrganizationSpace(transaction, organization.id, owner),
    );
    const restricted = crypto.randomUUID();
    await sql`
      insert into file_entries (id, space_id, parent_id, kind, name, normalized_name, created_by_account_id)
      values (${restricted}, ${space.id}, ${space.rootFolderId}, 'folder', 'Restricted', 'restricted', ${owner})
    `;
    await sql`insert into folder_access_policies (folder_id, scope, updated_by_account_id) values (${restricted}, 'restricted', ${owner})`;
    await sql`insert into folder_grants (folder_id, account_id, role, granted_by_account_id) values
      (${restricted}, ${owner}, 'manager', ${owner}),
      (${restricted}, ${editor}, 'editor', ${owner}),
      (${restricted}, ${viewer}, 'viewer', ${owner})`;

    await expect(
      sql.begin((tx) =>
        requireFilePermission(tx, {
          accountId: editor,
          spaceId: space.id,
          entryId: space.rootFolderId,
          permission: "write",
        }),
      ),
    ).resolves.toMatchObject({ effectiveRole: "editor" });
    await expect(
      sql.begin((tx) =>
        requireFilePermission(tx, {
          accountId: editor,
          spaceId: space.id,
          entryId: restricted,
          permission: "write",
        }),
      ),
    ).resolves.toMatchObject({ effectiveRole: "editor" });
    await expect(
      sql.begin((tx) =>
        requireFilePermission(tx, {
          accountId: viewer,
          spaceId: space.id,
          entryId: restricted,
          permission: "write",
        }),
      ),
    ).rejects.toMatchObject({ code: "FILE_FORBIDDEN" });
    await expect(
      sql.begin((tx) =>
        requireFilePermission(tx, {
          accountId: admin,
          spaceId: space.id,
          entryId: restricted,
          permission: "metadata",
        }),
      ),
    ).resolves.toBeDefined();
    await expect(
      sql.begin((tx) =>
        requireFilePermission(tx, {
          accountId: admin,
          spaceId: space.id,
          entryId: restricted,
          permission: "read",
        }),
      ),
    ).rejects.toMatchObject({ code: "FILE_FORBIDDEN" });
    await expect(
      sql.begin((tx) =>
        requireFilePermission(tx, {
          accountId: outsider,
          spaceId: space.id,
          entryId: restricted,
          permission: "metadata",
        }),
      ),
    ).rejects.toMatchObject({ code: "SPACE_FORBIDDEN" });

    const repository = new FileRepository();
    await expect(
      sql.begin((tx) =>
        repository.revokeFolderGrant(tx, { folderId: restricted, accountId: owner }),
      ),
    ).rejects.toMatchObject({ code: "FOLDER_LAST_MANAGER" });
  });
});
