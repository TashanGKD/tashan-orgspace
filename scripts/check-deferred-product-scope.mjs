import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function requireString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function isDeferredCapability(scope, capabilityId) {
  return scope.forbiddenCapabilityPrefixes.some((prefix) => capabilityId.startsWith(prefix));
}

export function checkDeferredProductScope({
  appSource,
  cliBindings,
  documents,
  modules,
  scope,
  serverCapabilities,
  skillCapabilities,
}) {
  if (scope === null || typeof scope !== "object")
    throw new Error("deferred scope must be an object");
  if (scope.status !== "deferred_visible") throw new Error("invalid deferred scope status");

  const moduleIds = requireArray(scope.moduleIds, "deferred scope module IDs");
  if (moduleIds.length !== 4)
    throw new Error("deferred scope must contain exactly four module IDs");
  if (moduleIds.some((moduleId) => typeof moduleId !== "string" || moduleId.length === 0)) {
    throw new Error("deferred scope module IDs must be non-empty strings");
  }
  if (new Set(moduleIds).size !== moduleIds.length) throw new Error("duplicate deferred module ID");

  requireString(scope.requiredModuleStatus, "required module status");
  requireArray(scope.forbiddenCapabilityPrefixes, "forbidden capability prefixes").forEach(
    (prefix) => requireString(prefix, "forbidden capability prefix"),
  );
  requireString(scope.requiredDocumentMarker, "required document marker");

  const byId = new Map(
    requireArray(modules, "product modules").map((module) => [module?.id, module]),
  );
  for (const moduleId of moduleIds) {
    const module = byId.get(moduleId);
    if (module === undefined) throw new Error(`missing deferred module: ${moduleId}`);
    if (module.status !== scope.requiredModuleStatus) {
      throw new Error(`deferred module must remain coming_soon: ${moduleId}`);
    }
    if (!Array.isArray(module.capabilities) || module.capabilities.length !== 0) {
      throw new Error(`deferred module cannot bind capabilities: ${moduleId}`);
    }
  }

  for (const capability of requireArray(serverCapabilities, "server capabilities")) {
    const id = requireString(capability?.id, "server capability ID");
    if (isDeferredCapability(scope, id)) {
      throw new Error(`deferred capability entered server registry: ${id}`);
    }
  }
  if (cliBindings === null || typeof cliBindings !== "object" || Array.isArray(cliBindings)) {
    throw new Error("CLI bindings must be an object");
  }
  for (const id of Object.keys(cliBindings)) {
    if (isDeferredCapability(scope, id)) {
      throw new Error(`deferred capability entered CLI bindings: ${id}`);
    }
  }
  for (const id of requireArray(skillCapabilities, "Skill capabilities")) {
    const capabilityId = requireString(id, "Skill capability ID");
    if (isDeferredCapability(scope, capabilityId)) {
      throw new Error(`deferred capability entered Skill references: ${capabilityId}`);
    }
  }
  if (
    typeof appSource !== "string" ||
    !appSource.includes("comingSoon.map") ||
    !appSource.includes("ComingSoonPage")
  ) {
    throw new Error("coming-soon routes are not bound to ComingSoonPage");
  }
  if (documents === null || typeof documents !== "object" || Array.isArray(documents)) {
    throw new Error("documents must be an object");
  }
  for (const [path, content] of Object.entries(documents)) {
    if (typeof content !== "string" || !content.includes(scope.requiredDocumentMarker)) {
      throw new Error(`missing deferred scope marker: ${path}`);
    }
  }
  return {
    deferredModules: moduleIds.length,
    documents: Object.keys(documents).length,
    violations: 0,
  };
}

export function checkRepositoryDeferredProductScope(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const scope = readJson(resolve(root, "apps/web/src/deferred-product-scope.json"));
  return checkDeferredProductScope({
    scope,
    modules: readJson(resolve(root, "apps/web/src/product-modules.json")),
    serverCapabilities: readJson(
      resolve(root, "packages/capabilities/src/phase0-capabilities.json"),
    ),
    cliBindings: readJson(resolve(root, "apps/cli/src/capability-bindings.json")),
    skillCapabilities: readJson(resolve(root, "skill/tashan-orgspace/capability-references.json"))
      .capabilities,
    appSource: readFileSync(resolve(root, "apps/web/src/app.tsx"), "utf8"),
    documents: Object.fromEntries(
      [
        "README.md",
        "docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md",
        "docs/superpowers/specs/2026-08-26-full-product-frontend-blueprint.md",
        "docs/superpowers/plans/2026-08-26-full-product-delivery.md",
      ].map((path) => [path, readFileSync(resolve(root, path), "utf8")]),
    ),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = checkRepositoryDeferredProductScope(root);
  console.log(
    `check-deferred-product-scope: PASS (${result.violations} violations, ${result.deferredModules} deferred modules, ${result.documents} documents)`,
  );
}
