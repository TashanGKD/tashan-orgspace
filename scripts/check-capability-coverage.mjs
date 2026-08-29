import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

function requireUnique(label, values) {
  const repeated = duplicates(values);
  if (repeated.length > 0) throw new Error(`duplicate ${label}: ${repeated.join(", ")}`);
}

function requireStringArray(label, values) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
    throw new Error(`${label} must be an array of capability IDs`);
  }
}

function validateWebSurface(surface, files) {
  if (
    typeof surface !== "object" ||
    surface === null ||
    Array.isArray(surface) ||
    Object.keys(surface).sort().join(",") !== "action,capabilityId,route,test" ||
    typeof surface.capabilityId !== "string" ||
    typeof surface.route !== "string" ||
    typeof surface.action !== "string" ||
    typeof surface.test !== "string"
  ) {
    throw new Error("invalid Web surface entry");
  }
  const route = surface.route;
  if (
    !route.startsWith("/") ||
    route.includes("\\") ||
    route.includes("//") ||
    route.includes("?") ||
    route.includes("#") ||
    route !== posix.normalize(route) ||
    (route !== "/" && route.endsWith("/"))
  ) {
    throw new Error(`Web surface must use an absolute Web route: ${route}`);
  }
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(surface.action)) {
    throw new Error(`invalid Web action: ${surface.action}`);
  }
  if (
    isAbsolute(surface.test) ||
    surface.test.includes("\\") ||
    surface.test.split("/").includes("..") ||
    !/^apps\/web\/src\/.+\.test\.tsx?$/.test(surface.test)
  ) {
    throw new Error(`invalid Web test path: ${surface.test}`);
  }
  if (!files.has(surface.test)) throw new Error(`missing Web test file: ${surface.test}`);
}

export function checkCoverage(server, cli, web, skill, files = new Set()) {
  if (!Array.isArray(server)) throw new Error("server capabilities must be an array");
  if (typeof cli !== "object" || cli === null || Array.isArray(cli)) {
    throw new Error("CLI bindings must be an object");
  }
  if (!Array.isArray(web)) throw new Error("Web surfaces must be an array");
  requireStringArray("Skill capabilities", skill);
  for (const surface of web) validateWebSurface(surface, files);

  const serverIds = server.map((capability) => {
    if (
      typeof capability !== "object" ||
      capability === null ||
      typeof capability.id !== "string" ||
      typeof capability.cli !== "string" ||
      !["required", "deferred"].includes(capability.web)
    ) {
      throw new Error("invalid server capability entry");
    }
    return capability.id;
  });
  const cliIds = Object.keys(cli);
  const requiredWebIds = server
    .filter((capability) => capability.web === "required")
    .map((capability) => capability.id);
  const webIds = web.map((surface) => surface.capabilityId);

  requireUnique("server capability", serverIds);
  requireUnique("Web capability", webIds);
  requireUnique(
    "Web action",
    web.map((surface) => surface.action),
  );
  requireUnique("Skill capability", skill);

  const serverSet = new Set(serverIds);
  const cliSet = new Set(cliIds);
  const requiredWebSet = new Set(requiredWebIds);
  const webSet = new Set(webIds);
  const skillSet = new Set(skill);

  for (const id of skill) {
    if (!serverSet.has(id)) throw new Error(`unknown Skill capability: ${id}`);
  }
  for (const id of serverIds) {
    if (!cliSet.has(id)) throw new Error(`missing CLI binding: ${id}`);
    if (typeof cli[id] !== "string" || cli[id].trim() === "") {
      throw new Error(`empty CLI binding: ${id}`);
    }
    const capability = server.find((candidate) => candidate.id === id);
    if (capability.cli !== cli[id]) {
      throw new Error(`CLI binding drift: ${id}; server=${capability.cli}; cli=${cli[id]}`);
    }
    if (!skillSet.has(id)) throw new Error(`missing Skill capability: ${id}`);
  }
  for (const id of cliIds) {
    if (!serverSet.has(id)) throw new Error(`unknown CLI binding: ${id}`);
  }
  for (const id of requiredWebIds) {
    if (!webSet.has(id)) throw new Error(`missing Web surface: ${id}`);
  }
  for (const id of webIds) {
    if (!requiredWebSet.has(id)) throw new Error(`unknown Web surface: ${id}`);
  }
  return { capabilities: serverIds.length, violations: 0 };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function checkRepositoryCoverage(repositoryRoot) {
  const server = readJson(
    resolve(repositoryRoot, "packages/capabilities/src/phase0-capabilities.json"),
  );
  const cli = readJson(resolve(repositoryRoot, "apps/cli/src/capability-bindings.json"));
  const web = readJson(resolve(repositoryRoot, "apps/web/src/capability-surfaces.json"));
  const skillDocument = readJson(
    resolve(repositoryRoot, "skill/tashan-orgspace/capability-references.json"),
  );
  if (typeof skillDocument !== "object" || skillDocument === null || skillDocument.version !== 1) {
    throw new Error("invalid Skill capability reference document");
  }
  const files = { has: (path) => existsSync(resolve(repositoryRoot, path)) };
  return checkCoverage(server, cli, web, skillDocument.capabilities, files);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = checkRepositoryCoverage(repositoryRoot);
  console.log(
    `check-capability-coverage: PASS (${result.violations} violations, ${result.capabilities} capabilities)`,
  );
}
