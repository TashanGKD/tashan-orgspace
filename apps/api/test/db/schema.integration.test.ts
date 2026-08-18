import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for database integration tests");
}

let sql: DatabaseClient;
let identityFixtureSequence = 0;

beforeAll(async () => {
  await resetTestDatabase(testDatabaseUrl);
  await migrateDatabase(testDatabaseUrl);
  sql = createDatabaseClient(testDatabaseUrl);
}, 30_000);

afterAll(async () => {
  await sql?.end();
});

async function columnNames(table: string): Promise<string[]> {
  const rows = await sql<{ column_name: string }[]>`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = ${table}
    order by ordinal_position
  `;
  return rows.map(({ column_name: columnName }) => columnName);
}

async function createIdentityFixture() {
  identityFixtureSequence += 1;
  const username = `alice-${identityFixtureSequence}`;
  const [account] = await sql<{ id: string }[]>`
    insert into accounts (username, password_hash)
    values (${username}, 'argon2id-fixture')
    returning id
  `;
  if (account === undefined) throw new Error("failed to create account fixture");
  const [principal] = await sql<{ id: string }[]>`
    insert into principals (account_id, type)
    values (${account.id}, 'human')
    returning id
  `;
  const [organization] = await sql<{ id: string }[]>`
    insert into organizations (name)
    values ('Tashan')
    returning id
  `;
  if (principal === undefined || organization === undefined) {
    throw new Error("failed to create identity fixture");
  }
  return { account, principal, organization };
}

describe("Phase 0 database schema", () => {
  test("creates the device-bound session columns", async () => {
    expect(await columnNames("sessions")).toEqual(
      expect.arrayContaining([
        "device_id",
        "refresh_token_hash",
        "token_version",
        "expires_at",
        "revoked_at",
      ]),
    );
  });

  test("rejects duplicate active membership and invalid roles in PostgreSQL", async () => {
    const { account, organization } = await createIdentityFixture();
    await sql`
      insert into memberships (organization_id, account_id, role, status)
      values (${organization.id}, ${account.id}, 'member', 'active')
    `;

    await expect(
      sql`
        insert into memberships (organization_id, account_id, role, status)
        values (${organization.id}, ${account.id}, 'member', 'active')
      `,
    ).rejects.toThrow(/memberships_one_active_per_account/);

    await expect(
      sql`
        insert into memberships (organization_id, account_id, role, status)
        values (${organization.id}, ${account.id}, 'admin', 'active')
      `,
    ).rejects.toThrow(/memberships_role_check/);
  });

  test("rejects duplicate refresh token hashes in PostgreSQL", async () => {
    const { account, principal } = await createIdentityFixture();
    const deviceIds = [
      "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
      "84ecfe2e-c11a-4a56-8735-934955bef834",
    ] as const;
    for (const [index, deviceId] of deviceIds.entries()) {
      await sql`
        insert into devices (id, account_id, name, os, architecture, client_version)
        values (${deviceId}, ${account.id}, ${`device-${index}`}, 'darwin', 'arm64', '0.1.0')
      `;
    }
    await sql`
      insert into sessions (
        account_id, principal_id, device_id, refresh_token_hash,
        token_version, client_channel, expires_at
      ) values (
        ${account.id}, ${principal.id}, ${deviceIds[0]}, 'same-refresh-hash',
        1, 'cli', now() + interval '30 days'
      )
    `;

    await expect(
      sql`
        insert into sessions (
          account_id, principal_id, device_id, refresh_token_hash,
          token_version, client_channel, expires_at
        ) values (
          ${account.id}, ${principal.id}, ${deviceIds[1]}, 'same-refresh-hash',
          1, 'cli', now() + interval '30 days'
        )
      `,
    ).rejects.toThrow(/sessions_refresh_token_hash_key/);
  });

  test("makes audit events append-only even for the migration owner", async () => {
    const { account, principal, organization } = await createIdentityFixture();
    await sql`
      insert into audit_events (
        organization_id, account_id, principal_id, server_ip, proxy_chain,
        actor_source, capability_id, action, result, request_id, event_hash, chain_position
      ) values (
        ${organization.id}, ${account.id}, ${principal.id}, '127.0.0.1', '[]'::jsonb,
        'cli', 'organization.list', 'organization.list', 'success',
        '746fb70b-a27e-4a78-a231-aa55ef8c343e', 'fixture-hash', 1
      )
    `;

    await expect(sql`update audit_events set action = 'tampered'`).rejects.toThrow(
      /audit_events are append-only/,
    );
    await expect(sql`delete from audit_events`).rejects.toThrow(/audit_events are append-only/);
  });

  test("grants the application role audit insert/select but not update/delete", async () => {
    const [privileges] = await sql<
      { can_insert: boolean; can_select: boolean; can_update: boolean; can_delete: boolean }[]
    >`
      select
        has_table_privilege('orgspace_app', 'audit_events', 'INSERT') as can_insert,
        has_table_privilege('orgspace_app', 'audit_events', 'SELECT') as can_select,
        has_table_privilege('orgspace_app', 'audit_events', 'UPDATE') as can_update,
        has_table_privilege('orgspace_app', 'audit_events', 'DELETE') as can_delete
    `;

    expect(privileges).toEqual({
      can_insert: true,
      can_select: true,
      can_update: false,
      can_delete: false,
    });
  });
});
