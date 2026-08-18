import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const RELEASE_FIELDS = [
  "apiUrl",
  "nodeVersion",
  "platforms",
  "repository",
  "schemaVersion",
  "version",
];
const SUPPORTED_PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-x64"];
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;
const NODE_VERSION = /^24\.\d+\.\d+$/;

function requirePlainObject(label, value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function validateRelease(release) {
  requirePlainObject("release", release);
  for (const field of Object.keys(release)) {
    if (!RELEASE_FIELDS.includes(field)) throw new Error(`unknown release field: ${field}`);
  }
  for (const field of RELEASE_FIELDS) {
    if (!(field in release)) throw new Error(`missing release field: ${field}`);
  }
  if (release.schemaVersion !== 1) throw new Error("release schemaVersion must be 1");
  if (typeof release.version !== "string" || !SEMVER.test(release.version)) {
    throw new Error("release version must be semver");
  }
  if (typeof release.nodeVersion !== "string" || !NODE_VERSION.test(release.nodeVersion)) {
    throw new Error("release nodeVersion must be a Node 24 version");
  }
  if (release.repository !== "TashanGKD/tashan-orgspace") {
    throw new Error("release repository must be TashanGKD/tashan-orgspace");
  }
  if (typeof release.apiUrl !== "string") {
    throw new Error("release apiUrl must be an HTTPS origin");
  }
  let apiUrl;
  try {
    apiUrl = new URL(release.apiUrl);
  } catch {
    throw new Error("release apiUrl must be an HTTPS origin");
  }
  if (
    apiUrl.protocol !== "https:" ||
    apiUrl.username !== "" ||
    apiUrl.password !== "" ||
    apiUrl.pathname !== "/" ||
    apiUrl.search !== "" ||
    apiUrl.hash !== "" ||
    apiUrl.origin !== release.apiUrl
  ) {
    throw new Error("release apiUrl must be an HTTPS origin");
  }
  if (!Array.isArray(release.platforms)) throw new Error("release platforms must be an array");

  const seen = new Set();
  for (const platform of release.platforms) {
    requirePlainObject("release platform", platform);
    const keys = Object.keys(platform).sort();
    if (keys.join(",") !== "asset,id") throw new Error("release platform fields must be asset,id");
    if (typeof platform.id !== "string" || !SUPPORTED_PLATFORMS.includes(platform.id)) {
      throw new Error(`unsupported release platform: ${String(platform.id)}`);
    }
    if (seen.has(platform.id)) throw new Error(`duplicate release platform: ${platform.id}`);
    seen.add(platform.id);
    const expectedAsset = `torg-v${release.version}-${platform.id}.tar.gz`;
    if (platform.asset !== expectedAsset) {
      throw new Error(`invalid release asset for ${platform.id}: expected ${expectedAsset}`);
    }
  }
  for (const platform of SUPPORTED_PLATFORMS) {
    if (!seen.has(platform)) throw new Error(`missing release platform: ${platform}`);
  }
}

export function checkReleaseContract(release, cliPackage, skillRelease) {
  validateRelease(release);
  requirePlainObject("CLI package", cliPackage);
  if (cliPackage.version !== release.version) {
    throw new Error(
      `CLI version mismatch: package=${String(cliPackage.version)} release=${release.version}`,
    );
  }
  validateRelease(skillRelease);
  if (skillRelease.version !== release.version) {
    throw new Error("Skill release metadata mismatch: version");
  }
  for (const field of RELEASE_FIELDS) {
    if (field === "version") continue;
    if (JSON.stringify(skillRelease[field]) !== JSON.stringify(release[field])) {
      throw new Error(`Skill release metadata mismatch: ${field}`);
    }
  }
  return { version: release.version, platforms: release.platforms.length, violations: 0 };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function checkRepositoryReleaseContract(repositoryRoot) {
  return checkReleaseContract(
    readJson(resolve(repositoryRoot, "release/cli-release.json")),
    readJson(resolve(repositoryRoot, "apps/cli/package.json")),
    readJson(resolve(repositoryRoot, "skill/tashan-orgspace/release.json")),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = checkRepositoryReleaseContract(repositoryRoot);
  console.log(
    `check-release-contract: PASS (${result.violations} violations, version ${result.version}, ${result.platforms} platforms)`,
  );
}
