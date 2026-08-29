import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertEmptyDirectory,
  readBackupManifest,
  sha256,
  verifyRequiredKeys,
} from "./recovery-lib.mjs";

const root = mkdtempSync(join(tmpdir(), "orgspace-restore-self-test-"));
try {
  const backup = join(root, "backup"),
    environment = join(root, "production.env");
  mkdirSync(backup);
  writeFileSync(join(backup, "postgres.dump"), "database");
  writeFileSync(join(backup, "objects.tar"), "objects");
  writeFileSync(environment, 'PARTNER_FIELD_KEYS={"1":"fixture","2":"fixture"}\n');
  const checkpoint = "00000000-0000-4000-8000-000000000001";
  const manifest = {
    version: 1,
    checkpoint,
    postgres: {
      file: "postgres.dump",
      sha256: sha256(join(backup, "postgres.dump")),
      checkpoint,
      counts: {},
    },
    objects: {
      file: "objects.tar",
      sha256: sha256(join(backup, "objects.tar")),
      checkpoint,
      hashes: {},
    },
    secrets: { requiredPartnerKeyVersions: [1, 2] },
  };
  const save = () => writeFileSync(join(backup, "manifest.json"), JSON.stringify(manifest));
  save();
  verifyRequiredKeys(readBackupManifest(backup), environment);
  const expectFailure = (label, work, text) => {
    try {
      work();
    } catch (error) {
      if (error instanceof Error && error.message.includes(text)) return;
      throw error;
    }
    throw new Error(`${label} did not fail`);
  };
  manifest.objects.checkpoint = "00000000-0000-4000-8000-000000000002";
  save();
  expectFailure("checkpoint", () => readBackupManifest(backup), "checkpoint mismatch");
  manifest.objects.checkpoint = checkpoint;
  save();
  writeFileSync(environment, 'PARTNER_FIELD_KEYS={"1":"fixture"}\n');
  expectFailure(
    "missing key",
    () => verifyRequiredKeys(readBackupManifest(backup), environment),
    "key version is missing",
  );
  writeFileSync(join(backup, "objects.tar"), "corrupt");
  expectFailure("checksum", () => readBackupManifest(backup), "checksum mismatch");
  const nonempty = join(root, "nonempty");
  mkdirSync(nonempty);
  writeFileSync(join(nonempty, "keep"), "x");
  expectFailure("nonempty", () => assertEmptyDirectory(nonempty, "target"), "must be empty");
  for (const script of ["backup-orgspace.mjs", "restore-orgspace-backup.mjs"]) {
    const result = spawnSync(process.execPath, [join(import.meta.dirname, script)], {
      encoding: "utf8",
    });
    if (result.status !== 0 || !result.stdout.includes("usage:"))
      throw new Error(`${script} no-argument default is unsafe`);
  }
  console.log("restore-orgspace-backup.self-test: PASS");
} finally {
  rmSync(root, { recursive: true, force: true });
}
