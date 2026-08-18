import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, describe, expect, test } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for migration integration tests");
}
const requiredTestDatabaseUrl: string = testDatabaseUrl;

const legacyMigrationFiles = [
  "001_phase0.sql",
  "002_app_roles.sql",
  "003_session_refresh_tokens.sql",
  "004_audit_chain_position.sql",
  "005_idempotency_actor_key.sql",
] as const;

let sql: DatabaseClient | undefined;

async function prepareLegacySchema(): Promise<DatabaseClient> {
  await sql?.end();
  await resetTestDatabase(requiredTestDatabaseUrl);
  sql = createDatabaseClient(requiredTestDatabaseUrl);
  await sql`
    create table schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  for (const filename of legacyMigrationFiles) {
    const migrationSql = readFileSync(
      resolve(import.meta.dirname, "../../migrations", filename),
      "utf8",
    );
    await sql.begin(async (transaction) => {
      await transaction.unsafe(migrationSql);
      await transaction`insert into schema_migrations (filename) values (${filename})`;
    });
  }
  return sql;
}

afterAll(async () => {
  await sql?.end();
});

describe("phone identity forward migration", () => {
  test("fails closed when a legacy account lacks a verified phone", async () => {
    const database = await prepareLegacySchema();
    await database`
      insert into accounts (username, password_hash)
      values ('legacy-account', 'argon2id-fixture')
    `;

    await expect(migrateDatabase(requiredTestDatabaseUrl)).rejects.toThrow(
      /legacy accounts require explicit phone mapping/,
    );

    const [migration] = await database<{ applied: boolean }[]>`
      select exists(
        select 1 from schema_migrations where filename = '006_phone_identity.sql'
      ) as applied
    `;
    expect(migration?.applied).toBe(false);
  });

  test("fails closed when legacy verification challenges still exist", async () => {
    const database = await prepareLegacySchema();
    const [account] = await database<{ id: string }[]>`
      insert into accounts (username, password_hash, phone_e164, phone_verified_at)
      values ('verified-account', 'argon2id-fixture', '+8613800138000', now())
      returning id
    `;
    if (account === undefined) throw new Error("failed to create verified account fixture");
    await database`
      insert into phone_verifications (account_id, phone_e164, code_hash, expires_at)
      values (${account.id}, '+8613800138000', 'hmac-fixture', now() + interval '10 minutes')
    `;

    await expect(migrateDatabase(requiredTestDatabaseUrl)).rejects.toThrow(
      /legacy phone verification challenges must expire before migration/,
    );
  });
});
