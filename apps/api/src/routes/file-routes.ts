import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { CapabilityId } from "@tashan/capabilities";
import {
  AccountId,
  FileDeleteResponse,
  FileDownloadResponse,
  FileEntryId,
  FileListQuery,
  FileListResponse,
  FileMoveRequest,
  FileMoveResponse,
  FileReadResponse,
  FileRestoreRequest,
  FileRestoreResponse,
  FileSearchQuery,
  FileSearchResponse,
  FileTrashResponse,
  FileVersionId,
  FileVersionListResponse,
  FileVersionRestoreRequest,
  FileVersionRestoreResponse,
  FolderAccessResponse,
  FolderAccessSetRequest,
  FolderAccessSetResponse,
  FolderCreateRequest,
  FolderCreateResponse,
  FolderGrantRevokeResponse,
  FolderGrantSetRequest,
  FolderGrantSetResponse,
  FolderManagerRecoverRequest,
  FolderManagerRecoverResponse,
  SpaceIdPath,
  UploadCancelResponse,
  UploadCompleteRequest,
  UploadCompleteResponse,
  UploadCreateRequest,
  UploadCreateResponse,
  UploadListResponse,
  UploadPartUrlsRequest,
  UploadPartUrlsResponse,
  UploadReadResponse,
  UploadSessionId,
} from "@tashan/contracts";

import type { FileService } from "../files/file-service.js";
import type { UploadService } from "../files/upload-service.js";
import type { MutationCoordinator } from "../http/idempotency.js";
import { requestContext } from "../http/request-context.js";

const EntryPath = SpaceIdPath.extend({ entryId: FileEntryId }).strict();
const VersionPath = EntryPath.extend({ versionId: FileVersionId }).strict();
const UploadPath = SpaceIdPath.extend({ uploadSessionId: UploadSessionId }).strict();
const FolderPath = SpaceIdPath.extend({ folderId: FileEntryId }).strict();
const GrantPath = FolderPath.extend({ accountId: AccountId }).strict();

function identity(request: FastifyRequest) {
  const value = requestContext(request).identity;
  if (value === undefined) throw new Error("authenticated identity is missing");
  return value;
}

async function mutate<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  dependencies: { mutations: MutationCoordinator },
  capabilityId: CapabilityId,
  idempotencyInput: unknown,
  work: () => Promise<T>,
  statusCode = 200,
) {
  const actor = identity(request);
  const result = await dependencies.mutations.executeIdempotent({
    request,
    capabilityId,
    actorPrincipalId: actor.principalId,
    idempotencyInput,
    work: async () => ({ statusCode, body: await work() }),
  });
  return reply.code(result.statusCode).send(result.body);
}

export async function registerFileRoutes(
  app: FastifyInstance,
  dependencies: {
    files: FileService;
    uploads: UploadService;
    mutations: MutationCoordinator;
    authenticate: preHandlerHookHandler;
  },
): Promise<void> {
  const authenticated = { preHandler: dependencies.authenticate };
  app.get(
    "/v1/spaces/:spaceId/entries",
    { ...authenticated, config: { capabilityId: "file.list" } },
    async (request) => {
      const { spaceId } = SpaceIdPath.parse(request.params);
      const query = FileListQuery.parse(request.query);
      return FileListResponse.parse({
        items: await dependencies.files.list(
          identity(request).accountId,
          spaceId,
          query.parentId,
          query.includeTrash,
        ),
        nextCursor: null,
      });
    },
  );
  app.get(
    "/v1/spaces/:spaceId/entries/:entryId",
    { ...authenticated, config: { capabilityId: "file.read" } },
    async (request) => {
      const path = EntryPath.parse(request.params);
      return FileReadResponse.parse({
        entry: await dependencies.files.read(
          identity(request).accountId,
          path.spaceId,
          path.entryId,
        ),
      });
    },
  );
  app.get(
    "/v1/spaces/:spaceId/search",
    { ...authenticated, config: { capabilityId: "file.search" } },
    async (request) => {
      const { spaceId } = SpaceIdPath.parse(request.params);
      const query = FileSearchQuery.parse(request.query);
      return FileSearchResponse.parse({
        items: await dependencies.files.search(identity(request).accountId, spaceId, query.query),
        nextCursor: null,
      });
    },
  );
  app.post(
    "/v1/spaces/:spaceId/folders",
    { ...authenticated, config: { capabilityId: "file.folder.create" } },
    async (request, reply) => {
      const { spaceId } = SpaceIdPath.parse(request.params);
      const body = FolderCreateRequest.parse(request.body);
      const actor = identity(request);
      return mutate(
        request,
        reply,
        dependencies,
        "file.folder.create",
        { spaceId, ...body },
        async () =>
          FolderCreateResponse.parse({
            entry: await dependencies.files.createFolder(actor.accountId, spaceId, body),
          }),
        201,
      );
    },
  );
  app.post(
    "/v1/spaces/:spaceId/entries/:entryId/move",
    { ...authenticated, config: { capabilityId: "file.move" } },
    async (request, reply) => {
      const path = EntryPath.parse(request.params);
      const body = FileMoveRequest.parse(request.body);
      const actor = identity(request);
      return mutate(request, reply, dependencies, "file.move", { ...path, ...body }, async () =>
        FileMoveResponse.parse({
          entry: await dependencies.files.move(actor.accountId, path.spaceId, path.entryId, body),
        }),
      );
    },
  );
  app.post(
    "/v1/spaces/:spaceId/entries/:entryId/trash",
    { ...authenticated, config: { capabilityId: "file.trash" } },
    async (request, reply) => {
      const path = EntryPath.parse(request.params);
      const actor = identity(request);
      return mutate(request, reply, dependencies, "file.trash", path, async () => {
        const trashed = await dependencies.files.trash(actor.accountId, path.spaceId, path.entryId);
        return FileTrashResponse.parse({ entryId: path.entryId, expiresAt: trashed.expiresAt });
      });
    },
  );
  app.post(
    "/v1/spaces/:spaceId/entries/:entryId/restore",
    { ...authenticated, config: { capabilityId: "file.restore" } },
    async (request, reply) => {
      const path = EntryPath.parse(request.params);
      const body = FileRestoreRequest.parse(request.body);
      const actor = identity(request);
      return mutate(request, reply, dependencies, "file.restore", { ...path, ...body }, async () =>
        FileRestoreResponse.parse({
          entry: await dependencies.files.restore(
            actor.accountId,
            path.spaceId,
            path.entryId,
            body,
          ),
        }),
      );
    },
  );
  app.delete(
    "/v1/spaces/:spaceId/entries/:entryId",
    { ...authenticated, config: { capabilityId: "file.delete" } },
    async (request, reply) => {
      const path = EntryPath.parse(request.params);
      const actor = identity(request);
      return mutate(request, reply, dependencies, "file.delete", path, async () =>
        FileDeleteResponse.parse(
          await dependencies.files.deletePermanently(actor.accountId, path.spaceId, path.entryId),
        ),
      );
    },
  );
  app.post(
    "/v1/spaces/:spaceId/entries/:entryId/download",
    { ...authenticated, config: { capabilityId: "file.download.create" } },
    async (request, reply) => {
      const path = EntryPath.parse(request.params);
      const actor = identity(request);
      return mutate(request, reply, dependencies, "file.download.create", path, async () =>
        FileDownloadResponse.parse(
          await dependencies.files.createDownload(actor.accountId, path.spaceId, path.entryId),
        ),
      );
    },
  );
  app.get(
    "/v1/spaces/:spaceId/entries/:entryId/versions",
    { ...authenticated, config: { capabilityId: "file.version.list" } },
    async (request) => {
      const path = EntryPath.parse(request.params);
      return FileVersionListResponse.parse({
        items: await dependencies.files.versions(
          identity(request).accountId,
          path.spaceId,
          path.entryId,
        ),
      });
    },
  );
  app.post(
    "/v1/spaces/:spaceId/entries/:entryId/versions/:versionId/restore",
    { ...authenticated, config: { capabilityId: "file.version.restore" } },
    async (request, reply) => {
      const path = VersionPath.parse(request.params);
      const body = FileVersionRestoreRequest.parse(request.body);
      const actor = identity(request);
      return mutate(
        request,
        reply,
        dependencies,
        "file.version.restore",
        { ...path, ...body },
        async () =>
          FileVersionRestoreResponse.parse(
            await dependencies.files.restoreVersion(
              actor.accountId,
              path.spaceId,
              path.entryId,
              path.versionId,
              body.expectedVersion,
            ),
          ),
      );
    },
  );
  app.get(
    "/v1/spaces/:spaceId/uploads",
    { ...authenticated, config: { capabilityId: "file.upload.list" } },
    async (request) => {
      const { spaceId } = SpaceIdPath.parse(request.params);
      return UploadListResponse.parse({
        items: await dependencies.uploads.list(identity(request).accountId, spaceId),
      });
    },
  );
  app.post(
    "/v1/spaces/:spaceId/uploads",
    { ...authenticated, config: { capabilityId: "file.upload.create" } },
    async (request, reply) => {
      const { spaceId } = SpaceIdPath.parse(request.params);
      const body = UploadCreateRequest.parse(request.body);
      const actor = identity(request);
      return mutate(
        request,
        reply,
        dependencies,
        "file.upload.create",
        { spaceId, ...body },
        async () =>
          UploadCreateResponse.parse({
            uploadSession: await dependencies.uploads.create(
              actor.accountId,
              spaceId,
              body,
              request.headers["idempotency-key"] as string,
            ),
          }),
        201,
      );
    },
  );
  app.get(
    "/v1/spaces/:spaceId/uploads/:uploadSessionId",
    { ...authenticated, config: { capabilityId: "file.upload.read" } },
    async (request) => {
      const path = UploadPath.parse(request.params);
      return UploadReadResponse.parse(
        await dependencies.uploads.read(
          identity(request).accountId,
          path.spaceId,
          path.uploadSessionId,
        ),
      );
    },
  );
  app.post(
    "/v1/spaces/:spaceId/uploads/:uploadSessionId/parts",
    { ...authenticated, config: { capabilityId: "file.upload.parts.create" } },
    async (request, reply) => {
      const path = UploadPath.parse(request.params);
      const body = UploadPartUrlsRequest.parse(request.body);
      const actor = identity(request);
      return mutate(
        request,
        reply,
        dependencies,
        "file.upload.parts.create",
        { ...path, ...body },
        async () =>
          UploadPartUrlsResponse.parse(
            await dependencies.uploads.authorizeParts(
              actor.accountId,
              path.spaceId,
              path.uploadSessionId,
              body,
            ),
          ),
      );
    },
  );
  app.post(
    "/v1/spaces/:spaceId/uploads/:uploadSessionId/complete",
    { ...authenticated, config: { capabilityId: "file.upload.complete" } },
    async (request, reply) => {
      const path = UploadPath.parse(request.params);
      const body = UploadCompleteRequest.parse(request.body);
      const actor = identity(request);
      return mutate(
        request,
        reply,
        dependencies,
        "file.upload.complete",
        { ...path, ...body },
        async () =>
          UploadCompleteResponse.parse({
            uploadSession: await dependencies.uploads.complete(
              actor.accountId,
              path.spaceId,
              path.uploadSessionId,
              body,
            ),
          }),
      );
    },
  );
  app.post(
    "/v1/spaces/:spaceId/uploads/:uploadSessionId/cancel",
    { ...authenticated, config: { capabilityId: "file.upload.cancel" } },
    async (request, reply) => {
      const path = UploadPath.parse(request.params);
      const actor = identity(request);
      return mutate(request, reply, dependencies, "file.upload.cancel", path, async () =>
        UploadCancelResponse.parse(
          await dependencies.uploads.cancel(actor.accountId, path.spaceId, path.uploadSessionId),
        ),
      );
    },
  );
  app.get(
    "/v1/spaces/:spaceId/folders/:folderId/access",
    { ...authenticated, config: { capabilityId: "folder.access.read" } },
    async (request) => {
      const path = FolderPath.parse(request.params);
      return FolderAccessResponse.parse(
        await dependencies.files.access(identity(request).accountId, path.spaceId, path.folderId),
      );
    },
  );
  app.post(
    "/v1/spaces/:spaceId/folders/:folderId/access",
    { ...authenticated, config: { capabilityId: "folder.access.set" } },
    async (request, reply) => {
      const path = FolderPath.parse(request.params);
      const body = FolderAccessSetRequest.parse(request.body);
      const actor = identity(request);
      return mutate(
        request,
        reply,
        dependencies,
        "folder.access.set",
        { ...path, ...body },
        async () =>
          FolderAccessSetResponse.parse(
            await dependencies.files.setAccess(actor.accountId, path.spaceId, path.folderId, body),
          ),
      );
    },
  );
  app.post(
    "/v1/spaces/:spaceId/folders/:folderId/grants",
    { ...authenticated, config: { capabilityId: "folder.grant.set" } },
    async (request, reply) => {
      const path = FolderPath.parse(request.params);
      const body = FolderGrantSetRequest.parse(request.body);
      const actor = identity(request);
      return mutate(
        request,
        reply,
        dependencies,
        "folder.grant.set",
        { ...path, ...body },
        async () =>
          FolderGrantSetResponse.parse(
            await dependencies.files.setGrant(actor.accountId, path.spaceId, path.folderId, body),
          ),
      );
    },
  );
  app.delete(
    "/v1/spaces/:spaceId/folders/:folderId/grants/:accountId",
    { ...authenticated, config: { capabilityId: "folder.grant.revoke" } },
    async (request, reply) => {
      const path = GrantPath.parse(request.params);
      const actor = identity(request);
      return mutate(request, reply, dependencies, "folder.grant.revoke", path, async () =>
        FolderGrantRevokeResponse.parse(
          await dependencies.files.revokeGrant(
            actor.accountId,
            path.spaceId,
            path.folderId,
            path.accountId,
          ),
        ),
      );
    },
  );
  app.post(
    "/v1/spaces/:spaceId/folders/:folderId/manager-recovery",
    { ...authenticated, config: { capabilityId: "folder.manager.recover" } },
    async (request, reply) => {
      const path = FolderPath.parse(request.params);
      const body = FolderManagerRecoverRequest.parse(request.body);
      const actor = identity(request);
      return mutate(
        request,
        reply,
        dependencies,
        "folder.manager.recover",
        { ...path, ...body },
        async () =>
          FolderManagerRecoverResponse.parse(
            await dependencies.files.recoverManager(
              actor.accountId,
              path.spaceId,
              path.folderId,
              body,
            ),
          ),
      );
    },
  );
}
