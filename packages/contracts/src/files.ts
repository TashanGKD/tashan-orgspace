import { z } from "zod";

import {
  AccountId,
  FileEntryId,
  FileVersionId,
  IsoDateTime,
  SafeByteCount,
  SpaceId,
  UploadSessionId,
} from "./common.js";

export const FileCapabilityId = z.enum([
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
export type FileCapabilityId = z.infer<typeof FileCapabilityId>;

export const FileEntryKind = z.enum(["file", "folder"]);
export const FileEntryState = z.enum(["active", "trash"]);
export const FolderAccessScope = z.enum(["organization_public", "restricted"]);
export const FolderGrantRole = z.enum(["manager", "editor", "viewer"]);
export const UploadSessionStatus = z.enum([
  "created",
  "uploading",
  "verifying",
  "completed",
  "cancelled",
  "expired",
  "failed",
]);
export const FileVersionStatus = z.enum(["verifying", "available", "corrupt"]);

export const FileName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .superRefine((value, context) => {
    const hasControlCharacter = [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    });
    if (
      value === "." ||
      value === ".." ||
      value.includes("/") ||
      value.includes("\\") ||
      hasControlCharacter ||
      value !== value.normalize("NFC")
    ) {
      context.addIssue({ code: "custom", message: "invalid file name" });
    }
  });

const Sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
const Etag = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !/[\r\n\0]/.test(value));
const ChecksumBase64 = z
  .string()
  .min(4)
  .max(128)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const FileEntrySummary = z
  .object({
    id: FileEntryId,
    spaceId: SpaceId,
    parentId: FileEntryId.nullable(),
    kind: FileEntryKind,
    name: FileName,
    state: FileEntryState,
    createdByAccountId: AccountId,
    currentVersionId: FileVersionId.nullable(),
    sizeBytes: SafeByteCount,
    contentType: z.string().min(1).max(255).nullable(),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .strict();
export type FileEntrySummary = z.infer<typeof FileEntrySummary>;

export const FileEntryDetail = FileEntrySummary.extend({
  inheritedFromFolderId: FileEntryId,
  effectiveRole: FolderGrantRole.nullable(),
  checksumSha256: Sha256Hex.nullable(),
}).strict();

export const FileVersionSummary = z
  .object({
    id: FileVersionId,
    fileEntryId: FileEntryId,
    versionNumber: z.number().int().min(1),
    sizeBytes: SafeByteCount,
    contentType: z.string().min(1).max(255),
    checksumSha256: Sha256Hex,
    status: FileVersionStatus,
    createdByAccountId: AccountId,
    createdAt: IsoDateTime,
  })
  .strict();

const PageQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const FileListQuery = PageQuery.extend({
  parentId: FileEntryId,
  includeTrash: z.coerce.boolean().default(false),
}).strict();
export const FileSearchQuery = PageQuery.extend({
  query: z.string().trim().min(1).max(200),
}).strict();
export const FileListResponse = z
  .object({ items: z.array(FileEntrySummary), nextCursor: z.string().nullable() })
  .strict();
export const FileSearchResponse = FileListResponse;
export const FileReadResponse = z.object({ entry: FileEntryDetail }).strict();

export const FolderCreateRequest = z
  .object({
    parentId: FileEntryId,
    name: FileName,
    accessScope: FolderAccessScope,
    grants: z
      .array(z.object({ accountId: AccountId, role: FolderGrantRole }).strict())
      .max(500)
      .default([]),
  })
  .strict();
export const FolderCreateResponse = z.object({ entry: FileEntryDetail }).strict();
export const FileMoveRequest = z
  .object({
    targetParentId: FileEntryId,
    name: FileName.optional(),
    expectedVersion: z.number().int().min(1),
  })
  .strict();
export const FileMoveResponse = z.object({ entry: FileEntryDetail }).strict();
export const FileTrashResponse = z
  .object({ entryId: FileEntryId, expiresAt: IsoDateTime })
  .strict();
export const FileRestoreRequest = z
  .object({
    parentId: FileEntryId.optional(),
    name: FileName.optional(),
    expectedVersion: z.number().int().min(1),
  })
  .strict();
export const FileRestoreResponse = z.object({ entry: FileEntryDetail }).strict();
export const FileDeleteResponse = z
  .object({ entryId: FileEntryId, deleted: z.literal(true) })
  .strict();
export const FileDownloadResponse = z
  .object({ url: z.url(), expiresAt: IsoDateTime, checksumSha256: Sha256Hex, fileName: FileName })
  .strict();
export const FileVersionListResponse = z.object({ items: z.array(FileVersionSummary) }).strict();
export const FileVersionRestoreResponse = z
  .object({ entry: FileEntryDetail, version: FileVersionSummary })
  .strict();

export const UploadPartNumber = z.number().int().min(1).max(10_000);
const UploadSessionSummary = z
  .object({
    id: UploadSessionId,
    spaceId: SpaceId,
    parentId: FileEntryId,
    targetFileId: FileEntryId.optional(),
    fileName: FileName,
    expectedSizeBytes: SafeByteCount,
    partSizeBytes: SafeByteCount,
    partCount: z.number().int().min(1).max(10_000),
    status: UploadSessionStatus,
    expiresAt: IsoDateTime,
    createdAt: IsoDateTime,
    completedVersionId: FileVersionId.optional(),
  })
  .strict();

export const UploadCreateRequest = z
  .object({
    parentId: FileEntryId,
    targetFileId: FileEntryId.optional(),
    fileName: FileName,
    expectedSizeBytes: SafeByteCount,
    contentType: z.string().trim().min(1).max(255),
  })
  .strict();
export const UploadCreateResponse = z.object({ uploadSession: UploadSessionSummary }).strict();
export const UploadReadResponse = UploadCreateResponse;
export const UploadListResponse = z.object({ items: z.array(UploadSessionSummary) }).strict();
export const UploadPartUrlsRequest = z
  .object({ partNumbers: z.array(UploadPartNumber).min(1).max(100) })
  .strict()
  .refine((value) => new Set(value.partNumbers).size === value.partNumbers.length, {
    message: "duplicate upload part number",
  });
export const UploadPartUrlsResponse = z
  .object({
    items: z.array(
      z.object({ partNumber: UploadPartNumber, url: z.url(), expiresAt: IsoDateTime }).strict(),
    ),
  })
  .strict();
const CompletedPart = z
  .object({ partNumber: UploadPartNumber, etag: Etag, checksumSha256: ChecksumBase64 })
  .strict();
export const UploadCompleteRequest = z
  .object({ parts: z.array(CompletedPart).min(1).max(10_000), expectedSha256: Sha256Hex })
  .strict()
  .refine(
    (value) => new Set(value.parts.map((part) => part.partNumber)).size === value.parts.length,
    { message: "duplicate completed part number" },
  );
export const UploadCompleteResponse = UploadCreateResponse;
export const UploadCancelResponse = z
  .object({ uploadSessionId: UploadSessionId, cancelled: z.literal(true) })
  .strict();

const FolderGrant = z.object({ accountId: AccountId, role: FolderGrantRole }).strict();
export const FolderAccessResponse = z
  .object({
    folderId: FileEntryId,
    scope: FolderAccessScope,
    grants: z.array(FolderGrant),
    inheritedFromFolderId: FileEntryId,
  })
  .strict();
export const FolderAccessSetRequest = z
  .object({ scope: FolderAccessScope, expectedVersion: z.number().int().min(1) })
  .strict();
export const FolderAccessSetResponse = FolderAccessResponse;
export const FolderGrantSetRequest = z
  .object({ accountId: AccountId, role: FolderGrantRole, expectedVersion: z.number().int().min(1) })
  .strict();
export const FolderGrantSetResponse = FolderAccessResponse;
export const FolderGrantRevokeResponse = FolderAccessResponse;
export const FolderManagerRecoverRequest = z
  .object({
    accountId: AccountId,
    reason: z.string().trim().min(1).max(1000),
    expectedVersion: z.number().int().min(1),
  })
  .strict();
export const FolderManagerRecoverResponse = FolderAccessResponse;
