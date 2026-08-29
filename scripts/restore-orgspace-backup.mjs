import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { URL } from "node:url";
import postgres from "postgres";
import {
  assertEmptyDirectory,
  objectHashes,
  readBackupManifest,
  safeAbsoluteDirectory,
  verifyRequiredKeys,
} from "./recovery-lib.mjs";

const args = process.argv.slice(2),
  usage =
    "usage: restore-orgspace-backup --backup-dir <absolute-dir> --database-url <loopback-*_test-url> --object-target <absolute-empty-dir> --environment-file <absolute-file> [--pg-restore-container <container>] [--apply --confirm-restore]";
function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}
if (args.length === 0) {
  console.log(usage);
  process.exit(0);
}
const backupRaw = option("--backup-dir"),
  databaseUrl = option("--database-url"),
  targetRaw = option("--object-target"),
  environmentFile = option("--environment-file");
const pgRestoreContainer = option("--pg-restore-container");
if (pgRestoreContainer && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(pgRestoreContainer))
  throw new Error("pg_restore container name is invalid");
if (!backupRaw || !databaseUrl || !targetRaw || !environmentFile) throw new Error(usage);
const backupDirectory = safeAbsoluteDirectory(backupRaw, "backup directory"),
  objectTarget = safeAbsoluteDirectory(targetRaw, "object target");
const url = new URL(databaseUrl),
  databaseName = decodeURIComponent(url.pathname.slice(1));
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase()) ||
  !/^[a-z][a-z0-9_]*_test$/.test(databaseName)
)
  throw new Error("restore database must be a loopback *_test database");
assertEmptyDirectory(objectTarget, "object target");
const manifest = readBackupManifest(backupDirectory);
verifyRequiredKeys(manifest, environmentFile);
const entries = execFileSync("tar", ["-tf", join(backupDirectory, manifest.objects.file)], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean);
if (entries.some((entry) => entry.startsWith("/") || entry.split("/").includes("..")))
  throw new Error("object archive contains unsafe path");
const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const [tables] =
    await sql`select count(*)::int count from information_schema.tables where table_schema='public'`;
  if ((tables?.count ?? 0) !== 0) throw new Error("restore database must be empty");
  if (!args.includes("--apply")) {
    console.log("restore-orgspace-backup: PLAN valid");
    process.exitCode = 0;
  } else {
    if (!args.includes("--confirm-restore"))
      throw new Error("--confirm-restore is required with --apply");
    mkdirSync(objectTarget, { recursive: true });
    try {
      if (pgRestoreContainer) {
        execFileSync(
          "docker",
          [
            "exec",
            "-i",
            pgRestoreContainer,
            "pg_restore",
            "--no-owner",
            "--no-privileges",
            "--username",
            decodeURIComponent(url.username),
            "--dbname",
            databaseName,
          ],
          {
            input: readFileSync(join(backupDirectory, manifest.postgres.file)),
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
      } else {
        execFileSync(
          "pg_restore",
          [
            "--dbname",
            databaseUrl,
            "--no-owner",
            "--no-privileges",
            join(backupDirectory, manifest.postgres.file),
          ],
          { stdio: "pipe" },
        );
      }
      execFileSync(
        "tar",
        ["-xf", join(backupDirectory, manifest.objects.file), "-C", objectTarget],
        { stdio: "pipe" },
      );
      const restoredHashes = objectHashes(objectTarget);
      if (JSON.stringify(restoredHashes) !== JSON.stringify(manifest.objects.hashes))
        throw new Error("restored object hashes differ");
      for (const [table, expected] of Object.entries(manifest.postgres.counts)) {
        if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error("manifest table name is unsafe");
        const [row] = await sql.unsafe(`select count(*)::int count from "${table}"`);
        if (Number(row.count) !== expected)
          throw new Error(`restored logical count differs: ${table}`);
      }
      console.log("restore-orgspace-backup: PASS");
    } catch (error) {
      rmSync(objectTarget, { recursive: true, force: true });
      throw error;
    }
  }
} finally {
  await sql.end();
}
