import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import type { OrgSpaceClient } from "@tashan/sdk";
import type { FileByteTransport } from "@tashan/sdk/file-transfer";

import { MemoryCredentialStore } from "../credentials/memory-store.js";
import { runCli } from "../program.js";

const spaceId = "35f503c2-a5d7-4250-a337-4f4fd03cf8df";
const parentId = "84ecfe2e-c11a-4a56-8735-934955bef834";
const uploadId = "746fb70b-a27e-4a78-a231-aa55ef8c343e";
const entryId = "b228e557-2214-4f95-b49d-d4ff7d9759d4";
const versionId = "cc3953dd-f74b-4f9e-ae01-3e5243e5fd21";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

function dependencies(client: OrgSpaceClient, fileByteTransport: FileByteTransport) {
  return {
    createClient: vi.fn(() => client),
    credentialStore: new MemoryCredentialStore(),
    deviceId: "3c5442ea-00e2-483b-9e81-2271e34120f1",
    environment: {},
    fileByteTransport,
  };
}

describe("file CLI", () => {
  test.each(["file", "space", "folder", "upload"])(
    "%s group without an operation prints help without initializing credentials",
    async (group) => {
      const createClient = vi.fn();
      const result = await runCli([group], { createClient, environment: {} });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Usage:");
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  test("uploads missing parts with retry and completes from server-confirmed state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "torg-upload-"));
    cleanups.push(() => rm(directory, { recursive: true }));
    const path = join(directory, "data.bin");
    await writeFile(path, Buffer.from("abc"));
    const client = {
      createUpload: vi.fn().mockResolvedValue({
        uploadSession: {
          id: uploadId,
          spaceId,
          parentId,
          fileName: "data.bin",
          expectedSizeBytes: 3,
          partSizeBytes: 2,
          partCount: 2,
          status: "uploading",
          expiresAt: "2026-08-30T00:00:00.000Z",
          createdAt: "2026-08-29T00:00:00.000Z",
        },
      }),
      readUpload: vi.fn().mockResolvedValue({
        uploadSession: { id: uploadId, partSizeBytes: 2, partCount: 2, expectedSizeBytes: 3 },
        uploadedParts: [
          {
            partNumber: 1,
            etag: '"etag-1"',
            checksumSha256: "+44g/C5MPySMYMOb1lLzwTRymLuXe4tNWQO4UFViBgM=",
            sizeBytes: 2,
          },
        ],
      }),
      createUploadPartUrls: vi.fn().mockResolvedValue({
        items: [
          {
            partNumber: 2,
            url: "https://files.example/part-2",
            expiresAt: "2026-08-30T00:00:00.000Z",
          },
        ],
      }),
      completeUpload: vi
        .fn()
        .mockResolvedValue({ uploadSession: { id: uploadId, status: "verifying" } }),
    } as unknown as OrgSpaceClient;
    const uploadPart = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValue({ etag: '"etag-2"' });
    const transfer = { uploadPart, download: vi.fn() } satisfies FileByteTransport;
    const result = await runCli(
      [
        "file",
        "upload",
        path,
        "--space",
        spaceId,
        "--parent",
        parentId,
        "--idempotency-key",
        "upload-1",
      ],
      dependencies(client, transfer),
    );
    expect(result.exitCode).toBe(0);
    expect(uploadPart).toHaveBeenCalledTimes(2);
    expect(client.createUploadPartUrls).toHaveBeenCalledWith(
      spaceId,
      uploadId,
      { partNumbers: [2] },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(client.completeUpload).toHaveBeenCalledOnce();
  });

  test("downloads through the byte transport and requires confirmation for permanent deletion", async () => {
    const client = {
      createFileDownload: vi.fn().mockResolvedValue({
        url: "https://files.example/object",
        expiresAt: "2026-08-30T00:00:00.000Z",
        checksumSha256: "a".repeat(64),
        fileName: "report.pdf",
      }),
      deleteFile: vi.fn(),
    } as unknown as OrgSpaceClient;
    const transfer = { uploadPart: vi.fn(), download: vi.fn() } satisfies FileByteTransport;
    const effects = dependencies(client, transfer);
    const downloaded = await runCli(
      [
        "file",
        "download",
        "--space",
        spaceId,
        "--file",
        entryId,
        "--output",
        "/tmp/report.pdf",
        "--idempotency-key",
        "download-1",
      ],
      effects,
    );
    expect(downloaded.exitCode).toBe(0);
    expect(transfer.download).toHaveBeenCalledWith(
      expect.objectContaining({ destination: "/tmp/report.pdf" }),
    );

    const refused = await runCli(
      ["file", "delete", "--space", spaceId, "--file", entryId, "--idempotency-key", "delete-1"],
      effects,
    );
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain("--yes");
    expect(client.deleteFile).not.toHaveBeenCalled();
  });

  test("restores a file version without colliding with the global version flag", async () => {
    const client = {
      restoreFileVersion: vi.fn().mockResolvedValue({
        entry: { id: entryId },
        version: { id: versionId },
      }),
    } as unknown as OrgSpaceClient;
    const transfer = { uploadPart: vi.fn(), download: vi.fn() } satisfies FileByteTransport;
    const result = await runCli(
      [
        "file",
        "version-restore",
        "--space",
        spaceId,
        "--file",
        entryId,
        "--version-id",
        versionId,
        "--expected-version",
        "3",
        "--yes",
        "--idempotency-key",
        "version-restore-1",
        "--json",
      ],
      dependencies(client, transfer),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("0.1.0-alpha.3");
    expect(client.restoreFileVersion).toHaveBeenCalledWith(
      spaceId,
      entryId,
      versionId,
      { expectedVersion: 3 },
      { idempotencyKey: "version-restore-1" },
    );
  });
});
