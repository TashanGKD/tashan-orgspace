import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
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

describe("CLI release builder", () => {
  test("packages a relocatable CLI with its own Node 24 runtime", () => {
    const outputDirectory = temporaryDirectory("torg-release-output-");
    execFileSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/build-cli-release.mjs"), "--output-dir", outputDirectory],
      { cwd: repositoryRoot, stdio: "pipe" },
    );

    const platform = `${process.platform}-${process.arch}`;
    const archiveName = `torg-v0.1.0-alpha.1-${platform}.tar.gz`;
    const archivePath = join(outputDirectory, archiveName);
    const topLevel = archiveName.replace(/\.tar\.gz$/, "");
    const entries = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" })
      .trim()
      .split("\n")
      .sort();
    expect(entries).toEqual(
      [
        `${topLevel}/`,
        `${topLevel}/THIRD_PARTY_NOTICES/`,
        `${topLevel}/THIRD_PARTY_NOTICES/Node-LICENSE`,
        `${topLevel}/VERSION`,
        `${topLevel}/bin/`,
        `${topLevel}/bin/torg`,
        `${topLevel}/lib/`,
        `${topLevel}/lib/torg.mjs`,
        `${topLevel}/runtime/`,
        `${topLevel}/runtime/node`,
      ].sort(),
    );
    expect(readFileSync(`${archivePath}.sha256`, "utf8")).toMatch(
      new RegExp(`^[a-f0-9]{64}  ${archiveName}\\n$`),
    );

    const extractDirectory = temporaryDirectory("torg-release-extract-");
    execFileSync("tar", ["-xzf", archivePath, "-C", extractDirectory]);
    const launcher = join(extractDirectory, topLevel, "bin/torg");
    const environment = {
      HOME: temporaryDirectory("torg-release-home-"),
      PATH: "/usr/bin:/bin",
    };
    const version = spawnSync(launcher, ["--version"], { encoding: "utf8", env: environment });
    expect(version).toMatchObject({ status: 0, stdout: "0.1.0-alpha.1\n", stderr: "" });
    const noArguments = spawnSync(launcher, [], { encoding: "utf8", env: environment });
    expect(noArguments.status).toBe(0);
    expect(noArguments.stdout).toContain("Usage: torg");
    expect(noArguments.stderr).toBe("");
  }, 30_000);

  test("refuses a non-empty output directory", () => {
    const outputDirectory = temporaryDirectory("torg-release-dirty-");
    mkdirSync(join(outputDirectory, "unrelated"));
    writeFileSync(join(outputDirectory, "unrelated/file.txt"), "keep me\n");
    const result = spawnSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/build-cli-release.mjs"), "--output-dir", outputDirectory],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("release output directory must be empty");
    expect(readFileSync(join(outputDirectory, "unrelated/file.txt"), "utf8")).toBe("keep me\n");
  });
});
