import { describe, expect, test } from "vitest";

import { SafeByteCount } from "./common.js";
import {
  FileCapabilityId,
  FileDeleteResponse,
  FileVersionRestoreRequest,
  FileEntryKind,
  FileName,
  FolderAccessScope,
  FolderGrantRole,
  UploadCompleteRequest,
  UploadCreateResponse,
  UploadPartNumber,
  UploadReadResponse,
  UploadSessionStatus,
} from "./files.js";
import { SpaceType } from "./spaces.js";

describe("space and file primitive contracts", () => {
  test("accepts only non-negative safe byte counts", () => {
    expect(SafeByteCount.parse(0)).toBe(0);
    expect(SafeByteCount.parse(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(SafeByteCount.safeParse(value).success).toBe(false);
    }
  });

  test("rejects path-shaped, control and non-NFC file names", () => {
    for (const value of ["", ".", "..", "a/b", "a\\b", "nul\0name", "line\nname", "e\u0301"]) {
      expect(FileName.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
    expect(FileName.parse("项目资料.pdf")).toBe("项目资料.pdf");
  });

  test("freezes file enums and the complete Phase 1 capability set", () => {
    expect(SpaceType.options).toEqual(["personal", "organization"]);
    expect(FileEntryKind.options).toEqual(["file", "folder"]);
    expect(FolderAccessScope.options).toEqual(["organization_public", "restricted"]);
    expect(FolderGrantRole.options).toEqual(["manager", "editor", "viewer"]);
    expect(UploadSessionStatus.options).toEqual([
      "created",
      "uploading",
      "verifying",
      "completed",
      "cancelled",
      "expired",
      "failed",
    ]);
    expect(FileCapabilityId.options).toHaveLength(26);
  });

  test("accepts only S3 part numbers and rejects duplicate completion parts", () => {
    expect(UploadPartNumber.parse(1)).toBe(1);
    expect(UploadPartNumber.parse(10_000)).toBe(10_000);
    expect(UploadPartNumber.safeParse(0).success).toBe(false);
    expect(UploadPartNumber.safeParse(10_001).success).toBe(false);

    const base = {
      parts: [
        { partNumber: 1, etag: '"etag-1"', checksumSha256: "YWJjZA==" },
        { partNumber: 2, etag: '"etag-2"', checksumSha256: "ZWZnaA==" },
      ],
      expectedSha256: "a".repeat(64),
    };
    expect(UploadCompleteRequest.parse(base).parts).toHaveLength(2);
    expect(
      UploadCompleteRequest.safeParse({ ...base, parts: [base.parts[0], base.parts[0]] }).success,
    ).toBe(false);
  });

  test("keeps S3 credentials out of upload creation responses", () => {
    const response = {
      uploadSession: {
        id: "746fb70b-a27e-4a78-a231-aa55ef8c343e",
        spaceId: "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
        parentId: "84ecfe2e-c11a-4a56-8735-934955bef834",
        fileName: "data.bin",
        contentType: "application/octet-stream",
        expectedSizeBytes: 1024,
        partSizeBytes: 16 * 1024 * 1024,
        partCount: 1,
        status: "created",
        expiresAt: "2026-08-29T01:00:00.000Z",
        createdAt: "2026-08-29T00:00:00.000Z",
      },
    };
    expect(UploadCreateResponse.parse(response)).toEqual(response);
    expect(
      UploadCreateResponse.safeParse({ ...response, accessKeyId: "must-not-leak" }).success,
    ).toBe(false);
  });

  test("exposes server-confirmed parts when reading a resumable upload", () => {
    const uploadSession = {
      id: "746fb70b-a27e-4a78-a231-aa55ef8c343e",
      spaceId: "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
      parentId: "84ecfe2e-c11a-4a56-8735-934955bef834",
      fileName: "data.bin",
      contentType: "application/octet-stream",
      expectedSizeBytes: 3,
      partSizeBytes: 2,
      partCount: 2,
      status: "uploading",
      expiresAt: "2026-08-29T01:00:00.000Z",
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    expect(
      UploadReadResponse.parse({
        uploadSession,
        uploadedParts: [
          { partNumber: 1, etag: '"etag-1"', checksumSha256: "YWJjZA==", sizeBytes: 2 },
        ],
      }).uploadedParts,
    ).toHaveLength(1);
  });

  test("reports permanent deletion as queued until the worker finishes it", () => {
    expect(
      FileDeleteResponse.parse({
        entryId: "b228e557-2214-4f95-b49d-d4ff7d9759d4",
        queued: true,
      }),
    ).toEqual({ entryId: "b228e557-2214-4f95-b49d-d4ff7d9759d4", queued: true });
  });

  test("requires optimistic concurrency for version restore", () => {
    expect(FileVersionRestoreRequest.parse({ expectedVersion: 2 })).toEqual({
      expectedVersion: 2,
    });
    expect(FileVersionRestoreRequest.safeParse({}).success).toBe(false);
  });
});
