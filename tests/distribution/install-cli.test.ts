import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const installer = resolve(repositoryRoot, "skill/tashan-orgspace/scripts/install-cli.sh");
const temporaryDirectories: string[] = [];

function temporaryDirectory(label: string) {
  const directory = mkdtempSync(join(tmpdir(), label));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

type FixtureOptions = {
  version?: string;
  platform?: string;
  badChecksum?: boolean;
  missingChecksum?: boolean;
  omitEntry?: string;
  extraTopLevel?: boolean;
  symlinkRuntime?: boolean;
  smokeFails?: boolean;
};

function createReleaseFixture(options: FixtureOptions = {}) {
  const version = options.version ?? "0.1.0-alpha.1";
  const platform = options.platform ?? "darwin-arm64";
  const root = temporaryDirectory("torg-installer-release-");
  const releaseDirectory = join(root, `v${version}`);
  const asset = `torg-v${version}-${platform}.tar.gz`;
  const topLevel = asset.replace(/\.tar\.gz$/, "");
  const staging = join(root, "staging");
  const packageRoot = join(staging, topLevel);
  for (const directory of ["bin", "lib", "runtime", "THIRD_PARTY_NOTICES"]) {
    mkdirSync(join(packageRoot, directory), { recursive: true });
  }
  const files: Record<string, string> = {
    VERSION: `${version}\n`,
    "bin/torg": options.smokeFails
      ? "#!/bin/sh\necho broken >&2\nexit 9\n"
      : `#!/bin/sh
case "\${1-}" in
  --version) printf '%s\\n' '${version}' ;;
  '') printf '%s\\n' 'Usage: torg [options]' ;;
  *) printf '%s\\n' 'fixture command' ;;
esac
`,
    "lib/torg.mjs": "export {};\n",
    "runtime/node": "#!/bin/sh\nexit 0\n",
    "THIRD_PARTY_NOTICES/Node-LICENSE": "fixture Node license\n",
  };
  for (const [relative, content] of Object.entries(files)) {
    if (relative === options.omitEntry) continue;
    const path = join(packageRoot, relative);
    if (relative === "runtime/node" && options.symlinkRuntime) {
      symlinkSync("/bin/sh", path);
    } else {
      writeFileSync(path, content);
      if (relative === "bin/torg" || relative === "runtime/node") chmodSync(path, 0o755);
    }
  }
  if (options.extraTopLevel) {
    mkdirSync(join(staging, "unexpected"));
    writeFileSync(join(staging, "unexpected/file"), "unexpected\n");
  }
  mkdirSync(releaseDirectory, { recursive: true });
  const archivePath = join(releaseDirectory, asset);
  const entries = options.extraTopLevel ? [topLevel, "unexpected"] : [topLevel];
  execFileSync("tar", ["-czf", archivePath, "-C", staging, ...entries]);
  const digest = options.badChecksum ? "0".repeat(64) : sha256(archivePath);
  const checksumName = options.missingChecksum ? `other-${asset}` : asset;
  writeFileSync(join(releaseDirectory, "SHA256SUMS"), `${digest}  ${checksumName}\n`);
  return { releaseDirectory, asset, version, platform };
}

function testEnvironment(fixture: ReturnType<typeof createReleaseFixture>, overrides = {}) {
  const home = temporaryDirectory("torg-installer-home-");
  const temp = join(home, "tmp");
  const bin = join(home, "bin");
  mkdirSync(temp);
  mkdirSync(bin);
  return {
    home,
    temp,
    bin,
    environment: {
      ...process.env,
      HOME: home,
      XDG_DATA_HOME: join(home, "data"),
      TMPDIR: temp,
      TORG_BIN_DIR: bin,
      TORG_INSTALL_TESTING: "1",
      TORG_INSTALL_PLATFORM: fixture.platform,
      TORG_RELEASE_BASE_URL: `file://${fixture.releaseDirectory}`,
      ...overrides,
    },
  };
}

function runInstaller(arguments_: string[], environment: NodeJS.ProcessEnv) {
  return spawnSync("bash", [installer, ...arguments_], {
    cwd: repositoryRoot,
    env: environment,
    encoding: "utf8",
  });
}

describe("Skill CLI installer", () => {
  test("installs into an isolated user directory and is idempotent", () => {
    const fixture = createReleaseFixture();
    const context = testEnvironment(fixture);
    const first = runInstaller(["--install"], context.environment);
    expect(first).toMatchObject({ status: 0, stderr: "" });
    const target = join(context.bin, "torg");
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(readlinkSync(target)).toBe(join(context.home, "data/torg/current/bin/torg"));
    expect(execFileSync(target, ["--version"], { encoding: "utf8" })).toBe("0.1.0-alpha.1\n");

    const second = runInstaller(["--install"], context.environment);
    expect(second).toMatchObject({ status: 0, stderr: "" });
    expect(second.stdout).toContain("already installed");
    expect(readdirSync(context.temp)).toEqual([]);
  });

  test("no arguments are read-only and version traversal is rejected before download", () => {
    const fixture = createReleaseFixture();
    const context = testEnvironment(fixture);
    const usage = runInstaller([], context.environment);
    expect(usage).toMatchObject({ status: 0, stderr: "" });
    expect(usage.stdout).toContain("Usage:");
    expect(existsSync(join(context.home, "data"))).toBe(false);

    const traversal = runInstaller(
      ["--install", "--version", "../../outside"],
      context.environment,
    );
    expect(traversal.status).not.toBe(0);
    expect(traversal.stderr).toContain("version must be semver");
    expect(existsSync(resolve(context.home, "outside"))).toBe(false);
    expect(readdirSync(context.temp)).toEqual([]);
  });

  test("rejects unsupported platforms before download", () => {
    const fixture = createReleaseFixture();
    const context = testEnvironment(fixture, { TORG_INSTALL_PLATFORM: "freebsd-x64" });
    const result = runInstaller(["--install"], context.environment);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unsupported platform: freebsd-x64");
    expect(readdirSync(context.temp)).toEqual([]);
  });

  test("production mode ignores test-only platform overrides", () => {
    const fixture = createReleaseFixture();
    const context = testEnvironment(fixture);
    const environment = { ...context.environment, TORG_INSTALL_PLATFORM: "freebsd-x64" };
    delete environment.TORG_INSTALL_TESTING;
    const result = runInstaller(["--check"], environment);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("torg is not installed by this installer");
    expect(result.stderr).not.toContain("freebsd-x64");
  });

  test.each([
    ["checksum mismatch", { badChecksum: true }, "checksum verification failed"],
    ["missing checksum entry", { missingChecksum: true }, "checksum entry not found"],
    ["missing required file", { omitEntry: "lib/torg.mjs" }, "invalid archive layout"],
    ["extra top-level directory", { extraTopLevel: true }, "invalid archive layout"],
    ["symlink entry", { symlinkRuntime: true }, "archive links are not allowed"],
    ["failed smoke", { smokeFails: true }, "installed CLI smoke test failed"],
  ] as const)("rejects %s without partial installation", (_label, options, message) => {
    const fixture = createReleaseFixture(options);
    const context = testEnvironment(fixture);
    const result = runInstaller(["--install"], context.environment);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(existsSync(join(context.bin, "torg"))).toBe(false);
    expect(readdirSync(context.temp)).toEqual([]);
  });

  test("refuses to overwrite an unmanaged command", () => {
    const fixture = createReleaseFixture();
    const context = testEnvironment(fixture);
    const target = join(context.bin, "torg");
    writeFileSync(target, "#!/bin/sh\necho user-owned\n", { mode: 0o755 });
    const result = runInstaller(["--install"], context.environment);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("refusing to replace unmanaged torg");
    expect(readFileSync(target, "utf8")).toContain("user-owned");
    expect(readdirSync(context.temp)).toEqual([]);
  });

  test("a failed upgrade keeps the previous version active", () => {
    const firstFixture = createReleaseFixture();
    const context = testEnvironment(firstFixture);
    expect(runInstaller(["--install"], context.environment).status).toBe(0);
    const target = join(context.bin, "torg");

    const badUpgrade = createReleaseFixture({ version: "0.1.0-alpha.2", badChecksum: true });
    const upgradeEnvironment = {
      ...context.environment,
      TORG_RELEASE_BASE_URL: `file://${badUpgrade.releaseDirectory}`,
    };
    const result = runInstaller(["--install", "--version", "0.1.0-alpha.2"], upgradeEnvironment);
    expect(result.status).not.toBe(0);
    expect(execFileSync(target, ["--version"], { encoding: "utf8" })).toBe("0.1.0-alpha.1\n");
    expect(readdirSync(context.temp)).toEqual([]);
  });

  test("a successful upgrade atomically changes the active version", () => {
    const firstFixture = createReleaseFixture();
    const context = testEnvironment(firstFixture);
    expect(runInstaller(["--install"], context.environment).status).toBe(0);
    const target = join(context.bin, "torg");

    const upgrade = createReleaseFixture({ version: "0.1.0-alpha.2" });
    const result = runInstaller(["--install", "--version", "0.1.0-alpha.2"], {
      ...context.environment,
      TORG_RELEASE_BASE_URL: `file://${upgrade.releaseDirectory}`,
    });
    expect(result).toMatchObject({ status: 0, stderr: "" });
    expect(execFileSync(target, ["--version"], { encoding: "utf8" })).toBe("0.1.0-alpha.2\n");
  });
});
