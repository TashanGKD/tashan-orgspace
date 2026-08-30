import { strict as assert } from "node:assert";

import {
  checkFileStorageContract,
  FILE_CAPABILITY_IDS,
  pendingMigrationNames,
} from "./check-file-storage-contract.mjs";

const server = FILE_CAPABILITY_IDS.map((id) => ({
  id,
  cli: `file ${id}`,
  web: "required",
}));
const valid = {
  contractIds: FILE_CAPABILITY_IDS,
  server,
  bindings: Object.fromEntries(server.map(({ id, cli }) => [id, cli])),
  web: FILE_CAPABILITY_IDS.map((capabilityId) => ({ capabilityId })),
  skillCapabilities: FILE_CAPABILITY_IDS,
  skillMain: "Read references/files.md before file work.",
  fileReference: `${server.map(({ cli }) => `torg ${cli}`).join("\n")}\ntorg file version-restore --space <space-id> --file <file-id> --version-id <version-id>\nNever call MinIO or S3 directly. Never print or reuse presigned URLs.`,
  cliFileSource: '.requiredOption("--version-id <id>")',
  plannedMigrations: ["009_collaboration_kernel.sql", "010_work_items.sql"],
  actualMigrations: ["007_spaces_files.sql", "008_file_purge_upload_history.sql"],
  resources: [
    {
      resourceType: "personal-file",
      listRoute: "/personal/files",
      detailRoute: "/personal/files/:entryId",
    },
    {
      resourceType: "organization-file",
      listRoute: "/org/:organizationId/files",
      detailRoute: "/org/:organizationId/files/:entryId",
    },
  ],
  modules: [
    ...["personal.overview", "personal.files", "personal.usage", "organization.files"].map(
      (id) => ({ id, status: "available" }),
    ),
    ...[
      "personal.runtime",
      "personal.services",
      "organization.runtime",
      "organization.services",
    ].map((id) => ({ id, status: "coming_soon" })),
  ],
  localCompose: {
    services: {
      minio: {
        image: "quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z",
        environment: {
          MINIO_API_CORS_ALLOW_ORIGIN: "https://orgspace.tashan.chat,http://127.0.0.1:4173",
        },
        ports: ["127.0.0.1:${ORGSPACE_LOCAL_S3_PORT:-59000}:9000"],
      },
      "minio-bootstrap": { image: "quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z" },
    },
  },
  productionCompose: {
    services: {
      minio: {
        image: "quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z",
        environment: { MINIO_API_CORS_ALLOW_ORIGIN: "https://orgspace.tashan.chat" },
      },
      "minio-bootstrap": { image: "quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z" },
    },
  },
  bootstrapSource:
    "mc mb --ignore-existing local/orgspace-files\nmc anonymous set none local/orgspace-files",
  gatewaySource:
    "server_name orgspace-files.tashan.chat; proxy_set_header Host $host; proxy_pass http://minio:9000;",
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const missingCli = clone(valid);
delete missingCli.bindings[FILE_CAPABILITY_IDS[0]];
assert.throws(() => checkFileStorageContract(missingCli), /missing file CLI binding/);

const missingSkill = clone(valid);
missingSkill.skillCapabilities = missingSkill.skillCapabilities.slice(1);
assert.throws(() => checkFileStorageContract(missingSkill), /missing file Skill capability/);

const missingWeb = clone(valid);
missingWeb.web = missingWeb.web.slice(1);
assert.throws(() => checkFileStorageContract(missingWeb), /missing file Web action/);

const deferredFile = clone(valid);
deferredFile.modules.find(({ id }) => id === "personal.files").status = "coming_soon";
assert.throws(() => checkFileStorageContract(deferredFile), /file module must be available/);

const enabledRuntime = clone(valid);
enabledRuntime.modules.find(({ id }) => id === "organization.runtime").status = "available";
assert.throws(
  () => checkFileStorageContract(enabledRuntime),
  /runtime module must stay coming_soon/,
);

const exposedMinio = clone(valid);
exposedMinio.productionCompose.services.minio.ports = ["0.0.0.0:9000:9000"];
assert.throws(
  () => checkFileStorageContract(exposedMinio),
  /production MinIO must not publish ports/,
);

const wildcardCors = clone(valid);
wildcardCors.productionCompose.services.minio.environment.MINIO_API_CORS_ALLOW_ORIGIN = "*";
assert.throws(() => checkFileStorageContract(wildcardCors), /production MinIO CORS/);

const publicBucket = clone(valid);
publicBucket.bootstrapSource = publicBucket.bootstrapSource.replace("set none", "set public");
assert.throws(() => checkFileStorageContract(publicBucket), /bucket must remain private/);

const missingGateway = clone(valid);
missingGateway.gatewaySource = "proxy_pass http://minio:9000;";
assert.throws(() => checkFileStorageContract(missingGateway), /file gateway hostname/);

const conflictingVersionOption = clone(valid);
conflictingVersionOption.cliFileSource = '.requiredOption("--version <id>")';
assert.throws(
  () => checkFileStorageContract(conflictingVersionOption),
  /non-conflicting --version-id option/,
);

const collidingMigration = clone(valid);
collidingMigration.actualMigrations.push("009_collaboration_kernel.sql");
assert.throws(
  () => checkFileStorageContract(collidingMigration),
  /planned migration collides with existing migration/,
);

assert.deepEqual(
  pendingMigrationNames(`
### Task 1: completed
**Files:** Create \`apps/api/migrations/009_collaboration_kernel.sql\`
- [x] done
### Task 2: pending
**Files:** Create \`apps/api/migrations/010_work_items.sql\`
- [ ] pending
`),
  ["010_work_items.sql"],
);

assert.doesNotThrow(() => checkFileStorageContract(valid));
console.log("check-file-storage-contract.self-test: PASS");
