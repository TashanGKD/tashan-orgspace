import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabaseClient } from "./client.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../migrations");

function parseTestDatabaseUrl(databaseUrl: string): { databaseName: string; url: URL } {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("test database URL must use PostgreSQL");
  }
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("test database reset requires a loopback host");
  }

  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-z][a-z0-9_]*_test$/.test(databaseName)) {
    throw new Error("test database name must end in _test and contain only safe characters");
  }
  return { databaseName, url };
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function resetTestDatabase(databaseUrl: string): Promise<void> {
  const { databaseName, url } = parseTestDatabaseUrl(databaseUrl);
  url.pathname = "/postgres";
  const admin = createDatabaseClient(url.toString());

  try {
    await admin.unsafe(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`);
    await admin.unsafe(`create database ${quoteIdentifier(databaseName)}`);
  } finally {
    await admin.end();
  }
}

export async function migrateDatabase(databaseUrl: string): Promise<void> {
  const sql = createDatabaseClient(databaseUrl);

  try {
    await sql`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `;

    const migrationFiles = readdirSync(migrationsDirectory)
      .filter((filename) => /^\d+_[a-z0-9_]+\.sql$/.test(filename))
      .sort();
    if (migrationFiles.length === 0) {
      throw new Error("no database migrations found");
    }

    for (const filename of migrationFiles) {
      const [existing] = await sql<{ exists: boolean }[]>`
        select exists(select 1 from schema_migrations where filename = ${filename}) as exists
      `;
      if (existing?.exists === true) continue;

      const migrationSql = readFileSync(resolve(migrationsDirectory, filename), "utf8");
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migrationSql);
        await transaction`insert into schema_migrations (filename) values (${filename})`;
      });
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const reset = process.argv.includes("--reset-test");
  const databaseUrl = reset ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    throw new Error(`${reset ? "TEST_DATABASE_URL" : "DATABASE_URL"} is required`);
  }
  if (reset) await resetTestDatabase(databaseUrl);
  await migrateDatabase(databaseUrl);
  console.log(reset ? "test database reset and migrated" : "database migrated");
}
