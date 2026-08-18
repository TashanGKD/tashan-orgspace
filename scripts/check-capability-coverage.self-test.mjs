import { strict as assert } from "node:assert";

import { checkCoverage } from "./check-capability-coverage.mjs";

const server = [{ id: "device.revoke", web: "required" }];
const cli = { "device.revoke": "device revoke" };
const web = ["device.revoke"];
const skill = ["device.revoke"];

assert.throws(() => checkCoverage(server, {}, web, skill), /missing CLI binding: device.revoke/);
assert.throws(
  () => checkCoverage(server, { ...cli, "device.list": "device list" }, web, skill),
  /unknown CLI binding: device.list/,
);
assert.throws(() => checkCoverage(server, cli, [], skill), /missing Web surface: device.revoke/);
assert.throws(
  () => checkCoverage(server, cli, [...web, "device.list"], skill),
  /unknown Web surface: device.list/,
);
assert.throws(() => checkCoverage(server, cli, web, []), /missing Skill capability: device.revoke/);
assert.throws(
  () => checkCoverage(server, cli, web, ["device.revoked"]),
  /unknown Skill capability: device.revoked/,
);
assert.throws(
  () => checkCoverage([...server, ...server], cli, web, skill),
  /duplicate server capability: device.revoke/,
);
assert.throws(
  () => checkCoverage(server, cli, [...web, ...web], skill),
  /duplicate Web surface: device.revoke/,
);
assert.doesNotThrow(() => checkCoverage(server, cli, web, skill));

console.log("check-capability-coverage.self-test: PASS");
