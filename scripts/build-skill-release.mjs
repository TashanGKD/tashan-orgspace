import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillFiles = [
  "SKILL.md",
  "agents/openai.yaml",
  "capability-references.json",
  "references/authentication.md",
  "references/safety.md",
  "release.json",
  "scripts/install-cli.sh",
];

function fail(message) {
  throw new Error(message);
}

function outputDirectory(arguments_) {
  if (arguments_.length !== 2 || arguments_[0] !== "--output-dir") {
    fail("usage: node scripts/build-skill-release.mjs --output-dir <empty-directory>");
  }
  return resolve(arguments_[1]);
}

function requireEmptyDirectory(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
    return;
  }
  if (readdirSync(path).length !== 0) fail("Skill release output directory must be empty");
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function main() {
  const output = outputDirectory(process.argv.slice(2));
  requireEmptyDirectory(output);
  const release = JSON.parse(
    readFileSync(resolve(repositoryRoot, "release/cli-release.json"), "utf8"),
  );
  const expectedAsset = `tashan-orgspace-skill-v${release.version}.tar.gz`;
  if (release.skillAsset !== expectedAsset) fail("release Skill asset does not match version");

  const temporaryRoot = mkdtempSync(join(tmpdir(), "orgspace-skill-build-"));
  const packageRoot = join(temporaryRoot, "tashan-orgspace");
  try {
    for (const relative of skillFiles) {
      const source = resolve(repositoryRoot, "skill/tashan-orgspace", relative);
      if (!lstatSync(source).isFile()) fail(`Skill source must be a regular file: ${relative}`);
      const destination = join(packageRoot, relative);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
    chmodSync(join(packageRoot, "scripts/install-cli.sh"), 0o755);
    const archive = join(output, release.skillAsset);
    execFileSync("tar", ["-czf", archive, "-C", temporaryRoot, "tashan-orgspace"]);
    writeFileSync(`${archive}.sha256`, `${sha256(archive)}  ${release.skillAsset}\n`, {
      mode: 0o644,
    });
    console.log(archive);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
