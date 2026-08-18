import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseOutputDirectory(arguments_) {
  if (arguments_.length !== 2 || arguments_[0] !== "--output-dir") {
    throw new Error("usage: node scripts/build-cli-release.mjs --output-dir <empty-directory>");
  }
  return resolve(arguments_[1]);
}

function requireEmptyDirectory(outputDirectory) {
  if (existsSync(outputDirectory)) {
    if (readdirSync(outputDirectory).length > 0) {
      throw new Error("release output directory must be empty");
    }
    return;
  }
  mkdirSync(outputDirectory, { recursive: true });
}

function nodeLicensePath() {
  const path = resolve(dirname(process.execPath), "../LICENSE");
  if (!existsSync(path)) throw new Error(`Node license not found beside runtime: ${path}`);
  return path;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function launcher(apiUrl) {
  return `#!/bin/sh
set -eu
self_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
release_root="$(CDPATH='' cd -- "$self_dir/.." && pwd)"
export TORG_ENV=production
TORG_API_URL="\${TORG_API_URL:-${apiUrl}}"
export TORG_API_URL
exec "$release_root/runtime/node" "$release_root/lib/torg.mjs" "$@"
`;
}

async function main() {
  const outputDirectory = parseOutputDirectory(process.argv.slice(2));
  requireEmptyDirectory(outputDirectory);

  const release = readJson(resolve(repositoryRoot, "release/cli-release.json"));
  const platformId = `${process.platform}-${process.arch}`;
  const platform = release.platforms.find(({ id }) => id === platformId);
  if (platform === undefined) throw new Error(`unsupported release build platform: ${platformId}`);
  if (process.version !== `v${release.nodeVersion}`) {
    throw new Error(
      `release builder requires Node ${release.nodeVersion}; current runtime is ${process.version}`,
    );
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), "torg-release-build-"));
  const topLevel = platform.asset.replace(/\.tar\.gz$/, "");
  const releaseRoot = join(temporaryRoot, topLevel);
  try {
    for (const directory of ["bin", "lib", "runtime", "THIRD_PARTY_NOTICES"]) {
      mkdirSync(join(releaseRoot, directory), { recursive: true });
    }
    await build({
      entryPoints: [resolve(repositoryRoot, "apps/cli/src/main.ts")],
      outfile: join(releaseRoot, "lib/torg.mjs"),
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node24",
      sourcemap: false,
      legalComments: "none",
      logLevel: "silent",
    });
    copyFileSync(process.execPath, join(releaseRoot, "runtime/node"));
    copyFileSync(nodeLicensePath(), join(releaseRoot, "THIRD_PARTY_NOTICES/Node-LICENSE"));
    writeFileSync(join(releaseRoot, "VERSION"), `${release.version}\n`, { mode: 0o644 });
    writeFileSync(join(releaseRoot, "bin/torg"), launcher(release.apiUrl), { mode: 0o755 });
    chmodSync(join(releaseRoot, "runtime/node"), 0o755);

    const archivePath = join(outputDirectory, platform.asset);
    execFileSync("tar", ["-czf", archivePath, "-C", temporaryRoot, topLevel]);
    writeFileSync(`${archivePath}.sha256`, `${sha256(archivePath)}  ${platform.asset}\n`, {
      mode: 0o644,
    });
    console.log(archivePath);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
