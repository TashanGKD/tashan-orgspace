import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export const FILE_CAPABILITY_IDS = Object.freeze([
  "space.list",
  "space.read",
  "space.usage.read",
  "space.quota.set",
  "file.list",
  "file.read",
  "file.search",
  "file.folder.create",
  "file.move",
  "file.trash",
  "file.restore",
  "file.delete",
  "file.download.create",
  "file.version.list",
  "file.version.restore",
  "file.upload.list",
  "file.upload.read",
  "file.upload.create",
  "file.upload.parts.create",
  "file.upload.complete",
  "file.upload.cancel",
  "folder.access.read",
  "folder.access.set",
  "folder.grant.set",
  "folder.grant.revoke",
  "folder.manager.recover",
]);

const AVAILABLE_MODULES = [
  "personal.overview",
  "personal.files",
  "personal.usage",
  "organization.files",
];
const DEFERRED_RUNTIME_MODULES = [
  "personal.runtime",
  "personal.services",
  "organization.runtime",
  "organization.services",
];
const MINIO_IMAGE = "quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z";
const MC_IMAGE = "quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z";

function record(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function exactSet(label, actual, expected) {
  if (
    actual.length !== expected.length ||
    [...actual].sort().join("\n") !== [...expected].sort().join("\n")
  ) {
    throw new Error(`${label} must contain the exact ${expected.length} entries`);
  }
}

function service(compose, name) {
  return record(record(compose, "Compose model").services, "Compose services")[name];
}

export function checkFileStorageContract(input) {
  exactSet("file capability contract", input.contractIds, FILE_CAPABILITY_IDS);
  const server = new Map(input.server.map((capability) => [capability.id, capability]));
  const skill = new Set(input.skillCapabilities);
  const web = new Set(input.web.map(({ capabilityId }) => capabilityId));
  for (const id of FILE_CAPABILITY_IDS) {
    const capability = server.get(id);
    if (capability === undefined) throw new Error(`missing server file capability: ${id}`);
    if (capability.web !== "required")
      throw new Error(`file Web capability is not required: ${id}`);
    const binding = input.bindings[id];
    if (typeof binding !== "string" || binding.trim() === "") {
      throw new Error(`missing file CLI binding: ${id}`);
    }
    if (binding !== capability.cli) throw new Error(`file CLI binding drift: ${id}`);
    if (!skill.has(id)) throw new Error(`missing file Skill capability: ${id}`);
    if (!web.has(id)) throw new Error(`missing file Web action: ${id}`);
    if (!input.fileReference.includes(`torg ${binding}`)) {
      throw new Error(`file Skill reference is missing command: torg ${binding}`);
    }
  }
  if (!input.skillMain.includes("references/files.md")) {
    throw new Error("Skill must route file work to references/files.md");
  }
  if (!/never call (?:minio or s3|s3 or minio) directly/i.test(input.fileReference)) {
    throw new Error("file Skill must forbid direct MinIO or S3 calls");
  }
  if (!/never (?:print or reuse|reuse or print) presigned urls/i.test(input.fileReference)) {
    throw new Error("file Skill must forbid printing or reusing presigned URLs");
  }

  const resources = new Map(input.resources.map((resource) => [resource.resourceType, resource]));
  const expectedResources = {
    "personal-file": ["/personal/files", "/personal/files/:entryId"],
    "organization-file": ["/org/:organizationId/files", "/org/:organizationId/files/:entryId"],
  };
  for (const [resourceType, routes] of Object.entries(expectedResources)) {
    const resource = resources.get(resourceType);
    if (
      resource === undefined ||
      resource.listRoute !== routes[0] ||
      resource.detailRoute !== routes[1]
    ) {
      throw new Error(`missing exact file resource surface: ${resourceType}`);
    }
  }

  const modules = new Map(input.modules.map((module) => [module.id, module]));
  for (const id of AVAILABLE_MODULES) {
    if (modules.get(id)?.status !== "available") {
      throw new Error(`file module must be available: ${id}`);
    }
  }
  for (const id of DEFERRED_RUNTIME_MODULES) {
    if (modules.get(id)?.status !== "coming_soon") {
      throw new Error(`runtime module must stay coming_soon: ${id}`);
    }
  }

  const localMinio = record(service(input.localCompose, "minio"), "local MinIO");
  const localBootstrap = record(
    service(input.localCompose, "minio-bootstrap"),
    "local MinIO bootstrap",
  );
  const productionMinio = record(service(input.productionCompose, "minio"), "production MinIO");
  const productionBootstrap = record(
    service(input.productionCompose, "minio-bootstrap"),
    "production MinIO bootstrap",
  );
  if (localMinio.image !== MINIO_IMAGE || productionMinio.image !== MINIO_IMAGE) {
    throw new Error("MinIO image pin drift");
  }
  if (localBootstrap.image !== MC_IMAGE || productionBootstrap.image !== MC_IMAGE) {
    throw new Error("MinIO client image pin drift");
  }
  if (
    !Array.isArray(localMinio.ports) ||
    localMinio.ports.length !== 1 ||
    localMinio.ports[0] !== "127.0.0.1:${ORGSPACE_LOCAL_S3_PORT:-59000}:9000"
  ) {
    throw new Error("local MinIO must publish only its loopback S3 port");
  }
  if (Array.isArray(productionMinio.ports) && productionMinio.ports.length > 0) {
    throw new Error("production MinIO must not publish ports");
  }
  const localCors = record(
    localMinio.environment,
    "local MinIO environment",
  ).MINIO_API_CORS_ALLOW_ORIGIN;
  const productionCors = record(
    productionMinio.environment,
    "production MinIO environment",
  ).MINIO_API_CORS_ALLOW_ORIGIN;
  if (
    typeof localCors !== "string" ||
    localCors.includes("*") ||
    !localCors.includes("http://127.0.0.1:4173")
  ) {
    throw new Error("local MinIO CORS must use explicit approved origins");
  }
  if (productionCors !== "https://orgspace.tashan.chat") {
    throw new Error("production MinIO CORS must allow only https://orgspace.tashan.chat");
  }
  if (
    !/mc\s+anonymous\s+set\s+none\s+local\/orgspace-files/.test(input.bootstrapSource) ||
    /mc\s+anonymous\s+set\s+(?:public|download|upload)/.test(input.bootstrapSource)
  ) {
    throw new Error("MinIO bucket must remain private");
  }
  if (!/server_name\s+files\.orgspace\.tashan\.chat;/.test(input.gatewaySource)) {
    throw new Error("file gateway hostname is missing");
  }
  if (
    !/proxy_set_header\s+Host\s+\$host;/.test(input.gatewaySource) ||
    !/proxy_pass\s+http:\/\/minio:9000;/.test(input.gatewaySource)
  ) {
    throw new Error("file gateway must preserve Host and proxy to MinIO");
  }
  return { capabilities: FILE_CAPABILITY_IDS.length, resources: 2, violations: 0 };
}

function capabilityIds(source) {
  const block = /export const FileCapabilityId = z\.enum\(\[([\s\S]*?)\]\);/.exec(source)?.[1];
  if (block === undefined) throw new Error("FileCapabilityId contract enum was not found");
  return [...block.matchAll(/"([a-z]+(?:\.[a-z]+)+)"/g)].map((match) => match[1]);
}

export function checkRepositoryFileStorageContract(repositoryRoot) {
  const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");
  const localComposeSource = read("deploy/compose.local.yml");
  const productionComposeSource = read("deploy/compose.production.yml");
  const skillDocument = JSON.parse(read("skill/tashan-orgspace/capability-references.json"));
  return checkFileStorageContract({
    contractIds: capabilityIds(read("packages/contracts/src/files.ts")),
    server: JSON.parse(read("packages/capabilities/src/phase0-capabilities.json")),
    bindings: JSON.parse(read("apps/cli/src/capability-bindings.json")),
    web: JSON.parse(read("apps/web/src/capability-surfaces.json")),
    skillCapabilities: skillDocument.capabilities,
    skillMain: read("skill/tashan-orgspace/SKILL.md"),
    fileReference: read("skill/tashan-orgspace/references/files.md"),
    resources: JSON.parse(read("apps/web/src/resource-surfaces.json")),
    modules: JSON.parse(read("apps/web/src/product-modules.json")),
    localCompose: parse(localComposeSource),
    productionCompose: parse(productionComposeSource),
    bootstrapSource: `${localComposeSource}\n${productionComposeSource}`,
    gatewaySource: read("deploy/nginx/aup-gateway.conf"),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = checkRepositoryFileStorageContract(root);
  console.log(
    `check-file-storage-contract: PASS (${result.violations} violations, ${result.capabilities} capabilities, ${result.resources} resources)`,
  );
}
