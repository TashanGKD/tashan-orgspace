# Spaces, Files and Quotas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver personal and organization spaces, MinIO-backed files, folder permissions, quotas, versions, resumable multipart upload and 30-day trash consistently across API, Web, CLI and Skill.

**Architecture:** PostgreSQL is the control-plane truth for spaces, entries, grants, versions, reservations and upload sessions. MinIO is a private S3-compatible data plane; clients transfer bytes through short-lived presigned URLs on `orgspace-files.tashan.chat`, while API and Worker share a focused `@tashan/object-store` package for S3 operations. No file capability becomes available until API/Web/CLI/Skill parity, adversarial tests and production-stack recovery all pass.

**Tech Stack:** Node.js 24, TypeScript 6, Fastify 5, Zod 4, PostgreSQL 17, Redis 8, MinIO `RELEASE.2025-04-22T22-12-26Z`, AWS SDK for JavaScript v3 `3.1120.0`, React 19, TanStack Query 5, Commander 15, Docker Compose, Vitest.

---

## Source evidence

- `deploy/compose.local.yml` and `deploy/compose.production.yml` currently contain PostgreSQL and Redis but no object store.
- `apps/api/src/app.ts` mounts route modules and injects services; `apps/api/src/http/idempotency.ts` provides the existing transaction/audit/outbox mutation boundary.
- `apps/worker/src/main.ts` currently runs only `OutboxLoop`; file verification and cleanup need a separate leased loop.
- `packages/capabilities/src/phase0-capabilities.json`, `apps/cli/src/capability-bindings.json`, `apps/web/src/capability-surfaces.json` and `skill/tashan-orgspace/capability-references.json` are the current parity sources.
- `apps/web/src/resource-surfaces.json` contains four Phase 0 resource surfaces; file surfaces must extend this registry instead of bypassing it.
- `packages/sdk/src/transport.ts` supports JSON API traffic only. Presigned byte transfer must be a separate upload/download transport and must not put S3 credentials into the SDK.

## Target file structure

```text
packages/
  object-store/
    package.json
    src/client.ts
    src/presign.ts
    src/checksum.ts
    src/index.ts
    src/object-store.test.ts
  contracts/src/spaces.ts
  contracts/src/files.ts
apps/api/
  migrations/007_spaces_files.sql
  src/spaces/space-service.ts
  src/files/file-authorization.ts
  src/files/file-service.ts
  src/files/upload-service.ts
  src/routes/space-routes.ts
  src/routes/file-routes.ts
apps/worker/src/files/file-maintenance-loop.ts
apps/cli/src/commands/space.ts
apps/cli/src/commands/file.ts
apps/cli/src/commands/folder.ts
apps/web/src/features/files/
skill/tashan-orgspace/references/files.md
deploy/minio/app-policy.json
scripts/check-file-storage-contract.mjs
scripts/check-file-storage-contract.self-test.mjs
```

### Task 1: Add the private MinIO/S3 foundation

**Files:**
- Create: `packages/object-store/package.json`
- Create: `packages/object-store/tsconfig.json`
- Create: `packages/object-store/src/client.ts`
- Create: `packages/object-store/src/presign.ts`
- Create: `packages/object-store/src/checksum.ts`
- Create: `packages/object-store/src/index.ts`
- Create: `packages/object-store/src/object-store.test.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/worker/package.json`
- Modify: `.env.example`

- [x] **Step 1: Create the minimal test package and write RED configuration tests**

Create `packages/object-store/package.json` and `packages/object-store/tsconfig.json` with only the standard workspace test/typecheck scripts and Zod test dependency, but no implementation files. Then create `packages/object-store/src/object-store.test.ts` importing the missing implementation and testing rejection of HTTP public origins in production, credentials embedded in URLs, empty bucket names, path/query fragments, and identical internal/public origins in production. Include a valid local fixture:

```ts
const local = {
  endpoint: "http://minio:9000",
  publicOrigin: "http://127.0.0.1:59000",
  region: "us-east-1",
  bucket: "orgspace-files",
  accessKeyId: "test-access",
  secretAccessKey: "test-secret-value",
  forcePathStyle: true,
};
expect(parseObjectStoreConfig(local, "test")).toMatchObject(local);
```

The tests must also prove `temporaryObjectKey()` and `versionObjectKey()` accept only UUIDs and produce `temporary/<uuid>` or `versions/<uuid>` without user filenames.

- [x] **Step 2: Run the RED test**

Run:

```bash
pnpm --filter @tashan/object-store test
```

Expected: FAIL with a missing `client.js`/`index.js` implementation import; the test package itself must be discovered and executed.

- [x] **Step 3: Complete the shared package and pin runtime dependencies**

Update `packages/object-store/package.json` with `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` and `@aws-sdk/lib-storage` pinned to `3.1120.0`, plus Zod `4.4.3`. Implement and export:

```ts
export interface ObjectStoreConfig {
  endpoint: string;
  publicOrigin: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export function createInternalS3Client(config: ObjectStoreConfig): S3Client;
export function createPresignS3Client(config: ObjectStoreConfig): S3Client;
export function temporaryObjectKey(uploadSessionId: string): string;
export function versionObjectKey(versionId: string): string;
export async function sha256Stream(body: AsyncIterable<Uint8Array>): Promise<string>;
```

`createPresignS3Client` uses `publicOrigin`; internal commands use `endpoint`. Neither function logs credentials.

- [x] **Step 4: Add fail-closed environment parsing**

Add these exact keys to `.env.example` and later API/Worker config:

```dotenv
S3_ENDPOINT=http://127.0.0.1:59000
S3_PUBLIC_ORIGIN=http://127.0.0.1:59000
S3_REGION=us-east-1
S3_BUCKET=orgspace-files
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=true
FILE_STORAGE_ENABLED=false
```

Before Task 9, `FILE_STORAGE_ENABLED=false` preserves the currently deployed Phase 0 stack and does not parse unused S3 credentials. Task 9 sets it explicitly to true in local/E2E/production Compose; once true, production requires HTTPS `S3_PUBLIC_ORIGIN`, rejects loopback public origins and never supplies fallback credentials.

- [x] **Step 5: Run package tests and commit**

Run:

```bash
pnpm install --frozen-lockfile=false
pnpm --filter @tashan/object-store test
pnpm --filter @tashan/object-store typecheck
pnpm typecheck
```

Commit:

```bash
git add pnpm-lock.yaml packages/object-store apps/api/package.json apps/worker/package.json .env.example
git commit -m "feat(storage): add private S3 foundation"
```

### Task 2: Define exact contracts and error codes

**Files:**
- Create: `packages/contracts/src/spaces.ts`
- Create: `packages/contracts/src/files.ts`
- Create: `packages/contracts/src/files.test.ts`
- Modify: `packages/contracts/src/common.ts`
- Modify: `packages/contracts/src/error.ts`
- Modify: `packages/contracts/src/index.ts`

- [x] **Step 1: Write RED contract tests**

Test these branded IDs and enums:

```ts
SpaceId; FileEntryId; FileVersionId; UploadSessionId;
SpaceType = "personal" | "organization";
FileEntryKind = "file" | "folder";
FolderAccessScope = "organization_public" | "restricted";
FolderGrantRole = "manager" | "editor" | "viewer";
UploadSessionStatus = "created" | "uploading" | "verifying" | "completed" | "cancelled" | "expired" | "failed";
```

Reject negative byte counts, values above `Number.MAX_SAFE_INTEGER`, empty/`.`/`..` names, `/`, `\\`, NUL, control characters, non-NFC names, invalid part numbers and duplicate part numbers.

- [x] **Step 2: Define request and response schemas**

`spaces.ts` must export `SpaceSummary`, `SpaceListResponse`, `SpaceReadResponse`, `SpaceUsageResponse` and `PersonalQuotaSetRequest/Response`.

`files.ts` must export schemas for:

```text
FileEntrySummary, FileEntryDetail, FileVersionSummary
FileListQuery/Response, FileSearchQuery/Response
FolderCreateRequest/Response, FileMoveRequest/Response
FileTrashResponse, FileRestoreRequest/Response, FileDeleteResponse
FileDownloadResponse
FileVersionListResponse, FileVersionRestoreResponse
UploadCreateRequest/Response, UploadReadResponse, UploadListResponse
UploadPartUrlsRequest/Response, UploadCompleteRequest/Response, UploadCancelResponse
FolderAccessResponse, FolderAccessSetRequest/Response
FolderGrantSetRequest/Response, FolderGrantRevokeResponse, FolderManagerRecoverRequest/Response
```

Every response uses ISO timestamps and decimal-safe integer byte counts. `UploadCreateResponse` returns `partSizeBytes`, `partCount`, `expiresAt`, and no S3 credentials.

- [x] **Step 3: Add stable error codes**

Append exactly:

```text
SPACE_NOT_FOUND, SPACE_FORBIDDEN, SPACE_READONLY, QUOTA_EXCEEDED,
FILE_NOT_FOUND, FILE_FORBIDDEN, FILE_NAME_CONFLICT, FILE_VERSION_CONFLICT,
UPLOAD_NOT_FOUND, UPLOAD_EXPIRED, UPLOAD_INCOMPLETE, UPLOAD_CHECKSUM_MISMATCH,
FOLDER_MANAGER_REQUIRED, FOLDER_LAST_MANAGER
```

Map them immediately in `apps/api/src/http/error-handler.ts`: 404 for missing objects, 403 for forbidden/manager-required, 409 for readonly/name/version/last-manager conflicts, 410 for expired upload, 413 for quota, and 400 for incomplete/checksum input errors. This keeps the exhaustive `Record<ErrorCode, number>` compiling in the same commit as the contract change.

- [x] **Step 4: Freeze the 26 Phase 1 capability IDs in the file contract**

Export `FileCapabilityId` as the exact enum below for later Task 8 registry insertion. Do not add these IDs to the live server registry yet, because they have no mounted API/CLI implementation at this point:

```text
space.list, space.read, space.usage.read, space.quota.set,
file.list, file.read, file.search, file.folder.create, file.move,
file.trash, file.restore, file.delete, file.download.create,
file.version.list, file.version.restore,
file.upload.list, file.upload.read, file.upload.create,
file.upload.parts.create, file.upload.complete, file.upload.cancel,
folder.access.read, folder.access.set, folder.grant.set,
folder.grant.revoke, folder.manager.recover
```

Task 8 registers read capabilities with `sideEffect: "none"`; URL creation and all mutations with `write`; trash/delete/grant revoke/upload cancel with `revoke`. Confirmation is required for quota changes, trash, permanent delete, permission-scope changes, grant revoke and manager recovery.

- [x] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @tashan/contracts test
pnpm typecheck
```

Commit:

```bash
git add packages/contracts
git commit -m "feat(files): define file capability contracts"
```

### Task 3: Add the database model and automatic space creation

**Files:**
- Create: `apps/api/migrations/007_spaces_files.sql`
- Create: `apps/api/test/db/spaces-files-migration.integration.test.ts`
- Modify: `apps/api/test/db/schema.integration.test.ts`
- Modify: `apps/api/src/auth/auth-service.ts`
- Modify: `apps/api/src/organizations/organization-service.ts`
- Modify: `apps/api/test/auth/auth-service.test.ts`
- Modify: `apps/api/test/organizations/organization-service.integration.test.ts`

- [x] **Step 1: Write RED migration pathology tests**

Tests must prove:

- one personal space per account and one organization space per organization;
- `used_bytes >= 0`, `reserved_bytes >= 0`, and both fit safe integers;
- a file/folder cannot parent itself and parent/child spaces must match;
- active sibling normalized names are unique;
- only folders have access policies/grants;
- `restricted` folders always retain an effective manager through service operations;
- upload session/reservation are one-to-one;
- versions reference files, not folders;
- migration backfills spaces for existing accounts and organizations.

- [x] **Step 2: Implement migration 007**

Create tables:

```text
spaces, personal_quota_entitlements,
file_entries, file_versions,
folder_access_policies, folder_grants,
upload_sessions, upload_parts, storage_reservations,
trash_entries, file_maintenance_jobs
```

Use `bigint` for bytes, UUID primary keys, explicit check constraints, foreign keys, partial unique indexes for active sibling names, and indexes for space/parent listing, search, upload expiry, trash expiry and maintenance leases. Store `object_key`, never user paths, in `file_versions` and `upload_sessions`.

- [x] **Step 3: Create spaces in existing identity transactions**

In account registration, insert a personal space and its root folder before committing the account transaction. In organization creation, insert the organization space and public root folder in the same transaction as the owner Membership. Do not use an asynchronous post-create event for these invariants.

Use constants:

```ts
export const DEFAULT_PERSONAL_QUOTA_BYTES = 50n * 1024n ** 3n;
export const MAX_PERSONAL_QUOTA_BYTES = 500n * 1024n ** 3n;
export const ORGANIZATION_QUOTA_BYTES = 500n * 1024n ** 3n;
```

- [x] **Step 4: Verify migration and identity regressions**

Run:

```bash
pnpm --filter @tashan/api test:integration
pnpm --filter @tashan/api test
```

Expected: backfill, uniqueness and automatic creation tests pass; Phase 0 registration/organization tests remain green.

- [x] **Step 5: Commit**

```bash
git add apps/api/migrations/007_spaces_files.sql apps/api/src/auth apps/api/src/organizations apps/api/test
git commit -m "feat(files): add spaces and file schema"
```

### Task 4: Implement permission resolution and quota reservations

**Files:**
- Create: `apps/api/src/spaces/space-service.ts`
- Create: `apps/api/src/files/file-authorization.ts`
- Create: `apps/api/src/files/file-repository.ts`
- Create: `apps/api/test/files/file-authorization.integration.test.ts`
- Create: `apps/api/test/files/quota-reservation.integration.test.ts`

- [x] **Step 1: Write RED authorization tests first**

Cover personal owner access, organization public editor access, restricted manager/editor/viewer behavior, administrator metadata-only access, child inheritance, nested boundary override, source+target move authorization, removed Membership, cross-space IDs, and last-manager rejection.

- [x] **Step 2: Implement one permission resolver**

Export one shared decision function; routes and services may not duplicate permission SQL:

```ts
type FilePermission = "metadata" | "read" | "write" | "manage";

export async function requireFilePermission(
  transaction: TransactionClient,
  input: { accountId: string; spaceId: string; entryId?: string; permission: FilePermission },
): Promise<{ space: SpaceRow; entry?: FileEntryRow; inheritedFromFolderId?: string }>;
```

Resolve the nearest ancestor policy with a recursive CTE. Personal spaces authorize only their owner. Organization administrators receive `metadata` for restricted folders, not `read`.

- [x] **Step 3: Write RED concurrent quota tests**

Create two transactions that each attempt to reserve the final available bytes. Exactly one succeeds; the other returns `QUOTA_EXCEEDED`. Test cancellation, expiry and completion each transition the reservation exactly once.

- [x] **Step 4: Implement transactional quota operations**

`SpaceService.reserve`, `commitReservation`, and `releaseReservation` must lock the `spaces` row with `FOR UPDATE`, validate current effective entitlement, and update `reserved_bytes`/`used_bytes` in the same transaction. No API path writes counters directly.

- [x] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @tashan/api test:integration
pnpm --filter @tashan/api test
```

Commit:

```bash
git add apps/api/src/spaces apps/api/src/files/file-authorization.ts apps/api/src/files/file-repository.ts apps/api/test/files
git commit -m "security(files): enforce folder and quota boundaries"
```

### Task 5: Implement multipart upload sessions and S3 isolation

**Files:**
- Create: `apps/api/src/files/upload-service.ts`
- Create: `apps/api/test/files/upload-service.integration.test.ts`
- Create: `apps/api/test/files/upload-service.test.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/src/server.ts`

- [x] **Step 1: Write RED adversarial upload tests**

Before implementation, reject forged object keys/upload IDs, part 0/10001, duplicate parts, presign requests outside the server-determined part range, expired/cancelled sessions, cross-device users without current permission, same-name ambiguity, mismatched target file IDs, and private/loopback production public origins.

- [x] **Step 2: Implement upload session creation**

`UploadService.create` must:

1. validate target folder write permission;
2. normalize the name and resolve same-name/version intent;
3. calculate `partSize = max(16 MiB, ceil(size / 10_000) rounded to MiB)`;
4. reserve quota in the same DB transaction as the session;
5. create the MinIO multipart upload only after DB intent exists;
6. persist the opaque S3 upload ID without returning credentials.

If S3 creation fails, mark the session failed and release the reservation. If DB persistence after S3 creation fails, abort that exact multipart upload.

- [x] **Step 3: Implement bounded part URL batches**

`authorizeParts` accepts at most 100 unique part numbers, checks the session and current permission, and returns URLs valid for at most 15 minutes. Sign `UploadPartCommand` with `ChecksumSHA256`; never accept bucket, key, endpoint or upload ID from the caller.

- [x] **Step 4: Implement completion transition**

Compare the caller part list to S3 `ListParts`, verify total byte size, complete the multipart object, enqueue a `file.verify` maintenance job and move the session to `verifying`. Repeated completion returns the same session/version state. It must not publish a downloadable version before Worker verification.

- [x] **Step 5: Verify and commit**

Run unit tests with a fake S3 adapter, then MinIO integration tests after Task 9 adds Compose:

```bash
pnpm --filter @tashan/api test
pnpm --filter @tashan/api typecheck
```

Commit:

```bash
git add apps/api/src/files/upload-service.ts apps/api/src/config.ts apps/api/src/config.test.ts apps/api/src/server.ts apps/api/test/files
git commit -m "feat(files): add resumable upload sessions"
```

### Task 6: Implement file operations

**Files:**
- Create: `apps/api/src/files/file-service.ts`

- [x] **Step 1: Write RED service contract tests**

Exercise the service methods that Task 8 will mount on these exact routes:

```text
GET    /v1/spaces
GET    /v1/spaces/:spaceId
GET    /v1/spaces/:spaceId/usage
POST   /v1/organizations/:organizationId/members/:accountId/personal-space-quota
GET    /v1/spaces/:spaceId/entries
GET    /v1/spaces/:spaceId/entries/:entryId
GET    /v1/spaces/:spaceId/search
POST   /v1/spaces/:spaceId/folders
POST   /v1/spaces/:spaceId/entries/:entryId/move
POST   /v1/spaces/:spaceId/entries/:entryId/trash
POST   /v1/spaces/:spaceId/entries/:entryId/restore
DELETE /v1/spaces/:spaceId/entries/:entryId
POST   /v1/spaces/:spaceId/entries/:entryId/download
GET    /v1/spaces/:spaceId/entries/:entryId/versions
POST   /v1/spaces/:spaceId/entries/:entryId/versions/:versionId/restore
GET    /v1/spaces/:spaceId/uploads
POST   /v1/spaces/:spaceId/uploads
GET    /v1/spaces/:spaceId/uploads/:uploadSessionId
POST   /v1/spaces/:spaceId/uploads/:uploadSessionId/parts
POST   /v1/spaces/:spaceId/uploads/:uploadSessionId/complete
POST   /v1/spaces/:spaceId/uploads/:uploadSessionId/cancel
GET    /v1/spaces/:spaceId/folders/:folderId/access
POST   /v1/spaces/:spaceId/folders/:folderId/access
POST   /v1/spaces/:spaceId/folders/:folderId/grants
DELETE /v1/spaces/:spaceId/folders/:folderId/grants/:accountId
POST   /v1/spaces/:spaceId/folders/:folderId/manager-recovery
```

Tests must assert authorization, audit input, idempotency result and stable domain errors for every mutation. Route/capability assertions belong to Task 8 when the vertical API/CLI slice becomes executable.

- [x] **Step 2: Implement file semantics**

`FileService` owns list/read/search/create-folder/move/trash/restore/delete/version-list/version-restore/access/grant methods. Search queries only metadata and applies the same resolver as reads. Move updates parent and normalized name under row locks. Restore rejects occupied names without silently renaming.

- [x] **Step 3: Implement safe download creation**

Only `available` versions receive GET URLs, valid at most 5 minutes. The signed response sets safe content disposition and does not inline active HTML/SVG/script content. URL creation is audited as `file.download.create`.

- [x] **Step 4: Keep services unmounted until the vertical capability slice**

Keep file services unmounted until Task 8 can add API, SDK, CLI and Skill in one gate-consistent submission. Service tests must prove thrown errors contain stable public codes and never include object keys or S3 details.

- [x] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @tashan/api test
pnpm --filter @tashan/api test:integration
pnpm typecheck
```

Commit:

```bash
git add apps/api/src/files apps/api/test/files
git commit -m "feat(api): expose space and file operations"
```

### Task 7: Add Worker verification, expiry, trash and reconciliation

**Files:**
- Create: `apps/worker/src/files/file-maintenance-loop.ts`
- Create: `apps/worker/src/files/file-maintenance-loop.integration.test.ts`
- Modify: `apps/worker/src/config.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/package.json`

- [x] **Step 1: Write RED cleanup and lease tests**

Cover worker death during SHA-256 streaming, two workers claiming one job, checksum mismatch, object missing, multipart abort failure, upload expiry, restored trash racing expiry, repeated permanent deletion and database failure after successful object deletion.

- [x] **Step 2: Implement a separate leased maintenance loop**

Do not overload `OutboxLoop`. Claim `file_maintenance_jobs` with `FOR UPDATE SKIP LOCKED`, owner ID, lease expiry and attempt count. Handlers are `verify_upload`, `expire_upload`, `purge_trash`, and `reconcile_version`.

- [x] **Step 3: Verify canonical SHA-256 before publication**

Stream `GetObject` through `sha256Stream`, compare expected size and optional caller hash, copy/move the temporary object to `versions/<versionId>`, then atomically create/activate the version and commit the reservation. Until that transaction completes, download remains unavailable.

- [x] **Step 4: Implement cleanup ordering**

For purge: delete the S3 object first; treat `NoSuchKey` as already deleted; only then decrement `used_bytes` and finish DB cleanup. For expired uploads: abort multipart, delete any completed temporary object, then release the reservation. Failed cleanup stays retryable with backoff.

- [x] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @tashan/worker test
pnpm --filter @tashan/worker test:integration
pnpm --filter @tashan/worker typecheck
```

Commit:

```bash
git add apps/worker
git commit -m "feat(worker): verify and reconcile file objects"
```

### Task 8: Register the executable API, SDK, CLI and Skill slice

> **Execution dependency:** Run Task 9 first. Do not register or expose file capabilities until the MinIO data plane and production-shaped storage checks are green.

**Files:**
- Create: `packages/sdk/src/file-transfer.ts`
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/sdk/src/client.test.ts`
- Create: `apps/api/src/routes/space-routes.ts`
- Create: `apps/api/src/routes/file-routes.ts`
- Create: `apps/api/test/http/file-routes.integration.test.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/cli/src/commands/space.ts`
- Create: `apps/cli/src/commands/file.ts`
- Create: `apps/cli/src/commands/folder.ts`
- Create: `apps/cli/src/commands/files.test.ts`
- Modify: `apps/cli/src/program.ts`
- Modify: `apps/cli/src/capability-bindings.json`
- Modify: `packages/capabilities/src/phase0-capabilities.json`
- Modify: `skill/tashan-orgspace/capability-references.json`

- [x] **Step 1: Write RED route, SDK and CLI tests**

Assert all 26 capabilities call the Task 6 services through the exact routes. Upload tests use a local HTTP fixture and verify part retry, resume, SHA-256 header, missing-part recovery and that Authorization/user tokens are never sent to presigned origins. Download tests reject redirects to a different origin unless the exact presigned response URL authorizes it.

- [x] **Step 2: Add an explicit transfer interface**

Export:

```ts
export interface FileByteTransport {
  uploadPart(input: { url: string; bytes: Uint8Array; checksumSha256: string }): Promise<{ etag: string }>;
  download(input: { url: string; destination: string; expectedSha256: string }): Promise<void>;
}
```

Keep this separate from JSON `Transport`. Strip OrgSpace auth headers on presigned requests, reject non-HTTP(S) URLs and verify final downloaded SHA-256 before atomically publishing from a temporary sibling. Refuse an existing destination and use a no-clobber operation so a race cannot overwrite it.

- [x] **Step 3: Register capabilities, mount routes and implement CLI commands**

Add all 26 IDs to the server registry with exact CLI bindings and Skill references in the same change; set `web: "deferred"` until Task 10. Mount space/file routes and inject services in `buildApp`. Register the commands fixed in the design. `file upload` requires `--space`, `--parent`, and local path; `--target-file` is the only version-upload path. `file download` writes to a temporary sibling and atomically publishes without overwriting after checksum success. `upload resume` reads server state rather than trusting a local-only part list.

- [x] **Step 4: Enforce safe defaults**

No-argument groups print help without runtime initialization. Same-name upload exits with `FILE_NAME_CONFLICT`. Trash, delete, access-scope changes, revoke and manager recovery require confirmation/idempotency using existing helpers; permanent delete text states that all versions are removed.

- [x] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @tashan/api test
pnpm --filter @tashan/api test:integration
pnpm --filter @tashan/sdk test
pnpm --filter @tashan/cli test
pnpm --filter @tashan/cli typecheck
node scripts/check-capability-coverage.mjs
```

Commit:

```bash
git add packages/capabilities packages/sdk apps/api/src/routes apps/api/src/app.ts apps/api/test/http apps/cli skill/tashan-orgspace/capability-references.json
git commit -m "feat(cli): add resumable file commands"
```

### Task 9: Deploy MinIO locally and in the production-shaped stack

> **Execution order:** This task runs immediately after Task 7 and before Task 8, even though the task number is retained to preserve existing references.

**Files:**
- Create: `deploy/minio/app-policy.json`
- Modify: `deploy/compose.local.yml`
- Modify: `deploy/compose.production.yml`
- Modify: `deploy/nginx/aup-gateway.conf`
- Modify: `deploy/nginx/ecs-orgspace.conf`
- Modify: `tests/production-stack/run.sh`
- Modify: `tests/production-stack/stack.test.ts`
- Modify: `tests/e2e/run.ts`
- Modify: `tests/e2e/support/api-process.ts`

- [x] **Step 1: Add RED production-boundary assertions**

The production test must fail if MinIO S3 or Console ports are published, bucket policy is public, CORS permits `*`, API/Worker lack S3 credentials, or `orgspace-files.tashan.chat` does not preserve Host through the gateway.

- [x] **Step 2: Add pinned MinIO services**

Use:

```yaml
image: quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z
command: ["server", "/data", "--console-address", ":9001"]
```

Use `quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z` for one-shot bootstrap. Local S3 publishes only `127.0.0.1:59000:9000`; production publishes neither 9000 nor 9001. Bootstrap creates `orgspace-files`, sets anonymous access to none, creates the app service user and attaches `app-policy.json` scoped to that bucket. Configure the pinned MinIO server through `MINIO_API_CORS_ALLOW_ORIGIN`; that release rejects bucket-level `PutBucketCors`, so the production-shaped preflight test—not a bootstrap command—is the executable CORS gate.

- [x] **Step 3: Route the platform file hostname**

Add an AUP gateway server block for `orgspace-files.tashan.chat` that proxies S3 traffic to `minio:9000`, disables request buffering, permits large bodies, preserves Host and uses long streaming timeouts. Add an ECS TLS server block for the same hostname pointing to the existing OrgSpace platform tunnel; do not create per-file or per-user tunnels.

- [x] **Step 4: Make tests isolated and recoverable**

Production-stack and E2E use unique Compose projects, isolated named volumes and test credentials. Cleanup removes only that exact Compose project and its named volumes. Restart MinIO and repeat the private-bucket, CORS and gateway assertions here. The byte-level unfinished-upload resume test requires the Task 8 HTTP surface and therefore runs in Task 12 after that surface is mounted.

- [x] **Step 5: Verify and commit**

Run:

```bash
pnpm test:production-stack
pnpm test:e2e
```

Commit:

```bash
git add deploy tests/production-stack tests/e2e .env.example
git commit -m "feat(deploy): add private MinIO data plane"
```

### Task 10: Build the Web file workspace

**Files:**
- Create: `apps/web/src/features/files/file-list-page.tsx`
- Create: `apps/web/src/features/files/file-detail-drawer.tsx`
- Create: `apps/web/src/features/files/file-upload-dialog.tsx`
- Create: `apps/web/src/features/files/folder-access-dialog.tsx`
- Create: `apps/web/src/features/files/files-page.test.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/product-modules.json`
- Modify: `apps/web/src/resource-surfaces.json`
- Modify: `apps/web/src/capability-surfaces.json`
- Modify: `apps/web/src/design-system/resource-surfaces.css`

- [x] **Step 1: Write RED list/detail/state tests**

Test personal and organization routes, breadcrumbs, loading/empty/error/forbidden/readonly/conflict states, folder role labels, quota/reserved display, metadata search, detail drawer deep links, upload interruption/resume, version restore, trash restore and manager-only permission controls.

- [x] **Step 2: Add resource surfaces**

Register separate `personal-file` and `organization-file` surfaces with list/detail routes from the design. Every action capability must appear in `capability-surfaces.json`; route tests must prove both surfaces are mounted from `resourceSurface(...)`.

- [x] **Step 3: Implement lists and details using shared primitives**

Use TanStack Query keys containing `spaceId`; organization keys also contain `organizationId`. Do not store file truth in a global client store. Desktop uses list/detail split, mobile uses nested detail navigation. Preview active content only through the isolated/safe path from Task 6.

- [x] **Step 4: Implement resumable browser upload**

The dialog creates a session, computes per-part checksum, uploads directly to presigned URLs, refreshes only missing/expired part URLs, completes, and polls `verifying` until `available` or `failed`. Never store S3 URLs or file bytes in localStorage.

- [x] **Step 5: Flip modules only after the full surface is green**

Change the 26 file capabilities from `web: "deferred"` to `web: "required"` only after all route/action tests pass, and add every required Web surface in the same change. Set `personal.overview`, `personal.files`, `personal.usage`, and `organization.files` to `available`. Keep runtime/services deferred. Run:

```bash
pnpm --filter @tashan/web test
pnpm --filter @tashan/web typecheck
pnpm --filter @tashan/web build
node scripts/check-deferred-product-scope.mjs
```

Commit:

```bash
git add apps/web
git commit -m "feat(web): add personal and organization files"
```

### Task 11: Complete Skill coverage and executable drift gates

**Files:**
- Create: `skill/tashan-orgspace/references/files.md`
- Modify: `skill/tashan-orgspace/SKILL.md`
- Modify: `skill/tashan-orgspace/capability-references.json`
- Create: `scripts/check-file-storage-contract.mjs`
- Create: `scripts/check-file-storage-contract.self-test.mjs`
- Modify: `scripts/verify-phase0.sh`
- Modify: `scripts/verify-phase0.self-test.sh`

- [x] **Step 1: Document the user workflow without S3 bypasses**

The Skill reference covers space discovery, list/get/search, resumable upload, explicit version upload, safe download, trash/restore/delete and folder grants. It must state that agents never call MinIO/S3 directly and never reuse or print presigned URLs.

- [x] **Step 2: Write the RED gate self-test**

Construct fixtures that independently fail for missing CLI binding, missing Skill capability, missing Web action, file module still `coming_soon`, runtime module accidentally `available`, MinIO production port exposure, wildcard CORS, public bucket command, and absent `orgspace-files.tashan.chat` gateway block.

- [x] **Step 3: Implement and wire the gate**

`check-file-storage-contract.mjs` reads repository files only, makes no network calls and writes nothing. It checks the 26 exact capability IDs across server/CLI/Web/Skill, two resource surfaces, four available file/space modules, MinIO image pins, private production ports, CORS allowlist and gateway hostname. Wire production gate and self-test into `verify-phase0.sh`; gate discovery must report 18 gates.

- [x] **Step 4: Run gate negative and positive paths**

Run:

```bash
node scripts/check-file-storage-contract.self-test.mjs
node scripts/check-file-storage-contract.mjs
node scripts/check-gate-self-tests.mjs
bash scripts/verify-phase0.self-test.sh
```

- [x] **Step 5: Commit**

```bash
git add skill/tashan-orgspace scripts
git commit -m "ci(files): enforce storage surface parity"
```

### Task 12: Run two-user acceptance, recovery and release evidence

**Files:**
- Create: `tests/e2e/files-lifecycle.test.ts`
- Create: `tests/e2e/files-authorization.test.ts`
- Create: `tests/e2e/files-recovery.test.ts`
- Create: `docs/verification/spaces-files-quotas.md`
- Modify: `README.md`
- Modify: `docs/architecture/phase0-security-foundation.md`
- Modify: `docs/superpowers/plans/2026-08-26-full-product-delivery.md`

- [x] **Step 1: Add the complete synthetic journey**

Use two accounts, two organizations and two devices. Prove personal isolation, public folder collaboration, restricted manager/editor/viewer behavior, administrator metadata-only access, manager recovery, cross-organization denial and removed-member denial.

- [x] **Step 2: Exercise bytes and lifecycle**

Upload a multi-part fixture, interrupt after at least two parts, resume from another authorized device, complete SHA-256 verification, download and compare bytes. Exercise same-name conflict, explicit new version, historical restore, trash restore, forced expiry and permanent purge.

- [x] **Step 3: Exercise quota and recovery**

Run concurrent final-byte reservations, quota entitlement increase/decrease, read-only transition, MinIO restart mid-upload, Worker restart during verification, orphan temporary object cleanup and missing-version-object detection. Assert every failed path leaves counters and objects reconcilable.

- [x] **Step 4: Run the complete verifier**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
node scripts/check-file-storage-contract.mjs
ORGSPACE_TEST_CLEANUP_VOLUMES=1 bash scripts/verify-phase0.sh
```

Expected: all commands pass; gate discovery reports 18 gates; production stack and all E2E journeys pass.

- [x] **Step 5: Record evidence and commit**

`docs/verification/spaces-files-quotas.md` records the exact commit, MinIO image tags, capability count, test counts, browser widths, two-user journeys, restart/restore results and remaining debt. Update README from “files pending” to the verified capability boundary; do not claim compute/hosting.

Commit:

```bash
git add tests/e2e docs/verification README.md docs/architecture/phase0-security-foundation.md docs/superpowers/plans/2026-08-26-full-product-delivery.md
git commit -m "docs(verification): record Phase 1 file acceptance"
```
