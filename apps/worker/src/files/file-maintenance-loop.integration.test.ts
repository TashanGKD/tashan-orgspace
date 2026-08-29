import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../../../api/src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../../api/src/db/migrate.js";
import { FileMaintenanceLoop, type FileMaintenanceObjectStore } from "./file-maintenance-loop.js";

const url = process.env.TEST_DATABASE_URL;
if (url === undefined) throw new Error("TEST_DATABASE_URL is required");
let sql: DatabaseClient;

class FakeStore implements FileMaintenanceObjectStore {
  public readonly objects = new Map<string, Uint8Array>();
  public readonly aborted: string[] = [];
  public failAbort = false;
  async *readObject(key: string) {
    const bytes = this.objects.get(key);
    if (bytes === undefined) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
    yield bytes;
  }
  async copyObject(source: string, target: string) {
    const bytes = this.objects.get(source);
    if (bytes === undefined) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
    this.objects.set(target, bytes);
  }
  async deleteObject(key: string) {
    this.objects.delete(key);
  }
  async abortMultipart(key: string, uploadId: string) {
    if (this.failAbort) throw new Error("abort failed");
    this.aborted.push(`${key}:${uploadId}`);
  }
  async headObject(key: string) {
    const value = this.objects.get(key);
    return value === undefined ? undefined : { sizeBytes: value.byteLength };
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

async function uploadFixture(bytes: Uint8Array, expectedSha256: string) {
  const [account] = await sql<{ id: string }[]>`
    insert into accounts (display_name, password_hash, phone_e164, phone_verified_at)
    values ('Owner', 'hash', '+8613800138401', now()) returning id
  `;
  if (account === undefined) throw new Error("account fixture failed");
  const spaceId = randomUUID();
  const rootId = randomUUID();
  const uploadId = randomUUID();
  await sql.begin(async (tx) => {
    await tx`insert into spaces (id, type, account_id, quota_bytes, reserved_bytes, root_folder_id)
      values (${spaceId}, 'personal', ${account.id}, 53687091200, ${bytes.byteLength}, ${rootId})`;
    await tx`insert into file_entries (id, space_id, kind, name, normalized_name, created_by_account_id)
      values (${rootId}, ${spaceId}, 'folder', '.root', '.root', ${account.id})`;
  });
  await sql`insert into upload_sessions (
    id, space_id, parent_id, created_by_account_id, file_name, normalized_name,
    content_type, expected_size_bytes, expected_sha256, temporary_object_key,
    s3_upload_id, part_size_bytes, part_count, status, expires_at, idempotency_key
  ) values (
    ${uploadId}, ${spaceId}, ${rootId}, ${account.id}, 'data.bin', 'data.bin',
    'application/octet-stream', ${bytes.byteLength}, ${expectedSha256}, ${`temporary/${uploadId}`},
    's3-upload', 16777216, 1, 'verifying', now() + interval '1 hour', 'verify-fixture'
  )`;
  await sql`insert into storage_reservations (space_id, upload_session_id, bytes, status)
    values (${spaceId}, ${uploadId}, ${bytes.byteLength}, 'reserved')`;
  const [job] = await sql<
    { id: string }[]
  >`insert into file_maintenance_jobs (job_type, payload, available_at)
    values ('verify_upload', ${sql.json({ uploadSessionId: uploadId })}, now() - interval '1 second') returning id`;
  if (job === undefined) throw new Error("job fixture failed");
  return {
    accountId: account.id,
    spaceId,
    rootId,
    uploadId,
    jobId: job.id,
    temporaryKey: `temporary/${uploadId}`,
  };
}

describe("file maintenance loop", () => {
  test("claims one job once across concurrent workers", async () => {
    const fixture = await uploadFixture(new Uint8Array([1]), "a".repeat(64));
    const store = new FakeStore();
    const [a, b] = await Promise.all([
      new FileMaintenanceLoop({ sql, objectStore: store, workerId: "worker-a" }).claimBatch(),
      new FileMaintenanceLoop({ sql, objectStore: store, workerId: "worker-b" }).claimBatch(),
    ]);
    expect([...a, ...b].map((job) => job.id)).toEqual([fixture.jobId]);
  });

  test("publishes a version only after canonical SHA-256 verification", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const fixture = await uploadFixture(bytes, checksum);
    const store = new FakeStore();
    store.objects.set(fixture.temporaryKey, bytes);
    const loop = new FileMaintenanceLoop({ sql, objectStore: store, workerId: "worker-a" });
    await expect(loop.processOnce()).resolves.toBe(1);
    const [session] = await sql<{ status: string; completed_version_id: string }[]>`
      select status, completed_version_id from upload_sessions where id = ${fixture.uploadId}
    `;
    expect(session?.status).toBe("completed");
    expect(store.objects.has(fixture.temporaryKey)).toBe(false);
    expect(store.objects.has(`versions/${session?.completed_version_id}`)).toBe(true);
    const [usage] = await sql<{ used_bytes: string; reserved_bytes: string }[]>`
      select used_bytes, reserved_bytes from spaces where id = ${fixture.spaceId}
    `;
    expect(usage).toEqual({ used_bytes: "4", reserved_bytes: "0" });
  });

  test("fails a checksum mismatch and releases reserved quota", async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const fixture = await uploadFixture(bytes, "a".repeat(64));
    const store = new FakeStore();
    store.objects.set(fixture.temporaryKey, bytes);
    const loop = new FileMaintenanceLoop({ sql, objectStore: store, workerId: "worker-a" });
    await loop.processOnce();
    const [session] = await sql<
      { status: string }[]
    >`select status from upload_sessions where id = ${fixture.uploadId}`;
    const [usage] = await sql<
      { reserved_bytes: string }[]
    >`select reserved_bytes from spaces where id = ${fixture.spaceId}`;
    expect(session?.status).toBe("failed");
    expect(usage?.reserved_bytes).toBe("0");
    expect(store.objects.has(fixture.temporaryKey)).toBe(false);
  });

  test("expires an unfinished upload by aborting multipart before releasing quota", async () => {
    const fixture = await uploadFixture(new Uint8Array([1, 2]), "a".repeat(64));
    await sql`delete from file_maintenance_jobs`;
    await sql`update upload_sessions set status = 'uploading', expires_at = now() - interval '1 minute' where id = ${fixture.uploadId}`;
    const store = new FakeStore();
    const loop = new FileMaintenanceLoop({ sql, objectStore: store, workerId: "worker-a" });
    await loop.processOnce();
    await loop.processOnce();
    const [session] = await sql<
      { status: string }[]
    >`select status from upload_sessions where id = ${fixture.uploadId}`;
    const [usage] = await sql<
      { reserved_bytes: string }[]
    >`select reserved_bytes from spaces where id = ${fixture.spaceId}`;
    expect(session?.status).toBe("expired");
    expect(usage?.reserved_bytes).toBe("0");
    expect(store.aborted).toEqual([`${fixture.temporaryKey}:s3-upload`]);
  });

  test("does not purge an entry restored before the purge handler runs", async () => {
    const fixture = await uploadFixture(new Uint8Array([1]), "a".repeat(64));
    await sql`delete from file_maintenance_jobs`;
    const entryId = randomUUID();
    const versionId = randomUUID();
    const objectKey = `versions/${versionId}`;
    await sql`insert into file_entries (
      id, space_id, parent_id, kind, name, normalized_name, created_by_account_id, state
    ) values (${entryId}, ${fixture.spaceId}, ${fixture.rootId}, 'file', 'kept.bin', 'kept.bin', ${fixture.accountId}, 'trash')`;
    await sql`insert into file_versions (
      id, file_entry_id, version_number, object_key, size_bytes, content_type,
      checksum_sha256, status, created_by_account_id
    ) values (${versionId}, ${entryId}, 1, ${objectKey}, 1, 'application/octet-stream', ${"b".repeat(64)}, 'available', ${fixture.accountId})`;
    await sql`update file_entries set current_version_id = ${versionId} where id = ${entryId}`;
    await sql`insert into trash_entries (
      entry_id, original_parent_id, deleted_by_account_id, expires_at, purge_status, purge_key
    ) values (${entryId}, ${fixture.rootId}, ${fixture.accountId}, now() - interval '1 day', 'processing', ${`trash:${entryId}`})`;
    await sql`insert into file_maintenance_jobs (job_type, payload, available_at)
      values ('purge_trash', ${sql.json({ entryId })}, now() - interval '1 second')`;
    await sql`delete from trash_entries where entry_id = ${entryId}`;
    await sql`update file_entries set state = 'active' where id = ${entryId}`;
    const store = new FakeStore();
    store.objects.set(objectKey, new Uint8Array([1]));
    await new FileMaintenanceLoop({ sql, objectStore: store, workerId: "worker-a" }).processOnce();
    expect(store.objects.has(objectKey)).toBe(true);
    const [entry] = await sql<
      { state: string }[]
    >`select state from file_entries where id = ${entryId}`;
    expect(entry?.state).toBe("active");
  });

  test("keeps quota reserved when multipart abort fails and retries later", async () => {
    const fixture = await uploadFixture(new Uint8Array([1, 2]), "a".repeat(64));
    await sql`delete from file_maintenance_jobs`;
    await sql`update upload_sessions set status = 'uploading', expires_at = now() - interval '1 minute' where id = ${fixture.uploadId}`;
    const store = new FakeStore();
    store.failAbort = true;
    const loop = new FileMaintenanceLoop({ sql, objectStore: store, workerId: "worker-a" });
    await loop.processOnce();
    await loop.processOnce();
    const [failedUsage] = await sql<{ reserved_bytes: string }[]>`
      select reserved_bytes from spaces where id = ${fixture.spaceId}
    `;
    expect(failedUsage?.reserved_bytes).toBe("2");
    store.failAbort = false;
    await sql`update file_maintenance_jobs set available_at = now() - interval '1 second' where status = 'pending'`;
    await loop.processOnce();
    const [session] = await sql<{ status: string }[]>`
      select status from upload_sessions where id = ${fixture.uploadId}
    `;
    expect(session?.status).toBe("expired");
  });
});
