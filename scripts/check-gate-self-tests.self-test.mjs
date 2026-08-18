import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkGateSelfTests } from "./check-gate-self-tests.mjs";

const fixtureRoot = mkdtempSync(join(tmpdir(), "orgspace-gate-inventory-"));

try {
  writeFileSync(join(fixtureRoot, "check-valid.mjs"), "export {};\n");
  writeFileSync(join(fixtureRoot, "check-valid.self-test.mjs"), "export {};\n");
  writeFileSync(join(fixtureRoot, "verify-valid.sh"), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(fixtureRoot, "verify-valid.self-test.sh"), "#!/bin/sh\nexit 0\n");
  assert.doesNotThrow(() => checkGateSelfTests(fixtureRoot));

  writeFileSync(join(fixtureRoot, "check-orphan.mjs"), "export {};\n");
  assert.throws(
    () => checkGateSelfTests(fixtureRoot),
    /missing gate self-test: check-orphan\.self-test\.mjs/,
  );
  rmSync(join(fixtureRoot, "check-orphan.mjs"));

  writeFileSync(join(fixtureRoot, "verify-orphan.sh"), "#!/bin/sh\nexit 0\n");
  assert.throws(
    () => checkGateSelfTests(fixtureRoot),
    /missing gate self-test: verify-orphan\.self-test\.sh/,
  );
  rmSync(join(fixtureRoot, "verify-orphan.sh"));

  mkdirSync(join(fixtureRoot, "nested"));
  writeFileSync(join(fixtureRoot, "nested", "check-shadow.mjs"), "export {};\n");
  assert.throws(
    () => checkGateSelfTests(fixtureRoot),
    /missing gate self-test: nested\/check-shadow\.self-test\.mjs/,
  );
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("check-gate-self-tests.self-test: PASS");
