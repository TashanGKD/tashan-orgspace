import { randomUUID } from "node:crypto";

import {
  UploadCompleteRequest,
  UploadCreateRequest,
  UploadPartUrlsRequest,
} from "@tashan/contracts";

import { temporaryObjectKey } from "@tashan/object-store";

import { AuthError } from "../auth/auth-errors.js";
import type { DatabaseClient } from "../db/client.js";
import { SpaceService } from "../spaces/space-service.js";
import { requireFilePermission } from "./file-authorization.js";

export interface MultipartPart {
  partNumber: number;
  etag: string;
  checksumSha256: string;
  sizeBytes: number;
}

export interface MultipartObjectStore {
  createMultipart(input: { key: string; contentType: string }): Promise<string>;
  presignPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }): Promise<string>;
  listParts(input: { key: string; uploadId: string }): Promise<readonly MultipartPart[]>;
  completeMultipart(input: {
    key: string;
    uploadId: string;
    parts: readonly MultipartPart[];
  }): Promise<void>;
  abortMultipart(input: { key: string; uploadId: string }): Promise<void>;
}

interface UploadRow {
  id: string;
  space_id: string;
  parent_id: string;
  target_file_id: string | null;
  file_name: string;
  content_type: string;
  expected_size_bytes: string;
  temporary_object_key: string;
  s3_upload_id: string | null;
  part_size_bytes: string;
  part_count: number;
  status: "created" | "uploading" | "verifying" | "completed" | "cancelled" | "expired" | "failed";
  expires_at: Date;
  created_at: Date;
  completed_version_id: string | null;
}

function publicRow(row: UploadRow) {
  return {
    id: row.id,
    spaceId: row.space_id,
    parentId: row.parent_id,
    ...(row.target_file_id === null ? {} : { targetFileId: row.target_file_id }),
    fileName: row.file_name,
    contentType: row.content_type,
    expectedSizeBytes: Number(row.expected_size_bytes),
    partSizeBytes: Number(row.part_size_bytes),
    partCount: row.part_count,
    status: row.status,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    ...(row.completed_version_id === null ? {} : { completedVersionId: row.completed_version_id }),
  };
}

function normalizedName(name: string): string {
  return name.normalize("NFC").toLocaleLowerCase("en-US");
}

function partSizeFor(size: number): number {
  const mib = 1024 * 1024;
  return Math.max(16 * mib, Math.ceil(Math.ceil(size / 10_000) / mib) * mib);
}

export class UploadService {
  private readonly spaces: SpaceService;
  public constructor(
    private readonly options: { sql: DatabaseClient; objectStore: MultipartObjectStore },
  ) {
    this.spaces = new SpaceService(options.sql);
  }

  private async row(id: string): Promise<UploadRow> {
    const [row] = await this.options.sql<UploadRow[]>`
      select * from upload_sessions where id = ${id}
    `;
    if (row === undefined) throw new AuthError("UPLOAD_NOT_FOUND", "upload session not found");
    return row;
  }

  public async list(accountId: string, spaceId: string) {
    const rows = await this.options.sql<UploadRow[]>`
      select * from upload_sessions where space_id = ${spaceId}
      order by created_at desc, id
    `;
    const visible: ReturnType<typeof publicRow>[] = [];
    for (const row of rows) {
      try {
        await this.options.sql.begin((transaction) =>
          requireFilePermission(transaction, {
            accountId,
            spaceId,
            entryId: row.parent_id,
            permission: "write",
          }),
        );
        visible.push(publicRow(row));
      } catch (error) {
        if (error instanceof AuthError && error.code === "FILE_FORBIDDEN") continue;
        throw error;
      }
    }
    return visible;
  }

  public async read(accountId: string, spaceId: string, uploadSessionId: string) {
    const row = await this.row(uploadSessionId);
    if (row.space_id !== spaceId)
      throw new AuthError("UPLOAD_NOT_FOUND", "upload session not found");
    await this.options.sql.begin((transaction) =>
      requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId: row.parent_id,
        permission: "write",
      }),
    );
    const uploadedParts =
      row.s3_upload_id === null || row.status !== "uploading"
        ? []
        : await this.options.objectStore.listParts({
            key: row.temporary_object_key,
            uploadId: row.s3_upload_id,
          });
    return { uploadSession: publicRow(row), uploadedParts };
  }

  public async cancel(accountId: string, spaceId: string, uploadSessionId: string) {
    const row = await this.row(uploadSessionId);
    if (row.space_id !== spaceId)
      throw new AuthError("UPLOAD_NOT_FOUND", "upload session not found");
    await this.options.sql.begin((transaction) =>
      requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId: row.parent_id,
        permission: "write",
      }),
    );
    if (row.status === "cancelled") return { uploadSessionId, cancelled: true as const };
    if (row.status !== "created" && row.status !== "uploading" && row.status !== "failed") {
      throw new AuthError("UPLOAD_INCOMPLETE", "upload session can no longer be cancelled");
    }
    if (row.s3_upload_id !== null) {
      await this.options.objectStore.abortMultipart({
        key: row.temporary_object_key,
        uploadId: row.s3_upload_id,
      });
    }
    await this.options.sql.begin(async (transaction) => {
      await transaction`
        update upload_sessions set status = 'cancelled', updated_at = now()
        where id = ${uploadSessionId} and status in ('created', 'uploading', 'failed')
      `;
      await this.spaces.releaseReservation(transaction, uploadSessionId);
    });
    return { uploadSessionId, cancelled: true as const };
  }

  public async create(
    accountId: string,
    spaceId: string,
    rawInput: unknown,
    idempotencyKey: string,
  ) {
    const input = UploadCreateRequest.parse(rawInput);
    const uploadSessionId = randomUUID();
    const objectKey = temporaryObjectKey(uploadSessionId);
    const partSize = partSizeFor(input.expectedSizeBytes);
    const partCount = Math.max(1, Math.ceil(input.expectedSizeBytes / partSize));

    await this.options.sql.begin(async (transaction) => {
      await requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId: input.parentId,
        permission: "write",
      });
      const [conflict] = await transaction<{ id: string }[]>`
        select id from file_entries
        where space_id = ${spaceId} and parent_id = ${input.parentId}
          and normalized_name = ${normalizedName(input.fileName)} and state = 'active'
        limit 1
      `;
      if (input.targetFileId === undefined && conflict !== undefined) {
        throw new AuthError("FILE_NAME_CONFLICT", "a file with this name already exists");
      }
      if (input.targetFileId !== undefined && conflict?.id !== input.targetFileId) {
        throw new AuthError("FILE_VERSION_CONFLICT", "version target does not match the file name");
      }
      await transaction`
        insert into upload_sessions (
          id, space_id, parent_id, target_file_id, created_by_account_id,
          file_name, normalized_name, content_type, expected_size_bytes,
          temporary_object_key, part_size_bytes, part_count, status, expires_at, idempotency_key
        ) values (
          ${uploadSessionId}, ${spaceId}, ${input.parentId}, ${input.targetFileId ?? null},
          ${accountId}, ${input.fileName}, ${normalizedName(input.fileName)}, ${input.contentType},
          ${input.expectedSizeBytes}, ${objectKey}, ${partSize}, ${partCount}, 'created',
          now() + interval '24 hours', ${idempotencyKey}
        )
      `;
      await this.spaces.reserve(
        { spaceId, uploadSessionId, bytes: input.expectedSizeBytes },
        transaction,
      );
    });

    let uploadId: string | undefined;
    try {
      uploadId = await this.options.objectStore.createMultipart({
        key: objectKey,
        contentType: input.contentType,
      });
      await this.options.sql`
        update upload_sessions set s3_upload_id = ${uploadId}, status = 'uploading', updated_at = now()
        where id = ${uploadSessionId} and status = 'created'
      `;
    } catch (error) {
      if (uploadId !== undefined) {
        await this.options.objectStore
          .abortMultipart({ key: objectKey, uploadId })
          .catch(() => undefined);
      }
      await this.options.sql.begin(async (transaction) => {
        await transaction`update upload_sessions set status = 'failed', updated_at = now() where id = ${uploadSessionId}`;
        await this.spaces.releaseReservation(transaction, uploadSessionId);
      });
      throw error;
    }
    return publicRow(await this.row(uploadSessionId));
  }

  public async authorizeParts(
    accountId: string,
    spaceId: string,
    uploadSessionId: string,
    raw: unknown,
  ) {
    const input = UploadPartUrlsRequest.parse(raw);
    const row = await this.row(uploadSessionId);
    if (row.space_id !== spaceId)
      throw new AuthError("UPLOAD_NOT_FOUND", "upload session not found");
    if (row.expires_at.getTime() <= Date.now())
      throw new AuthError("UPLOAD_EXPIRED", "upload session expired");
    if (row.status !== "uploading" || row.s3_upload_id === null) {
      throw new AuthError("UPLOAD_INCOMPLETE", "upload session is not accepting parts");
    }
    await this.options.sql.begin((transaction) =>
      requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId: row.parent_id,
        permission: "write",
      }),
    );
    if (input.partNumbers.some((partNumber) => partNumber > row.part_count)) {
      throw new AuthError("UPLOAD_INCOMPLETE", "upload part is outside the session range");
    }
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    return {
      items: await Promise.all(
        input.partNumbers.map(async (partNumber) => ({
          partNumber,
          url: await this.options.objectStore.presignPart({
            key: row.temporary_object_key,
            uploadId: row.s3_upload_id as string,
            partNumber,
            expiresInSeconds: 900,
          }),
          expiresAt,
        })),
      ),
    };
  }

  public async complete(accountId: string, spaceId: string, uploadSessionId: string, raw: unknown) {
    const input = UploadCompleteRequest.parse(raw);
    const row = await this.row(uploadSessionId);
    if (row.space_id !== spaceId)
      throw new AuthError("UPLOAD_NOT_FOUND", "upload session not found");
    if (row.status === "verifying" || row.status === "completed") return publicRow(row);
    if (row.status !== "uploading" || row.s3_upload_id === null) {
      throw new AuthError("UPLOAD_INCOMPLETE", "upload session cannot be completed");
    }
    await this.options.sql.begin((transaction) =>
      requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId: row.parent_id,
        permission: "write",
      }),
    );
    const stored = await this.options.objectStore.listParts({
      key: row.temporary_object_key,
      uploadId: row.s3_upload_id,
    });
    const requested = new Map(input.parts.map((part) => [part.partNumber, part]));
    const partsMatch =
      stored.length === input.parts.length &&
      stored.every((part) => {
        const candidate = requested.get(part.partNumber);
        return candidate?.etag === part.etag && candidate.checksumSha256 === part.checksumSha256;
      });
    const totalBytes = stored.reduce((sum, part) => sum + part.sizeBytes, 0);
    if (!partsMatch || totalBytes !== Number(row.expected_size_bytes)) {
      throw new AuthError("UPLOAD_INCOMPLETE", "uploaded parts do not match the session");
    }
    await this.options.objectStore.completeMultipart({
      key: row.temporary_object_key,
      uploadId: row.s3_upload_id,
      parts: stored,
    });
    await this.options.sql.begin(async (transaction) => {
      const updated = await transaction`
        update upload_sessions set status = 'verifying', expected_sha256 = ${input.expectedSha256},
          updated_at = now() where id = ${uploadSessionId} and status = 'uploading'
        returning id
      `;
      if (updated.length === 1) {
        await transaction`
          insert into file_maintenance_jobs (job_type, payload)
          values ('verify_upload', ${transaction.json({ uploadSessionId })})
        `;
      }
    });
    return publicRow(await this.row(uploadSessionId));
  }
}
