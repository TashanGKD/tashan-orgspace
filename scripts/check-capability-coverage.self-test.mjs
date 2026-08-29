import { strict as assert } from "node:assert";

import { checkCoverage } from "./check-capability-coverage.mjs";

const server = [{ id: "device.revoke", web: "required", cli: "device revoke" }];
const cli = { "device.revoke": "device revoke" };
const surface = {
  capabilityId: "device.revoke",
  route: "/account",
  action: "device-revoke",
  test: "apps/web/src/app.test.tsx",
};
const web = [surface];
const skill = ["device.revoke"];
const files = new Set([surface.test]);

assert.throws(
  () => checkCoverage(server, {}, web, skill, files),
  /missing CLI binding: device.revoke/,
);
assert.throws(
  () => checkCoverage(server, { ...cli, "device.list": "device list" }, web, skill, files),
  /unknown CLI binding: device.list/,
);
assert.throws(
  () => checkCoverage(server, { "device.revoke": "device remove" }, web, skill, files),
  /CLI binding drift: device.revoke/,
);
assert.throws(
  () => checkCoverage(server, cli, [], skill, files),
  /missing Web surface: device.revoke/,
);
assert.throws(
  () =>
    checkCoverage(
      server,
      cli,
      [surface, { ...surface, capabilityId: "device.list", action: "device-list" }],
      skill,
      files,
    ),
  /unknown Web surface: device.list/,
);
assert.throws(
  () => checkCoverage(server, cli, web, [], files),
  /missing Skill capability: device.revoke/,
);
assert.throws(
  () => checkCoverage(server, cli, web, ["device.revoked"], files),
  /unknown Skill capability: device.revoked/,
);
assert.throws(
  () => checkCoverage([...server, ...server], cli, web, skill, files),
  /duplicate server capability: device.revoke/,
);
assert.throws(
  () => checkCoverage(server, cli, [...web, ...web], skill, files),
  /duplicate Web capability: device.revoke/,
);
assert.throws(
  () => checkCoverage(server, cli, [{ ...surface, route: "tasks" }], skill, files),
  /absolute Web route/,
);
assert.throws(
  () =>
    checkCoverage(
      server,
      cli,
      [{ ...surface, test: "apps/web/src/missing.test.tsx" }],
      skill,
      files,
    ),
  /missing Web test file/,
);
assert.throws(
  () =>
    checkCoverage(
      server,
      cli,
      [surface, { ...surface, capabilityId: "device.list" }],
      skill,
      files,
    ),
  /duplicate Web action/,
);
assert.doesNotThrow(() => checkCoverage(server, cli, web, skill, files));

console.log("check-capability-coverage.self-test: PASS");
