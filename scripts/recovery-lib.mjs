import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, parse, relative, resolve } from "node:path";

export function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
export function safeAbsoluteDirectory(raw, label) {
  if (!isAbsolute(raw)) throw new Error(`${label} must be absolute`);
  const value = resolve(raw);
  if (value === parse(value).root || value === homedir()) throw new Error(`${label} is too broad`);
  return value;
}
export function assertEmptyDirectory(path, label) {
  try {
    if (!lstatSync(path).isDirectory()) throw new Error(`${label} must be a directory`);
    if (readdirSync(path).length) throw new Error(`${label} must be empty`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
export function objectHashes(root) {
  const output = {};
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name),
        stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error("object source must not contain symlinks");
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile()) output[relative(root, path)] = sha256(path);
      else throw new Error("object source contains unsupported entry");
    }
  }
  visit(root);
  return output;
}
export function partnerKeyVersions(environmentFile) {
  const lines = readFileSync(environmentFile, "utf8").split(/\r?\n/);
  const line = lines.find((value) => value.startsWith("PARTNER_FIELD_KEYS="));
  if (!line) throw new Error("PARTNER_FIELD_KEYS is missing from environment file");
  let parsed;
  try {
    parsed = JSON.parse(line.slice("PARTNER_FIELD_KEYS=".length));
  } catch {
    throw new Error("PARTNER_FIELD_KEYS is invalid JSON");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
    throw new Error("PARTNER_FIELD_KEYS must be an object");
  return Object.keys(parsed).sort((a, b) => Number(a) - Number(b));
}
export function readBackupManifest(backupDirectory) {
  const manifest = JSON.parse(readFileSync(join(backupDirectory, "manifest.json"), "utf8"));
  if (manifest.version !== 1 || typeof manifest.checkpoint !== "string")
    throw new Error("backup manifest is invalid");
  if (
    manifest.postgres?.checkpoint !== manifest.checkpoint ||
    manifest.objects?.checkpoint !== manifest.checkpoint
  )
    throw new Error("backup checkpoint mismatch");
  for (const artifact of [manifest.postgres, manifest.objects]) {
    const path = join(backupDirectory, artifact.file);
    if (sha256(path) !== artifact.sha256)
      throw new Error(`backup artifact checksum mismatch: ${artifact.file}`);
  }
  return manifest;
}
export function verifyRequiredKeys(manifest, environmentFile) {
  const available = new Set(partnerKeyVersions(environmentFile));
  for (const version of manifest.secrets.requiredPartnerKeyVersions)
    if (!available.has(String(version)))
      throw new Error(`required Partner key version is missing: ${version}`);
}
