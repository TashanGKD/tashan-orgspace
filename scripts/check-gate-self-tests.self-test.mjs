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

  const productionSafetyGates = [
    ["check-production-contract.mjs", "check-production-contract.self-test.mjs"],
    ["deploy-orgspace.sh", "deploy-orgspace.self-test.sh"],
    ["publish-public-distribution.sh", "publish-public-distribution.self-test.sh"],
    ["smoke-public-distribution.sh", "smoke-public-distribution.self-test.sh"],
    ["configure-orgspace-ingress.sh", "configure-orgspace-ingress.self-test.sh"],
    ["smoke-production.sh", "smoke-production.self-test.sh"],
  ];
  for (const [gate, selfTest] of productionSafetyGates) {
    writeFileSync(join(fixtureRoot, gate), "exit 0\n");
    writeFileSync(join(fixtureRoot, selfTest), "exit 0\n");
  }
  assert.doesNotThrow(() => checkGateSelfTests(fixtureRoot));
  for (const [gate, selfTest] of productionSafetyGates) {
    rmSync(join(fixtureRoot, selfTest));
    assert.throws(
      () => checkGateSelfTests(fixtureRoot),
      new RegExp(`missing gate self-test: ${selfTest.replaceAll(".", "\\.")}`),
      gate,
    );
    writeFileSync(join(fixtureRoot, selfTest), "exit 0\n");
  }

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
