import { strict as assert } from "node:assert";

import { checkDeferredProductScope } from "./check-deferred-product-scope.mjs";

const scope = {
  decisionId: "defer-compute-and-user-web-deployment-2026-08-28",
  status: "deferred_visible",
  moduleIds: [
    "personal.runtime",
    "personal.services",
    "organization.runtime",
    "organization.services",
  ],
  requiredModuleStatus: "coming_soon",
  forbiddenCapabilityPrefixes: [
    "runtime.",
    "run.",
    "build.",
    "service.",
    "database.",
    "domain.",
    "deployment.",
  ],
  requiredDocumentMarker: "<!-- DEFERRED_PRODUCT_SCOPE: general-compute,user-web-hosting -->",
};

const moduleFor = (id) => ({
  id,
  status: "coming_soon",
  capabilities: [],
  route: id.startsWith("organization.")
    ? `/org/:organizationId/${id.split(".")[1]}`
    : `/personal/${id.split(".")[1]}`,
});

const valid = {
  scope,
  modules: scope.moduleIds.map(moduleFor),
  serverCapabilities: [{ id: "organization.list" }],
  cliBindings: { "organization.list": ["organization", "list"] },
  skillCapabilities: ["organization.list"],
  appSource: "comingSoon.map((module) => <ComingSoonPage module={module} />)",
  documents: {
    "README.md": scope.requiredDocumentMarker,
    "design.md": scope.requiredDocumentMarker,
    "frontend.md": scope.requiredDocumentMarker,
    "delivery.md": scope.requiredDocumentMarker,
  },
};

const clone = (value) => JSON.parse(JSON.stringify(value));

assert.deepEqual(checkDeferredProductScope(valid), {
  deferredModules: 4,
  documents: 4,
  violations: 0,
});

const availableModule = clone(valid);
availableModule.modules[0].status = "available";
assert.throws(
  () => checkDeferredProductScope(availableModule),
  /deferred module must remain coming_soon: personal.runtime/,
);

const boundModule = clone(valid);
boundModule.modules[1].capabilities = ["service.create"];
assert.throws(
  () => checkDeferredProductScope(boundModule),
  /deferred module cannot bind capabilities: personal.services/,
);

const serverCapability = clone(valid);
serverCapability.serverCapabilities.push({ id: "runtime.submit" });
assert.throws(
  () => checkDeferredProductScope(serverCapability),
  /deferred capability entered server registry: runtime.submit/,
);

const cliCapability = clone(valid);
cliCapability.cliBindings["service.create"] = ["service", "create"];
assert.throws(
  () => checkDeferredProductScope(cliCapability),
  /deferred capability entered CLI bindings: service.create/,
);

const skillCapability = clone(valid);
skillCapability.skillCapabilities.push("database.create");
assert.throws(
  () => checkDeferredProductScope(skillCapability),
  /deferred capability entered Skill references: database.create/,
);

const missingMarker = clone(valid);
missingMarker.documents["README.md"] = "current product copy";
assert.throws(
  () => checkDeferredProductScope(missingMarker),
  /missing deferred scope marker: README.md/,
);

const wrongRoute = clone(valid);
wrongRoute.appSource = "const comingSoon = [];";
assert.throws(
  () => checkDeferredProductScope(wrongRoute),
  /coming-soon routes are not bound to ComingSoonPage/,
);

console.log("check-deferred-product-scope.self-test: PASS");
