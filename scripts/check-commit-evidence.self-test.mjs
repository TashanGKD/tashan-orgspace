import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkCommitEvidence } from "./check-commit-evidence.mjs";

const fixtureRoot = mkdtempSync(join(tmpdir(), "orgspace-commit-evidence-"));
const outsideRoot = mkdtempSync(join(tmpdir(), "orgspace-outside-evidence-"));

try {
  writeFileSync(join(fixtureRoot, "evidence.txt"), "\nverified fact\nthird\n");
  writeFileSync(join(outsideRoot, "outside.txt"), "outside\n");
  symlinkSync(join(outsideRoot, "outside.txt"), join(fixtureRoot, "escape.txt"));

  for (const claim of ["all green", "0 violations", "fully covered"]) {
    assert.throws(() => checkCommitEvidence(`build(gates): ${claim}`, fixtureRoot), /file:line/);
  }

  assert.throws(
    () => checkCommitEvidence("build(gates): all green evidence.txt:99", fixtureRoot),
    /line is out of range/,
  );
  assert.throws(
    () => checkCommitEvidence("build(gates): all green evidence.txt:1", fixtureRoot),
    /cited line is blank or not evidence/,
  );
  assert.throws(
    () => checkCommitEvidence("build(gates): all green escape.txt:1", fixtureRoot),
    /escapes repository root/,
  );
  assert.doesNotThrow(() =>
    checkCommitEvidence("build(gates): all green evidence.txt:2", fixtureRoot),
  );
  assert.doesNotThrow(() => checkCommitEvidence("build(gates): enforce checks", fixtureRoot));
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(outsideRoot, { recursive: true, force: true });
}

console.log("check-commit-evidence.self-test: PASS");
