import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkResourceSurfaceCoverage } from "./check-resource-surface-coverage.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path) => JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
const input = {
  server: readJson("packages/capabilities/src/phase0-capabilities.json"),
  cli: readJson("apps/cli/src/capability-bindings.json"),
  web: readJson("apps/web/src/capability-surfaces.json"),
  skill: readJson("skill/tashan-orgspace/capability-references.json").capabilities,
  resources: [
    {
      resourceType: "device",
      context: "global",
      listRoute: "/account",
      detailRoute: "/account/devices/:deviceId",
      listCapability: "device.list",
      readCapability: "device.list",
      actions: [{ capabilityId: "device.revoke", confirmation: "required" }],
    },
  ],
};

const clone = (value) => JSON.parse(JSON.stringify(value));

assert.deepEqual(checkResourceSurfaceCoverage(input), { resources: 1, violations: 0 });

const missingCli = clone(input);
delete missingCli.cli["device.list"];
assert.throws(() => checkResourceSurfaceCoverage(missingCli), /missing CLI binding: device.list/);

const missingSkill = clone(input);
missingSkill.skill = missingSkill.skill.filter((id) => id !== "device.revoke");
assert.throws(
  () => checkResourceSurfaceCoverage(missingSkill),
  /missing Skill capability: device.revoke/,
);

const weakerConfirmation = clone(input);
weakerConfirmation.resources[0].actions[0].confirmation = "none";
assert.throws(
  () => checkResourceSurfaceCoverage(weakerConfirmation),
  /action confirmation is weaker than server capability: device.revoke/,
);

const unknownCapability = clone(input);
unknownCapability.resources[0].readCapability = "device.read";
assert.throws(
  () => checkResourceSurfaceCoverage(unknownCapability),
  /unknown resource capability: device.read/,
);

const unrelatedWebRoute = clone(input);
unrelatedWebRoute.web.find((surface) => surface.capabilityId === "device.list").route =
  "/unrelated";
assert.throws(
  () => checkResourceSurfaceCoverage(unrelatedWebRoute),
  /Web route is outside resource list\/detail routes: device.list/,
);

console.log("check-resource-surface-coverage.self-test: PASS");
