import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required");

let sql: DatabaseClient;

beforeAll(async () => {
  await resetTestDatabase(testDatabaseUrl);
  await migrateDatabase(testDatabaseUrl);
  sql = createDatabaseClient(testDatabaseUrl);
}, 30_000);

beforeEach(async () => {
  await sql`truncate table audit_events, session_refresh_tokens, sessions, devices, memberships, organizations, phone_verifications, principals, accounts cascade`;
});

afterAll(async () => sql?.end());

async function account() {
  const [row] = await sql<{ id: string }[]>`
    insert into accounts (display_name, password_hash, phone_e164, phone_verified_at)
    values ('File owner', 'argon2id-fixture', '+8613800138999', now()) returning id
  `;
  if (row === undefined) throw new Error("account fixture failed");
  return row.id;
}

describe("spaces and files migration", () => {
  test("creates every Phase 1 control-plane table", async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any(${[
        "spaces",
        "personal_quota_entitlements",
        "file_entries",
        "file_versions",
        "folder_access_policies",
        "folder_grants",
        "upload_sessions",
        "upload_parts",
        "storage_reservations",
        "trash_entries",
        "file_maintenance_jobs",
      ]})
    `;
    expect(rows).toHaveLength(11);
  });

  test("enforces one space per owner and non-negative counters", async () => {
    const accountId = await account();
    const rootA = crypto.randomUUID();
    await sql.begin(async (transaction) => {
      await transaction`
        insert into spaces (type, account_id, quota_bytes, root_folder_id)
        values ('personal', ${accountId}, 53687091200, ${rootA})
      `;
      await transaction`
        insert into file_entries (id, space_id, kind, name, normalized_name, created_by_account_id)
        select ${rootA}, id, 'folder', '.root', '.root', ${accountId}
        from spaces where account_id = ${accountId}
      `;
    });
    await expect(sql`
      insert into spaces (type, account_id, quota_bytes, root_folder_id)
      values ('personal', ${accountId}, 53687091200, ${crypto.randomUUID()})
    `).rejects.toThrow(/spaces_one_personal_per_account/);
    await expect(
      sql`update spaces set used_bytes = -1 where account_id = ${accountId}`,
    ).rejects.toThrow(/spaces_used_bytes_check/);
  });

  test("rejects cross-space parents and versions on folders", async () => {
    const accountId = await account();
    const [organization] = await sql<{ id: string }[]>`
      insert into organizations (name) values ('Files Org') returning id
    `;
    if (organization === undefined) throw new Error("organization fixture failed");
    const personalSpaceId = crypto.randomUUID();
    const orgSpaceId = crypto.randomUUID();
    const personalRoot = crypto.randomUUID();
    const orgRoot = crypto.randomUUID();
    await sql.begin(async (transaction) => {
      await transaction`
        insert into spaces (id, type, account_id, quota_bytes, root_folder_id)
        values (${personalSpaceId}, 'personal', ${accountId}, 53687091200, ${personalRoot})
      `;
      await transaction`
        insert into spaces (id, type, organization_id, quota_bytes, root_folder_id)
        values (${orgSpaceId}, 'organization', ${organization.id}, 536870912000, ${orgRoot})
      `;
      await transaction`
        insert into file_entries (id, space_id, kind, name, normalized_name, created_by_account_id) values
        (${personalRoot}, ${personalSpaceId}, 'folder', '.root', '.root', ${accountId}),
        (${orgRoot}, ${orgSpaceId}, 'folder', '.root', '.root', ${accountId})
      `;
    });
    await expect(sql`
      insert into file_entries (space_id, parent_id, kind, name, normalized_name, created_by_account_id)
      values (${personalSpaceId}, ${orgRoot}, 'file', 'bad.txt', 'bad.txt', ${accountId})
    `).rejects.toThrow(/file entry parent must belong to the same space/);
    await expect(sql`
      insert into file_versions (
        file_entry_id, version_number, object_key, size_bytes, content_type,
        checksum_sha256, status, created_by_account_id
      ) values (${orgRoot}, 1, 'versions/folder', 1, 'text/plain', ${"a".repeat(64)}, 'available', ${accountId})
    `).rejects.toThrow(/file version requires a file entry/);
  });

  test("keeps upload history while clearing references to permanently deleted files", async () => {
    const accountId = await account();
    const spaceId = crypto.randomUUID();
    const rootId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const uploadId = crypto.randomUUID();
    await sql.begin(async (transaction) => {
      await transaction`
        insert into spaces (id, type, account_id, quota_bytes, root_folder_id)
        values (${spaceId}, 'personal', ${accountId}, 53687091200, ${rootId})
      `;
      await transaction`
        insert into file_entries (
          id, space_id, parent_id, kind, name, normalized_name, created_by_account_id
        )
        values
          (${rootId}, ${spaceId}, null, 'folder', '.root', '.root', ${accountId}),
          (${fileId}, ${spaceId}, ${rootId}, 'file', 'history.bin', 'history.bin', ${accountId})
      `;
      await transaction`
        insert into file_versions (
          id, file_entry_id, version_number, object_key, size_bytes, content_type,
          checksum_sha256, status, created_by_account_id
        ) values (
          ${versionId}, ${fileId}, 1, ${`versions/${versionId}`}, 1,
          'application/octet-stream', ${"a".repeat(64)}, 'available', ${accountId}
        )
      `;
      await transaction`update file_entries set current_version_id = ${versionId} where id = ${fileId}`;
      await transaction`
        insert into upload_sessions (
          id, space_id, parent_id, target_file_id, created_by_account_id, file_name,
          normalized_name, content_type, expected_size_bytes, expected_sha256,
          temporary_object_key, part_size_bytes, part_count, status, expires_at,
          completed_version_id, idempotency_key
        ) values (
          ${uploadId}, ${spaceId}, ${rootId}, ${fileId}, ${accountId}, 'history.bin',
          'history.bin', 'application/octet-stream', 1, ${"a".repeat(64)},
          ${`temporary/${uploadId}`}, 16777216, 1, 'completed', now() + interval '1 hour',
          ${versionId}, 'history-upload'
        )
      `;
    });

    await expect(
      sql`delete from file_entries where id = ${fileId} returning id`,
    ).resolves.toHaveLength(1);
    const [history] = await sql<
      { target_file_id: string | null; completed_version_id: string | null }[]
    >`select target_file_id, completed_version_id from upload_sessions where id = ${uploadId}`;
    expect(history).toEqual({ target_file_id: null, completed_version_id: null });
  });
});
