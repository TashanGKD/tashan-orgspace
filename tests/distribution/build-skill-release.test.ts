import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const builder = resolve(repositoryRoot, "scripts/build-skill-release.mjs");
const release = JSON.parse(
  readFileSync(resolve(repositoryRoot, "release/cli-release.json"), "utf8"),
) as { skillAsset: string };
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

describe("Skill release builder", () => {
  test("builds the exact versioned Skill archive and checksum", () => {
    const output = temporaryDirectory("orgspace-skill-build-");
    const result = spawnSync(process.execPath, [builder, "--output-dir", output], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    expect(result).toMatchObject({ status: 0, stderr: "" });
    const asset = release.skillAsset;
    const archive = join(output, asset);
    expect(existsSync(archive)).toBe(true);
    const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
      .trim()
      .split("\n")
      .sort();
    expect(entries).toEqual(
      [
        "tashan-orgspace/",
        "tashan-orgspace/SKILL.md",
        "tashan-orgspace/agents/",
        "tashan-orgspace/agents/openai.yaml",
        "tashan-orgspace/capability-references.json",
        "tashan-orgspace/references/",
        "tashan-orgspace/references/authentication.md",
        "tashan-orgspace/references/chat.md",
        "tashan-orgspace/references/files.md",
        "tashan-orgspace/references/my-work.md",
        "tashan-orgspace/references/notifications.md",
        "tashan-orgspace/references/okr.md",
        "tashan-orgspace/references/partners.md",
        "tashan-orgspace/references/safety.md",
        "tashan-orgspace/references/search.md",
        "tashan-orgspace/references/work.md",
        "tashan-orgspace/release.json",
        "tashan-orgspace/scripts/",
        "tashan-orgspace/scripts/install-cli.sh",
      ].sort(),
    );
    const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
    expect(readFileSync(`${archive}.sha256`, "utf8")).toBe(`${digest}  ${asset}\n`);
  });

  test("refuses a non-empty output directory", () => {
    const output = temporaryDirectory("orgspace-skill-build-nonempty-");
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "user-file"), "preserve\n");
    const result = spawnSync(process.execPath, [builder, "--output-dir", output], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Skill release output directory must be empty");
    expect(readFileSync(join(output, "user-file"), "utf8")).toBe("preserve\n");
  });
});
