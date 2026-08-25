import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_PHONE_AUTH_CAPABILITIES = Object.freeze([
  "auth.verification.send",
  "auth.password.reset",
  "auth.register",
  "auth.login",
]);

function idsFromEntries(label, entries, key) {
  if (!Array.isArray(entries)) throw new Error(`${label} must be an array`);
  return new Set(
    entries.map((entry) => {
      if (typeof entry !== "object" || entry === null || typeof entry[key] !== "string") {
        throw new Error(`invalid ${label} entry`);
      }
      return entry[key];
    }),
  );
}

function requireCapabilities(label, ids) {
  for (const capabilityId of REQUIRED_PHONE_AUTH_CAPABILITIES) {
    if (!ids.has(capabilityId)) {
      throw new Error(
        `missing ${label} phone-auth ${label === "CLI" ? "binding" : "surface"}: ${capabilityId}`,
      );
    }
  }
}

function fencedCode(document) {
  return [...document.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1]).join("\n");
}

export function checkPhoneAuthSurface({
  registry,
  cliBindings,
  webSurfaces,
  skillReferences,
  activeSources,
  skillAuthentication,
}) {
  const registryIds = idsFromEntries("registry", registry, "id");
  if (typeof cliBindings !== "object" || cliBindings === null || Array.isArray(cliBindings)) {
    throw new Error("CLI bindings must be an object");
  }
  const cliIds = new Set(Object.keys(cliBindings));
  const webIds = idsFromEntries("Web", webSurfaces, "capabilityId");
  if (
    typeof skillReferences !== "object" ||
    skillReferences === null ||
    skillReferences.version !== 1 ||
    !Array.isArray(skillReferences.capabilities)
  ) {
    throw new Error("invalid Skill capability references");
  }
  const skillIds = new Set(skillReferences.capabilities);

  requireCapabilities("registry", registryIds);
  requireCapabilities("CLI", cliIds);
  requireCapabilities("Web", webIds);
  requireCapabilities("Skill", skillIds);

  if (typeof activeSources !== "object" || activeSources === null || Array.isArray(activeSources)) {
    throw new Error("active auth sources must be an object");
  }
  for (const [path, source] of Object.entries(activeSources)) {
    if (typeof source !== "string") throw new Error(`invalid active auth source: ${path}`);
    if (/\.(?:requiredOption|option)\(\s*["']--username(?:[ =<]|["'])/.test(source)) {
      throw new Error(`legacy username auth option: ${path}`);
    }
    if (/\bwhere\s+(?:"?[a-z_][\w]*"?\.)?"?username"?\s*=/i.test(source)) {
      throw new Error(`legacy username authentication lookup: ${path}`);
    }
  }

  if (typeof skillAuthentication !== "string") {
    throw new Error("Skill authentication document must be text");
  }
  const commands = fencedCode(skillAuthentication);
  const secretOption = commands.match(/--(?:password|code)(?=[ =]|$)/);
  if (secretOption !== null) {
    throw new Error(`secret-bearing Skill command option: ${secretOption[0]}`);
  }

  return { capabilities: REQUIRED_PHONE_AUTH_CAPABILITIES.length, violations: 0 };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function checkRepositoryPhoneAuthSurface(repositoryRoot) {
  const activePaths = [
    "packages/contracts/src/auth.ts",
    "apps/api/src/auth/auth-service.ts",
    "apps/api/src/repositories/account-repository.ts",
    "apps/api/src/routes/auth-routes.ts",
    "apps/api/src/routes/phone-routes.ts",
    "packages/sdk/src/client.ts",
    "apps/cli/src/commands/auth.ts",
    "apps/cli/src/program.ts",
    "apps/web/src/auth/access-panel.tsx",
    "apps/web/src/platform/session/session-context.tsx",
  ];
  const activeSources = Object.fromEntries(
    activePaths.map((path) => [path, readFileSync(resolve(repositoryRoot, path), "utf8")]),
  );
  return checkPhoneAuthSurface({
    registry: readJson(
      resolve(repositoryRoot, "packages/capabilities/src/phase0-capabilities.json"),
    ),
    cliBindings: readJson(resolve(repositoryRoot, "apps/cli/src/capability-bindings.json")),
    webSurfaces: readJson(resolve(repositoryRoot, "apps/web/src/capability-surfaces.json")),
    skillReferences: readJson(
      resolve(repositoryRoot, "skill/tashan-orgspace/capability-references.json"),
    ),
    activeSources,
    skillAuthentication: readFileSync(
      resolve(repositoryRoot, "skill/tashan-orgspace/references/authentication.md"),
      "utf8",
    ),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = checkRepositoryPhoneAuthSurface(repositoryRoot);
  console.log(
    `check-phone-auth-surface: PASS (${result.violations} violations, ${result.capabilities} auth capabilities)`,
  );
}
