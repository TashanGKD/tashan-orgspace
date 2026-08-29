import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { URL } from "node:url";
import postgres from "postgres";
import {
  assertEmptyDirectory,
  objectHashes,
  partnerKeyVersions,
  safeAbsoluteDirectory,
  sha256,
} from "./recovery-lib.mjs";

const args = process.argv.slice(2),
  usage =
    "usage: backup-orgspace --database-url <postgres-url> --object-dir <absolute-dir> --environment-file <absolute-file> --output-dir <absolute-empty-dir> [--pg-dump-container <container>] --apply";
function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}
if (args.length === 0) {
  console.log(usage);
  process.exit(0);
}
const databaseUrl = option("--database-url"),
  objectDirectoryRaw = option("--object-dir"),
  environmentFile = option("--environment-file"),
  outputRaw = option("--output-dir");
const pgDumpContainer = option("--pg-dump-container");
if (pgDumpContainer && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(pgDumpContainer))
  throw new Error("pg_dump container name is invalid");
if (!databaseUrl || !objectDirectoryRaw || !environmentFile || !outputRaw) throw new Error(usage);
const objectDirectory = safeAbsoluteDirectory(objectDirectoryRaw, "object directory"),
  outputDirectory = safeAbsoluteDirectory(outputRaw, "output directory");
assertEmptyDirectory(outputDirectory, "output directory");
if (!args.includes("--apply")) {
  console.log(`backup-orgspace: PLAN ${outputDirectory}`);
  process.exit(0);
}
const staging = `${outputDirectory}.staging-${process.pid}`;
assertEmptyDirectory(staging, "backup staging directory");
mkdirSync(staging, { recursive: true });
const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const checkpoint = randomUUID(),
    dump = join(staging, "postgres.dump"),
    objects = join(staging, "objects.tar");
  if (pgDumpContainer) {
    const parsedUrl = new URL(databaseUrl);
    const bytes = execFileSync(
      "docker",
      [
        "exec",
        pgDumpContainer,
        "pg_dump",
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--username",
        decodeURIComponent(parsedUrl.username),
        "--dbname",
        decodeURIComponent(parsedUrl.pathname.slice(1)),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    writeFileSync(dump, bytes);
  } else {
    execFileSync(
      "pg_dump",
      ["--format=custom", "--no-owner", "--no-privileges", "--file", dump, databaseUrl],
      { stdio: "pipe" },
    );
  }
  execFileSync("tar", ["-cf", objects, "-C", objectDirectory, "."], { stdio: "pipe" });
  const tables =
    await sql`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name`;
  const counts = {};
  for (const { table_name: table } of tables) {
    if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error("database table name is unsafe");
    const [row] = await sql.unsafe(`select count(*)::int count from "${table}"`);
    counts[table] = Number(row.count);
  }
  const manifest = {
    version: 1,
    checkpoint,
    createdAt: new Date().toISOString(),
    postgres: { file: "postgres.dump", sha256: sha256(dump), checkpoint, counts },
    objects: {
      file: "objects.tar",
      sha256: sha256(objects),
      checkpoint,
      hashes: objectHashes(objectDirectory),
    },
    secrets: { requiredPartnerKeyVersions: partnerKeyVersions(environmentFile) },
  };
  writeFileSync(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  mkdirSync(dirname(outputDirectory), { recursive: true });
  try {
    rmdirSync(outputDirectory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  renameSync(staging, outputDirectory);
  console.log(`backup-orgspace: PASS ${outputDirectory}`);
} catch (error) {
  rmSync(staging, { recursive: true, force: true });
  throw error;
} finally {
  await sql.end();
}
