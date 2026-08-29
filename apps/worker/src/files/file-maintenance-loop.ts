import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { sha256Stream, versionObjectKey } from "@tashan/object-store";

type DatabaseClient = ReturnType<typeof postgres>;

export interface FileMaintenanceObjectStore {
  readObject(key: string): AsyncIterable<Uint8Array>;
  copyObject(source: string, target: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  headObject(key: string): Promise<{ sizeBytes: number } | undefined>;
}

interface JobRow {
  id: string;
  job_type: "verify_upload" | "expire_upload" | "purge_trash" | "reconcile_version";
  payload: Record<string, unknown>;
  attempts: number;
  lease_owner: string;
  lease_expires_at: Date;
}

export interface FileMaintenanceJob {
  id: string;
  jobType: JobRow["job_type"];
  payload: Record<string, unknown>;
  attempts: number;
}

export class FileMaintenanceLoop {
  private readonly leaseMilliseconds: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly pollMilliseconds: number;
  private stopping = false;

  public constructor(
    private readonly options: {
      sql: DatabaseClient;
      objectStore: FileMaintenanceObjectStore;
      workerId: string;
      clock?: () => Date;
      leaseMilliseconds?: number;
      batchSize?: number;
      maxAttempts?: number;
      pollMilliseconds?: number;
    },
  ) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(options.workerId)) {
      throw new Error("worker ID is invalid");
    }
    this.leaseMilliseconds = options.leaseMilliseconds ?? 60_000;
    this.batchSize = options.batchSize ?? 10;
    this.maxAttempts = options.maxAttempts ?? 10;
    this.pollMilliseconds = options.pollMilliseconds ?? 500;
  }

  private now(): Date {
    return this.options.clock?.() ?? new Date();
  }

  public async claimBatch(): Promise<FileMaintenanceJob[]> {
    const now = this.now();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseMilliseconds);
    const rows = await this.options.sql<JobRow[]>`
      with candidates as (
        select id from file_maintenance_jobs
        where available_at <= ${now}
          and (status = 'pending' or (status = 'processing' and lease_expires_at <= ${now}))
        order by available_at, created_at, id
        for update skip locked limit ${this.batchSize}
      )
      update file_maintenance_jobs jobs set status = 'processing', attempts = jobs.attempts + 1,
        lease_owner = ${this.options.workerId}, lease_expires_at = ${leaseExpiresAt}, updated_at = ${now}
      from candidates where jobs.id = candidates.id
      returning jobs.id, jobs.job_type, jobs.payload, jobs.attempts,
        jobs.lease_owner, jobs.lease_expires_at
    `;
    return rows.map((row) => ({
      id: row.id,
      jobType: row.job_type,
      payload: row.payload,
      attempts: row.attempts,
    }));
  }

  public async processOnce(): Promise<number> {
    if (this.stopping) return 0;
    await this.enqueueDueJobs();
    const jobs = await this.claimBatch();
    for (const job of jobs) await this.dispatch(job);
    return jobs.length;
  }

  public async run(): Promise<void> {
    while (!this.stopping) {
      const processed = await this.processOnce();
      if (processed === 0 && !this.stopping) {
        await new Promise((resolve) => setTimeout(resolve, this.pollMilliseconds));
      }
    }
  }

  public async stop(): Promise<void> {
    this.stopping = true;
    await this.options.sql`
      update file_maintenance_jobs set status = 'pending', lease_owner = null,
        lease_expires_at = null, updated_at = ${this.now()}
      where status = 'processing' and lease_owner = ${this.options.workerId}
    `;
  }

  private async dispatch(job: FileMaintenanceJob): Promise<void> {
    try {
      if (job.jobType === "verify_upload") await this.verifyUpload(job.payload);
      else if (job.jobType === "expire_upload") await this.expireUpload(job.payload);
      else if (job.jobType === "purge_trash") await this.purgeTrash(job.payload);
      else await this.reconcileVersion(job.payload);
      await this.finish(job.id, "done", null);
    } catch (error) {
      const reason = `HANDLER_FAILED:${error instanceof Error ? error.name : "UnknownError"}`;
      if (job.attempts >= this.maxAttempts) await this.finish(job.id, "dead_letter", reason);
      else {
        const retryAt = new Date(this.now().getTime() + Math.min(60_000, 1000 * 2 ** job.attempts));
        await this.options.sql`
          update file_maintenance_jobs set status = 'pending', available_at = ${retryAt},
            lease_owner = null, lease_expires_at = null, last_error = ${reason}, updated_at = ${this.now()}
          where id = ${job.id} and lease_owner = ${this.options.workerId}
        `;
      }
    }
  }

  private async finish(id: string, status: "done" | "dead_letter", error: string | null) {
    await this.options.sql`
      update file_maintenance_jobs set status = ${status}, lease_owner = null,
        lease_expires_at = null, last_error = ${error}, updated_at = ${this.now()}
      where id = ${id} and lease_owner = ${this.options.workerId}
    `;
  }

  private payloadId(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    if (typeof value !== "string" || !/^[0-9a-f-]{36}$/.test(value)) {
      throw new Error(`invalid ${key}`);
    }
    return value;
  }

  private async verifyUpload(payload: Record<string, unknown>) {
    const uploadSessionId = this.payloadId(payload, "uploadSessionId");
    const [session] = await this.options.sql<
      {
        id: string;
        space_id: string;
        parent_id: string;
        target_file_id: string | null;
        created_by_account_id: string;
        file_name: string;
        normalized_name: string;
        content_type: string;
        expected_size_bytes: string;
        expected_sha256: string | null;
        temporary_object_key: string;
        status: string;
      }[]
    >`select * from upload_sessions where id = ${uploadSessionId}`;
    if (session === undefined || session.status === "completed" || session.status === "failed")
      return;
    if (session.status !== "verifying" || session.expected_sha256 === null) {
      throw new Error("upload is not ready for verification");
    }
    const checksum = await sha256Stream(
      this.options.objectStore.readObject(session.temporary_object_key),
    );
    const head = await this.options.objectStore.headObject(session.temporary_object_key);
    if (
      checksum !== session.expected_sha256 ||
      head?.sizeBytes !== Number(session.expected_size_bytes)
    ) {
      await this.options.objectStore.deleteObject(session.temporary_object_key);
      await this.options.sql.begin(async (tx) => {
        await tx`update upload_sessions set status = 'failed', updated_at = now() where id = ${session.id}`;
        await tx`
          update spaces set reserved_bytes = reserved_bytes - reservation.bytes, updated_at = now()
          from storage_reservations reservation
          where reservation.upload_session_id = ${session.id} and reservation.status = 'reserved'
            and spaces.id = reservation.space_id
        `;
        await tx`update storage_reservations set status = 'released', updated_at = now()
          where upload_session_id = ${session.id} and status = 'reserved'`;
      });
      return;
    }

    const versionId = randomUUID();
    const destination = versionObjectKey(versionId);
    await this.options.objectStore.copyObject(session.temporary_object_key, destination);
    try {
      await this.options.sql.begin(async (tx) => {
        const fileEntryId = session.target_file_id ?? randomUUID();
        if (session.target_file_id === null) {
          await tx`
            insert into file_entries (
              id, space_id, parent_id, kind, name, normalized_name, created_by_account_id
            ) values (
              ${fileEntryId}, ${session.space_id}, ${session.parent_id}, 'file',
              ${session.file_name}, ${session.normalized_name}, ${session.created_by_account_id}
            )
          `;
        }
        const [next] = await tx<{ version_number: number }[]>`
          select coalesce(max(version_number), 0)::int + 1 as version_number
          from file_versions where file_entry_id = ${fileEntryId}
        `;
        await tx`
          insert into file_versions (
            id, file_entry_id, version_number, object_key, size_bytes, content_type,
            checksum_sha256, status, created_by_account_id
          ) values (
            ${versionId}, ${fileEntryId}, ${next?.version_number ?? 1}, ${destination},
            ${session.expected_size_bytes}, ${session.content_type}, ${checksum}, 'available',
            ${session.created_by_account_id}
          )
        `;
        await tx`update file_entries set current_version_id = ${versionId}, lock_version = lock_version + 1,
          updated_at = now() where id = ${fileEntryId}`;
        await tx`update spaces set reserved_bytes = reserved_bytes - reservation.bytes,
          used_bytes = used_bytes + reservation.bytes, updated_at = now()
          from storage_reservations reservation
          where reservation.upload_session_id = ${session.id} and reservation.status = 'reserved'
            and spaces.id = reservation.space_id`;
        await tx`update storage_reservations set status = 'committed', updated_at = now()
          where upload_session_id = ${session.id} and status = 'reserved'`;
        await tx`update upload_sessions set status = 'completed', completed_version_id = ${versionId},
          updated_at = now() where id = ${session.id} and status = 'verifying'`;
      });
    } catch (error) {
      await this.options.objectStore.deleteObject(destination).catch(() => undefined);
      throw error;
    }
    await this.options.objectStore.deleteObject(session.temporary_object_key);
  }

  private async expireUpload(payload: Record<string, unknown>) {
    const id = this.payloadId(payload, "uploadSessionId");
    const [session] = await this.options.sql<
      { id: string; temporary_object_key: string; s3_upload_id: string | null; status: string }[]
    >`select id, temporary_object_key, s3_upload_id, status from upload_sessions where id = ${id}`;
    if (session === undefined || !["created", "uploading"].includes(session.status)) return;
    if (session.s3_upload_id !== null) {
      await this.options.objectStore.abortMultipart(
        session.temporary_object_key,
        session.s3_upload_id,
      );
    }
    await this.options.objectStore.deleteObject(session.temporary_object_key);
    await this.options.sql.begin(async (tx) => {
      await tx`update spaces set reserved_bytes = reserved_bytes - reservation.bytes, updated_at = now()
        from storage_reservations reservation where reservation.upload_session_id = ${id}
          and reservation.status = 'reserved' and spaces.id = reservation.space_id`;
      await tx`update storage_reservations set status = 'released', updated_at = now()
        where upload_session_id = ${id} and status = 'reserved'`;
      await tx`update upload_sessions set status = 'expired', updated_at = now() where id = ${id}`;
    });
  }

  private async purgeTrash(payload: Record<string, unknown>) {
    const entryId = this.payloadId(payload, "entryId");
    const rows = await this.options.sql<
      { object_key: string; size_bytes: string; space_id: string }[]
    >`
      select version.object_key, version.size_bytes, entry.space_id
      from trash_entries trash join file_entries root on root.id = trash.entry_id
      join lateral (
        with recursive tree as (
          select id from file_entries where id = root.id
          union all select child.id from file_entries child join tree on child.parent_id = tree.id
        ) select id from tree
      ) tree on true
      join file_entries entry on entry.id = tree.id
      join file_versions version on version.file_entry_id = entry.id
      where trash.entry_id = ${entryId} and trash.purge_status = 'processing'
    `;
    for (const row of rows) await this.options.objectStore.deleteObject(row.object_key);
    await this.options.sql.begin(async (tx) => {
      const [trash] = await tx<{ exists: boolean }[]>`
        select exists(select 1 from trash_entries where entry_id = ${entryId} and purge_status = 'processing') as exists
      `;
      if (trash?.exists !== true) return;
      const total = rows.reduce((sum, row) => sum + BigInt(row.size_bytes), 0n);
      if (rows[0] !== undefined) {
        await tx`update spaces set used_bytes = greatest(0, used_bytes - ${total.toString()}::bigint),
          updated_at = now() where id = ${rows[0].space_id}`;
      }
      await tx`delete from file_entries where id = ${entryId}`;
    });
  }

  private async reconcileVersion(payload: Record<string, unknown>) {
    const versionId = this.payloadId(payload, "versionId");
    const [version] = await this.options.sql<{ object_key: string; size_bytes: string }[]>`
      select object_key, size_bytes from file_versions where id = ${versionId}
    `;
    if (version === undefined) return;
    const head = await this.options.objectStore.headObject(version.object_key);
    if (head === undefined || head.sizeBytes !== Number(version.size_bytes)) {
      await this.options.sql`update file_versions set status = 'corrupt' where id = ${versionId}`;
    }
  }

  private async enqueueDueJobs() {
    await this.options.sql`
      insert into file_maintenance_jobs (job_type, payload, available_at)
      select 'expire_upload', jsonb_build_object('uploadSessionId', upload.id), ${this.now()}
      from upload_sessions upload
      where upload.status in ('created', 'uploading') and upload.expires_at <= ${this.now()}
        and not exists (
          select 1 from file_maintenance_jobs job
          where job.job_type = 'expire_upload' and job.payload->>'uploadSessionId' = upload.id::text
            and job.status in ('pending', 'processing')
        )
    `;
    await this.options.sql`
      update trash_entries set purge_status = 'processing'
      where purge_status = 'pending' and expires_at <= ${this.now()}
    `;
    await this.options.sql`
      insert into file_maintenance_jobs (job_type, payload, available_at)
      select 'purge_trash', jsonb_build_object('entryId', trash.entry_id), ${this.now()}
      from trash_entries trash
      where trash.purge_status = 'processing'
        and not exists (
          select 1 from file_maintenance_jobs job
          where job.job_type = 'purge_trash' and job.payload->>'entryId' = trash.entry_id::text
            and job.status in ('pending', 'processing')
        )
    `;
  }
}
