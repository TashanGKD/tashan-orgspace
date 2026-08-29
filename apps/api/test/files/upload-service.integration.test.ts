import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import type { DatabaseClient } from "../../src/db/client.js";
import { createDatabaseClient } from "../../src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../src/db/migrate.js";
import { UploadService, type MultipartObjectStore } from "../../src/files/upload-service.js";
import { createPersonalSpace } from "../../src/spaces/space-bootstrap.js";

const url = process.env.TEST_DATABASE_URL;
if (url === undefined) throw new Error("TEST_DATABASE_URL is required");
let sql: DatabaseClient;

class FakeStore implements MultipartObjectStore {
  public failCreate = false;
  public readonly aborted: string[] = [];
  public readonly completed: string[] = [];
  public parts = [{ partNumber: 1, etag: '"etag-1"', checksumSha256: "YWJjZA==", sizeBytes: 5 }];
  async createMultipart(): Promise<string> {
    if (this.failCreate) throw new Error("fixture S3 create failure");
    return "opaque-upload-id";
  }
  async presignPart(input: { partNumber: number }): Promise<string> {
    return `https://files.orgspace.test/part/${input.partNumber}`;
  }
  async listParts() {
    return this.parts;
  }
  async completeMultipart(input: { uploadId: string }): Promise<void> {
    this.completed.push(input.uploadId);
  }
  async abortMultipart(input: { uploadId: string }): Promise<void> {
    this.aborted.push(input.uploadId);
  }
}

beforeAll(async () => {
  await resetTestDatabase(url);
  await migrateDatabase(url);
  sql = createDatabaseClient(url);
}, 30_000);
beforeEach(async () => {
  await sql`truncate table audit_events, session_refresh_tokens, sessions, devices, memberships, organizations, phone_verifications, principals, accounts cascade`;
});
afterAll(async () => sql?.end());

async function fixture() {
  const [owner] = await sql<{ id: string }[]>`
    insert into accounts (display_name, password_hash, phone_e164, phone_verified_at)
    values ('Owner', 'hash', '+8613800138601', now()) returning id
  `;
  if (owner === undefined) throw new Error("owner fixture failed");
  const space = await sql.begin((transaction) => createPersonalSpace(transaction, owner.id));
  return { owner, space };
}

describe("upload service", () => {
  test("creates an opaque session and bounded part URLs", async () => {
    const { owner, space } = await fixture();
    const store = new FakeStore();
    const service = new UploadService({ sql, objectStore: store });
    const created = await service.create(
      owner.id,
      space.id,
      {
        parentId: space.rootFolderId,
        fileName: "data.bin",
        expectedSizeBytes: 5,
        contentType: "application/octet-stream",
      },
      "upload-create-1",
    );
    expect(created).not.toHaveProperty("temporaryObjectKey");
    expect(created).not.toHaveProperty("s3UploadId");
    await expect(
      service.authorizeParts(owner.id, space.id, created.id, { partNumbers: [0] }),
    ).rejects.toBeDefined();
    await expect(
      service.authorizeParts(owner.id, space.id, created.id, { partNumbers: [1, 1] }),
    ).rejects.toBeDefined();
    await expect(
      service.authorizeParts(owner.id, space.id, created.id, { partNumbers: [1] }),
    ).resolves.toMatchObject({ items: [{ partNumber: 1 }] });
  });

  test("releases a reservation when S3 creation fails", async () => {
    const { owner, space } = await fixture();
    const store = new FakeStore();
    store.failCreate = true;
    const service = new UploadService({ sql, objectStore: store });
    await expect(
      service.create(
        owner.id,
        space.id,
        {
          parentId: space.rootFolderId,
          fileName: "failed.bin",
          expectedSizeBytes: 5,
          contentType: "application/octet-stream",
        },
        "upload-fail-1",
      ),
    ).rejects.toThrow(/fixture S3 create failure/);
    const [usage] = await sql<
      { reserved_bytes: string }[]
    >`select reserved_bytes from spaces where id = ${space.id}`;
    expect(usage?.reserved_bytes).toBe("0");
  });

  test("rejects S3 part mismatches and queues valid verification once", async () => {
    const { owner, space } = await fixture();
    const store = new FakeStore();
    const service = new UploadService({ sql, objectStore: store });
    const created = await service.create(
      owner.id,
      space.id,
      {
        parentId: space.rootFolderId,
        fileName: "complete.bin",
        expectedSizeBytes: 5,
        contentType: "application/octet-stream",
      },
      "upload-complete-1",
    );
    await expect(
      service.complete(owner.id, space.id, created.id, {
        parts: [{ partNumber: 1, etag: '"wrong"', checksumSha256: "YWJjZA==" }],
        expectedSha256: "a".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_INCOMPLETE" });
    const completed = await service.complete(owner.id, space.id, created.id, {
      parts: [{ partNumber: 1, etag: '"etag-1"', checksumSha256: "YWJjZA==" }],
      expectedSha256: "a".repeat(64),
    });
    await expect(
      service.complete(owner.id, space.id, created.id, {
        parts: [{ partNumber: 1, etag: '"etag-1"', checksumSha256: "YWJjZA==" }],
        expectedSha256: "a".repeat(64),
      }),
    ).resolves.toMatchObject({ id: completed.id, status: "verifying" });
    const [jobs] = await sql<{ count: number }[]>`
      select count(*)::int as count from file_maintenance_jobs
      where job_type = 'verify_upload' and payload->>'uploadSessionId' = ${created.id}
    `;
    expect(jobs?.count).toBe(1);
  });

  test("reads server-confirmed parts and cancels with reservation cleanup", async () => {
    const { owner, space } = await fixture();
    const store = new FakeStore();
    const service = new UploadService({ sql, objectStore: store });
    const created = await service.create(
      owner.id,
      space.id,
      {
        parentId: space.rootFolderId,
        fileName: "resume.bin",
        expectedSizeBytes: 5,
        contentType: "application/octet-stream",
      },
      "upload-resume-1",
    );

    await expect(service.list(owner.id, space.id)).resolves.toHaveLength(1);
    await expect(service.read(owner.id, space.id, created.id)).resolves.toMatchObject({
      uploadSession: { id: created.id },
      uploadedParts: [{ partNumber: 1, etag: '"etag-1"' }],
    });
    await expect(service.cancel(owner.id, space.id, created.id)).resolves.toEqual({
      uploadSessionId: created.id,
      cancelled: true,
    });
    expect(store.aborted).toEqual(["opaque-upload-id"]);
    const [usage] = await sql<
      { reserved_bytes: string }[]
    >`select reserved_bytes from spaces where id = ${space.id}`;
    expect(usage?.reserved_bytes).toBe("0");
  });
});
