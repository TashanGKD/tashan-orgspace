import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { FileService } from "../../src/files/file-service.js";
import { createOrganizationSpace } from "../../src/spaces/space-bootstrap.js";

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

async function fixture() {
  const ids: string[] = [];
  for (const [index, role] of ["org_owner", "member", "member"].entries()) {
    const [row] = await sql<{ id: string }[]>`
      insert into accounts (display_name, password_hash, phone_e164, phone_verified_at)
      values (${role}, 'hash', ${`+86138001385${String(index).padStart(2, "0")}`}, now()) returning id
    `;
    if (row === undefined) throw new Error("account fixture failed");
    ids.push(row.id);
  }
  const [organization] = await sql<
    { id: string }[]
  >`insert into organizations (name) values ('Files') returning id`;
  if (
    organization === undefined ||
    ids[0] === undefined ||
    ids[1] === undefined ||
    ids[2] === undefined
  )
    throw new Error("fixture failed");
  await sql`insert into memberships (organization_id, account_id, role, status) values
    (${organization.id}, ${ids[0]}, 'org_owner', 'active'),
    (${organization.id}, ${ids[1]}, 'member', 'active'),
    (${organization.id}, ${ids[2]}, 'member', 'active')`;
  const space = await sql.begin((tx) =>
    createOrganizationSpace(tx, organization.id, ids[0] as string),
  );
  return { owner: ids[0], editor: ids[1], viewer: ids[2], space } as const;
}

describe("file service", () => {
  test("creates, lists, moves, trashes and restores folders with stable conflicts", async () => {
    const { owner, editor, space } = await fixture();
    const service = new FileService(sql);
    const first = await service.createFolder(owner, space.id, {
      parentId: space.rootFolderId,
      name: "Project A",
      accessScope: "organization_public",
      grants: [],
    });
    const target = await service.createFolder(owner, space.id, {
      parentId: space.rootFolderId,
      name: "Archive",
      accessScope: "organization_public",
      grants: [],
    });
    await expect(service.list(editor, space.id, space.rootFolderId)).resolves.toHaveLength(2);
    await service.move(editor, space.id, first.id, {
      targetParentId: target.id,
      expectedVersion: first.lockVersion,
    });
    const trashed = await service.trash(owner, space.id, first.id);
    expect(trashed.expiresAt).toBeDefined();
    await service.createFolder(owner, space.id, {
      parentId: target.id,
      name: "Project A",
      accessScope: "organization_public",
      grants: [],
    });
    await expect(
      service.restore(owner, space.id, first.id, { expectedVersion: trashed.lockVersion }),
    ).rejects.toMatchObject({ code: "FILE_NAME_CONFLICT" });
    await expect(
      service.restore(owner, space.id, first.id, {
        name: "Project A restored",
        expectedVersion: trashed.lockVersion,
      }),
    ).resolves.toMatchObject({ state: "active" });
  });

  test("keeps restricted folder grants and search inside the caller scope", async () => {
    const { owner, editor, viewer, space } = await fixture();
    const service = new FileService(sql);
    const folder = await service.createFolder(owner, space.id, {
      parentId: space.rootFolderId,
      name: "Secret Partner",
      accessScope: "restricted",
      grants: [{ accountId: viewer, role: "viewer" }],
    });
    await expect(service.search(editor, space.id, "Secret")).resolves.toEqual([]);
    await expect(service.search(viewer, space.id, "Secret")).resolves.toHaveLength(1);
    await expect(
      service.setGrant(viewer, space.id, folder.id, {
        accountId: editor,
        role: "editor",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "FILE_FORBIDDEN" });
    await expect(
      service.setGrant(owner, space.id, folder.id, {
        accountId: editor,
        role: "editor",
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({
      grants: expect.arrayContaining([
        expect.objectContaining({ accountId: editor, role: "editor" }),
      ]),
    });
  });

  test("lets active organization admins inspect restricted metadata without reading bytes", async () => {
    const { owner, editor, viewer, space } = await fixture();
    const service = new FileService(sql, {
      async sign() {
        return "https://download.invalid/file";
      },
    });
    const folder = await service.createFolder(editor, space.id, {
      parentId: space.rootFolderId,
      name: "Restricted records",
      accessScope: "restricted",
      grants: [],
    });
    const [file] = await sql<{ id: string }[]>`
      insert into file_entries (
        space_id, parent_id, kind, name, normalized_name, created_by_account_id
      ) values (${space.id}, ${folder.id}, 'file', 'board.pdf', 'board.pdf', ${editor})
      returning id
    `;
    if (file === undefined) throw new Error("file fixture failed");

    await expect(service.list(owner, space.id, space.rootFolderId)).resolves.toEqual([
      expect.objectContaining({ id: folder.id, name: "Restricted records" }),
    ]);
    await expect(service.read(owner, space.id, folder.id)).resolves.toMatchObject({
      id: folder.id,
      effectiveRole: "viewer",
    });
    await expect(service.search(owner, space.id, "Restricted")).resolves.toEqual([
      expect.objectContaining({ id: folder.id }),
    ]);
    await expect(service.createDownload(owner, space.id, file.id)).rejects.toMatchObject({
      code: "FILE_FORBIDDEN",
    });

    await expect(service.list(viewer, space.id, space.rootFolderId)).resolves.toEqual([]);
    await expect(service.read(viewer, space.id, folder.id)).rejects.toMatchObject({
      code: "FILE_FORBIDDEN",
    });
    await expect(service.search(viewer, space.id, "Restricted")).resolves.toEqual([]);

    await sql`update memberships set status = 'removed', removed_at = now() where account_id = ${owner}`;
    await expect(service.list(owner, space.id, space.rootFolderId)).rejects.toMatchObject({
      code: "SPACE_FORBIDDEN",
    });
  });
});
