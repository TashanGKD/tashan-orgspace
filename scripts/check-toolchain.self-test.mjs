import { strict as assert } from "node:assert";

import { checkVersions } from "./check-toolchain.mjs";

assert.throws(() => checkVersions({ node: "22.0.0", pnpm: "10.32.1" }), /Node 24 is required/);
assert.throws(() => checkVersions({ node: "24.14.0", pnpm: "9.15.9" }), /pnpm 10 is required/);
assert.throws(
  () => checkVersions({ node: "not-a-version", pnpm: "10.32.1" }),
  /valid Node version/,
);
assert.doesNotThrow(() => checkVersions({ node: "24.14.0", pnpm: "10.32.1" }));

console.log("check-toolchain.self-test: PASS");
