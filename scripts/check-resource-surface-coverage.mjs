import { readFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const confirmationStrength = { none: 0, required: 1, "high-risk": 2 };

function requireRecord(label, value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireUnique(label, values) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function requireRoute(label, route) {
  if (
    typeof route !== "string" ||
    !route.startsWith("/") ||
    route.includes("\\") ||
    route.includes("//") ||
    route.includes("?") ||
    route.includes("#") ||
    route !== posix.normalize(route) ||
    (route !== "/" && route.endsWith("/"))
  ) {
    throw new Error(`invalid ${label}: ${String(route)}`);
  }
}

function routeParameters(route) {
  return [...route.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1]);
}

function validateResource(resource) {
  const value = requireRecord("resource surface", resource);
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "actions,context,detailRoute,listCapability,listRoute,readCapability,resourceType") {
    throw new Error("resource surface fields must be exact");
  }
  if (typeof value.resourceType !== "string" || !/^[a-z][a-z0-9-]*$/.test(value.resourceType)) {
    throw new Error("invalid resource type");
  }
  if (!["global", "personal", "organization"].includes(value.context)) {
    throw new Error(`invalid resource context: ${String(value.context)}`);
  }
  requireRoute("resource list route", value.listRoute);
  requireRoute("resource detail route", value.detailRoute);
  if (value.listRoute === value.detailRoute)
    throw new Error("detail route must differ from list route");
  if (typeof value.listCapability !== "string" || typeof value.readCapability !== "string") {
    throw new Error("resource capabilities must be strings");
  }
  if (!Array.isArray(value.actions)) throw new Error("resource actions must be an array");
  const listParameters = routeParameters(value.listRoute);
  const detailParameters = routeParameters(value.detailRoute);
  if (
    value.context === "organization" &&
    (!listParameters.includes("organizationId") || !detailParameters.includes("organizationId"))
  ) {
    throw new Error("organization surface routes must contain :organizationId");
  }
  if (
    value.context === "personal" &&
    (listParameters.includes("organizationId") || detailParameters.includes("organizationId"))
  ) {
    throw new Error("personal surface routes cannot contain :organizationId");
  }
  const hasObjectParameter =
    value.context === "organization"
      ? detailParameters.some((parameter) => parameter !== "organizationId")
      : detailParameters.length > 0;
  if (!hasObjectParameter) throw new Error("detail route must contain an object parameter");

  for (const action of value.actions) {
    const parsed = requireRecord("resource action", action);
    if (Object.keys(parsed).sort().join(",") !== "capabilityId,confirmation") {
      throw new Error("resource action fields must be exact");
    }
    if (
      typeof parsed.capabilityId !== "string" ||
      !Object.hasOwn(confirmationStrength, parsed.confirmation)
    ) {
      throw new Error("invalid resource action");
    }
  }
  requireUnique(
    `action capability for ${value.resourceType}`,
    value.actions.map(({ capabilityId }) => capabilityId),
  );
  return value;
}

export function checkResourceSurfaceCoverage({ server, cli, web, skill, resources, routeSource }) {
  if (!Array.isArray(server)) throw new Error("server capabilities must be an array");
  const cliRecord = requireRecord("CLI bindings", cli);
  if (!Array.isArray(web)) throw new Error("Web surfaces must be an array");
  if (!Array.isArray(skill)) throw new Error("Skill capabilities must be an array");
  if (!Array.isArray(resources)) throw new Error("resource surfaces must be an array");
  if (typeof routeSource !== "string") throw new Error("Web route source must be a string");

  const serverMap = new Map();
  for (const rawCapability of server) {
    const capability = requireRecord("server capability", rawCapability);
    if (
      typeof capability.id !== "string" ||
      !["none", "required"].includes(capability.confirmation) ||
      !["none", "session", "write", "revoke"].includes(capability.sideEffect)
    ) {
      throw new Error("invalid server capability");
    }
    if (serverMap.has(capability.id))
      throw new Error(`duplicate server capability: ${capability.id}`);
    serverMap.set(capability.id, capability);
  }
  const skillSet = new Set(skill);
  const webByCapability = new Map();
  for (const rawSurface of web) {
    const surface = requireRecord("Web surface", rawSurface);
    if (typeof surface.capabilityId !== "string" || typeof surface.route !== "string") {
      throw new Error("invalid Web surface");
    }
    webByCapability.set(surface.capabilityId, surface);
  }

  const parsedResources = resources.map(validateResource);
  requireUnique(
    "resource type",
    parsedResources.map(({ resourceType }) => resourceType),
  );
  requireUnique(
    "list route",
    parsedResources.map(({ listRoute }) => listRoute),
  );
  requireUnique(
    "detail route",
    parsedResources.map(({ detailRoute }) => detailRoute),
  );

  for (const resource of parsedResources) {
    const mountToken = `resourceSurface("${resource.resourceType}")`;
    if (!routeSource.includes(mountToken)) {
      throw new Error(`resource routes are not mounted from registry: ${resource.resourceType}`);
    }
    const capabilityIds = [
      resource.listCapability,
      resource.readCapability,
      ...resource.actions.map(({ capabilityId }) => capabilityId),
    ];
    for (const capabilityId of capabilityIds) {
      const capability = serverMap.get(capabilityId);
      if (capability === undefined) throw new Error(`unknown resource capability: ${capabilityId}`);
      if (!Object.hasOwn(cliRecord, capabilityId))
        throw new Error(`missing CLI binding: ${capabilityId}`);
      if (!skillSet.has(capabilityId)) throw new Error(`missing Skill capability: ${capabilityId}`);
      const webSurface = webByCapability.get(capabilityId);
      if (webSurface === undefined) throw new Error(`missing Web surface: ${capabilityId}`);
      if (![resource.listRoute, resource.detailRoute].includes(webSurface.route)) {
        throw new Error(`Web route is outside resource list/detail routes: ${capabilityId}`);
      }
    }

    for (const capabilityId of [resource.listCapability, resource.readCapability]) {
      if (serverMap.get(capabilityId).sideEffect !== "none") {
        throw new Error(`resource read capability must be side-effect free: ${capabilityId}`);
      }
    }
    for (const action of resource.actions) {
      const capability = serverMap.get(action.capabilityId);
      if (capability.sideEffect === "none") {
        throw new Error(`resource action must be mutating: ${action.capabilityId}`);
      }
      if (
        confirmationStrength[action.confirmation] < confirmationStrength[capability.confirmation]
      ) {
        throw new Error(
          `action confirmation is weaker than server capability: ${action.capabilityId}`,
        );
      }
    }
  }

  return { resources: parsedResources.length, violations: 0 };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function checkRepositoryResourceSurfaces(repositoryRoot) {
  const skillDocument = readJson(
    resolve(repositoryRoot, "skill/tashan-orgspace/capability-references.json"),
  );
  return checkResourceSurfaceCoverage({
    server: readJson(resolve(repositoryRoot, "packages/capabilities/src/phase0-capabilities.json")),
    cli: readJson(resolve(repositoryRoot, "apps/cli/src/capability-bindings.json")),
    web: readJson(resolve(repositoryRoot, "apps/web/src/capability-surfaces.json")),
    skill: skillDocument.capabilities,
    resources: readJson(resolve(repositoryRoot, "apps/web/src/resource-surfaces.json")),
    routeSource: readFileSync(resolve(repositoryRoot, "apps/web/src/app.tsx"), "utf8"),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = checkRepositoryResourceSurfaces(repositoryRoot);
  console.log(
    `check-resource-surface-coverage: PASS (${result.violations} violations, ${result.resources} resources)`,
  );
}
