import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
  if (repeated.length > 0) {
    throw new Error(`duplicate ${label}: ${repeated.join(", ")}`);
  }
}

function requireStringArray(label, values) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
    throw new Error(`${label} must be an array of capability IDs`);
  }
}

export function checkCoverage(server, cli, web, skill) {
  if (!Array.isArray(server)) throw new Error("server capabilities must be an array");
  if (typeof cli !== "object" || cli === null || Array.isArray(cli)) {
    throw new Error("CLI bindings must be an object");
  }
  requireStringArray("Web surfaces", web);
  requireStringArray("Skill capabilities", skill);

  const serverIds = server.map((capability) => {
    if (
      typeof capability !== "object" ||
      capability === null ||
      typeof capability.id !== "string" ||
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

  requireUnique("server capability", serverIds);
  requireUnique("Web surface", web);
  requireUnique("Skill capability", skill);

  const serverSet = new Set(serverIds);
  const cliSet = new Set(cliIds);
  const requiredWebSet = new Set(requiredWebIds);
  const webSet = new Set(web);
  const skillSet = new Set(skill);

  for (const id of skill) {
    if (!serverSet.has(id)) throw new Error(`unknown Skill capability: ${id}`);
  }
  for (const id of serverIds) {
    if (!cliSet.has(id)) throw new Error(`missing CLI binding: ${id}`);
    if (typeof cli[id] !== "string" || cli[id].trim() === "") {
      throw new Error(`empty CLI binding: ${id}`);
    }
    if (!skillSet.has(id)) throw new Error(`missing Skill capability: ${id}`);
  }
  for (const id of cliIds) {
    if (!serverSet.has(id)) throw new Error(`unknown CLI binding: ${id}`);
  }
  for (const id of requiredWebIds) {
    if (!webSet.has(id)) throw new Error(`missing Web surface: ${id}`);
  }
  for (const id of web) {
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
  const skillDocument = readJson(resolve(repositoryRoot, "skill/capability-references.json"));
  if (typeof skillDocument !== "object" || skillDocument === null || skillDocument.version !== 1) {
    throw new Error("invalid Skill capability reference document");
  }

  return checkCoverage(server, cli, web, skillDocument.capabilities);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = checkRepositoryCoverage(repositoryRoot);
  console.log(
    `check-capability-coverage: PASS (${result.violations} violations, ${result.capabilities} capabilities)`,
  );
}
