import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const builder = resolve(repositoryRoot, "scripts/build-skill-release.mjs");
const installer = resolve(repositoryRoot, "distribution/install-skill.sh");
const version = (
  JSON.parse(readFileSync(resolve(repositoryRoot, "release/cli-release.json"), "utf8")) as {
    version: string;
  }
).version;
const asset = `tashan-orgspace-skill-v${version}.tar.gz`;
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

function releaseFixture() {
  const root = temporaryDirectory("orgspace-skill-release-");
  const build = join(root, "build");
  const release = join(root, `v${version}`);
  mkdirSync(build);
  mkdirSync(release);
  execFileSync(process.execPath, [builder, "--output-dir", build], { cwd: repositoryRoot });
  const archive = join(build, asset);
  execFileSync("cp", [archive, join(release, asset)]);
  writeFileSync(join(release, "SHA256SUMS"), `${sha256(archive)}  ${asset}\n`);
  return { root, release, archive: join(release, asset) };
}

function isolatedEnvironment(release: string) {
  const root = temporaryDirectory("orgspace-skill-home-");
  const home = join(root, "home");
  const codexHome = join(root, "codex");
  const temp = join(root, "tmp");
  mkdirSync(home);
  mkdirSync(codexHome);
  mkdirSync(temp);
  return {
    root,
    home,
    codexHome,
    temp,
    environment: {
      ...process.env,
      HOME: home,
      CODEX_HOME: codexHome,
      TMPDIR: temp,
      ORGSPACE_SKILL_INSTALL_TESTING: "1",
      ORGSPACE_SKILL_RELEASE_BASE_URL: `file://${release}`,
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

describe("OrgSpace Skill installer", () => {
  test("no arguments are read-only and relative CODEX_HOME is rejected", () => {
    const fixture = releaseFixture();
    const context = isolatedEnvironment(fixture.release);
    const usage = runInstaller([], context.environment);
    expect(usage).toMatchObject({ status: 0, stderr: "" });
    expect(usage.stdout).toContain("Usage:");
    expect(existsSync(join(context.codexHome, "skills"))).toBe(false);

    const relative = runInstaller(["--install"], {
      ...context.environment,
      CODEX_HOME: "relative-codex-home",
    });
    expect(relative.status).not.toBe(0);
    expect(relative.stderr).toContain("CODEX_HOME must be an absolute path");
  });

  test("installs atomically, checks, and is idempotent", () => {
    const fixture = releaseFixture();
    const context = isolatedEnvironment(fixture.release);
    const first = runInstaller(["--install"], context.environment);
    expect(first).toMatchObject({ status: 0, stderr: "" });
    const target = join(context.codexHome, "skills/tashan-orgspace");
    expect(readFileSync(join(target, "release.json"), "utf8")).toContain(version);
    expect(readFileSync(join(target, ".orgspace-installer-managed"), "utf8")).toBe(`${version}\n`);
    expect(runInstaller(["--check"], context.environment).status).toBe(0);
    expect(runInstaller(["--install"], context.environment).stdout).toContain("already installed");
    expect(existsSync(join(context.temp, "partial"))).toBe(false);
  });

  test("rejects checksum mismatch without creating a Skill", () => {
    const fixture = releaseFixture();
    writeFileSync(join(fixture.release, "SHA256SUMS"), `${"0".repeat(64)}  ${asset}\n`);
    const context = isolatedEnvironment(fixture.release);
    const result = runInstaller(["--install"], context.environment);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("checksum verification failed");
    expect(existsSync(join(context.codexHome, "skills/tashan-orgspace"))).toBe(false);
  });

  test("rejects a link-bearing archive even when its checksum matches", () => {
    const fixture = releaseFixture();
    const staging = join(fixture.root, "malicious");
    mkdirSync(join(staging, "tashan-orgspace/scripts"), { recursive: true });
    symlinkSync("/bin/sh", join(staging, "tashan-orgspace/scripts/install-cli.sh"));
    execFileSync("tar", [
      "-xzf",
      fixture.archive,
      "-C",
      staging,
      "--exclude",
      "*/scripts/install-cli.sh",
    ]);
    execFileSync("tar", ["-czf", fixture.archive, "-C", staging, "tashan-orgspace"]);
    writeFileSync(join(fixture.release, "SHA256SUMS"), `${sha256(fixture.archive)}  ${asset}\n`);
    const context = isolatedEnvironment(fixture.release);
    const result = runInstaller(["--install"], context.environment);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("archive links are not allowed");
    expect(existsSync(join(context.codexHome, "skills/tashan-orgspace"))).toBe(false);
  });

  test("refuses to overwrite a user-managed Skill", () => {
    const fixture = releaseFixture();
    const context = isolatedEnvironment(fixture.release);
    const target = join(context.codexHome, "skills/tashan-orgspace");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "SKILL.md"), "user-owned\n");
    const result = runInstaller(["--install"], context.environment);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("refusing to replace unmanaged Skill");
    expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe("user-owned\n");
  });

  test("reports the pinned GitHub fallback after official transport failure", () => {
    const fixture = releaseFixture();
    const context = isolatedEnvironment(fixture.release);
    const result = runInstaller(["--install"], {
      ...context.environment,
      ORGSPACE_SKILL_RELEASE_BASE_URL: "file:///definitely-missing-orgspace-skill-release",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("TashanGKD/tashan-orgspace");
    expect(result.stderr).toContain(`v${version}`);
  });
});
