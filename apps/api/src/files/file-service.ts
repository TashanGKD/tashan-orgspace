import { randomUUID } from "node:crypto";

import {
  FolderAccessSetRequest,
  FolderManagerRecoverRequest,
  FileMoveRequest,
  FileName,
  FileRestoreRequest,
  FolderCreateRequest,
  FolderGrantSetRequest,
} from "@tashan/contracts";

import { AuthError } from "../auth/auth-errors.js";
import type { DatabaseClient } from "../db/client.js";
import type { TransactionClient } from "../db/transaction.js";
import { requireFilePermission } from "./file-authorization.js";
import { FileRepository } from "./file-repository.js";

export interface FileDownloadSigner {
  sign(input: {
    objectKey: string;
    fileName: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string>;
}

interface EntryRow {
  id: string;
  space_id: string;
  parent_id: string | null;
  kind: "file" | "folder";
  name: string;
  state: "active" | "trash";
  lock_version: number;
  current_version_id?: string | null;
  size_bytes?: string | number | null;
  content_type?: string | null;
  checksum_sha256?: string | null;
  created_by_account_id: string;
  created_at: Date;
  updated_at: Date;
}

function normalize(name: string): string {
  return FileName.parse(name).normalize("NFC").toLocaleLowerCase("en-US");
}

function entry(row: EntryRow) {
  return {
    id: row.id,
    spaceId: row.space_id,
    parentId: row.parent_id,
    kind: row.kind,
    name: row.name,
    state: row.state,
    lockVersion: row.lock_version,
    currentVersionId: row.current_version_id ?? null,
    sizeBytes: Number(row.size_bytes ?? 0),
    contentType: row.content_type ?? null,
    createdByAccountId: row.created_by_account_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class FileService {
  private readonly repository = new FileRepository();
  public constructor(
    private readonly sql: DatabaseClient,
    private readonly downloadSigner?: FileDownloadSigner,
  ) {}

  private async accessRows(transaction: TransactionClient, folderId: string) {
    const [policy] = await transaction<
      { scope: "organization_public" | "restricted"; lock_version: number }[]
    >`select scope, lock_version from folder_access_policies where folder_id = ${folderId}`;
    if (policy === undefined) throw new AuthError("FILE_NOT_FOUND", "folder policy not found");
    const grants = await transaction<
      { account_id: string; role: "manager" | "editor" | "viewer" }[]
    >`select account_id, role from folder_grants where folder_id = ${folderId} order by created_at, account_id`;
    return {
      folderId,
      scope: policy.scope,
      lockVersion: policy.lock_version,
      inheritedFromFolderId: folderId,
      grants: grants.map((grant) => ({ accountId: grant.account_id, role: grant.role })),
    };
  }

  private async row(transaction: TransactionClient, spaceId: string, entryId: string) {
    const [row] = await transaction<EntryRow[]>`
      select entry.id, entry.space_id, entry.parent_id, entry.kind, entry.name, entry.state,
        entry.lock_version, entry.current_version_id, version.size_bytes, version.content_type,
        version.checksum_sha256, entry.created_by_account_id, entry.created_at, entry.updated_at
      from file_entries entry left join file_versions version on version.id = entry.current_version_id
      where entry.id = ${entryId} and entry.space_id = ${spaceId}
    `;
    if (row === undefined) throw new AuthError("FILE_NOT_FOUND", "file entry not found");
    return row;
  }

  public async list(accountId: string, spaceId: string, parentId: string, includeTrash = false) {
    return this.sql.begin(async (transaction) => {
      await requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId: parentId,
        permission: "read",
      });
      const rows = await transaction<EntryRow[]>`
        select entry.id, entry.space_id, entry.parent_id, entry.kind, entry.name, entry.state,
          entry.lock_version, entry.current_version_id, version.size_bytes, version.content_type,
          version.checksum_sha256, entry.created_by_account_id, entry.created_at, entry.updated_at
        from file_entries entry left join file_versions version on version.id = entry.current_version_id
        where entry.space_id = ${spaceId} and entry.parent_id = ${parentId}
          and (${includeTrash} or entry.state = 'active')
        order by entry.normalized_name, entry.id
      `;
      const visible: ReturnType<typeof entry>[] = [];
      for (const row of rows) {
        try {
          await requireFilePermission(transaction, {
            accountId,
            spaceId,
            entryId: row.id,
            permission: "read",
          });
          visible.push(entry(row));
        } catch (error) {
          if (error instanceof AuthError && error.code === "FILE_FORBIDDEN") continue;
          throw error;
        }
      }
      return visible;
    });
  }

  public async read(accountId: string, spaceId: string, entryId: string) {
    return this.sql.begin(async (transaction) => {
      const access = await requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId,
        permission: "read",
      });
      const row = await this.row(transaction, spaceId, entryId);
      return {
        ...entry(row),
        inheritedFromFolderId: access.inheritedFromFolderId ?? access.space.root_folder_id,
        effectiveRole: access.effectiveRole,
        checksumSha256: row.checksum_sha256 ?? null,
      };
    });
  }

  public async search(accountId: string, spaceId: string, query: string) {
    const normalizedQuery = normalize(query);
    return this.sql.begin(async (transaction) => {
      await requireFilePermission(transaction, { accountId, spaceId, permission: "metadata" });
      const rows = await transaction<EntryRow[]>`
        select entry.id, entry.space_id, entry.parent_id, entry.kind, entry.name, entry.state,
          entry.lock_version, entry.current_version_id, version.size_bytes, version.content_type,
          version.checksum_sha256, entry.created_by_account_id, entry.created_at, entry.updated_at
        from file_entries entry left join file_versions version on version.id = entry.current_version_id
        where entry.space_id = ${spaceId} and entry.state = 'active'
          and entry.normalized_name like ${`%${normalizedQuery}%`}
        order by entry.updated_at desc, entry.id limit 200
      `;
      const visible: ReturnType<typeof entry>[] = [];
      for (const row of rows) {
        try {
          await requireFilePermission(transaction, {
            accountId,
            spaceId,
            entryId: row.id,
            permission: "read",
          });
          visible.push(entry(row));
        } catch (error) {
          if (error instanceof AuthError && error.code === "FILE_FORBIDDEN") continue;
          throw error;
        }
      }
      return visible;
    });
  }

  public async createFolder(accountId: string, spaceId: string, raw: unknown) {
    const input = FolderCreateRequest.parse(raw);
    return this.sql.begin(async (transaction) => {
      await requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId: input.parentId,
        permission: "write",
      });
      const folderId = randomUUID();
      try {
        const [created] = await transaction<EntryRow[]>`
          insert into file_entries (
            id, space_id, parent_id, kind, name, normalized_name, created_by_account_id
          ) values (${folderId}, ${spaceId}, ${input.parentId}, 'folder', ${input.name}, ${normalize(input.name)}, ${accountId})
          returning id, space_id, parent_id, kind, name, state, lock_version,
            created_by_account_id, created_at, updated_at
        `;
        if (created === undefined) throw new Error("folder insert returned no row");
        await transaction`
          insert into folder_access_policies (folder_id, scope, updated_by_account_id)
          values (${folderId}, ${input.accessScope}, ${accountId})
        `;
        await transaction`
          insert into folder_grants (folder_id, account_id, role, granted_by_account_id)
          values (${folderId}, ${accountId}, 'manager', ${accountId})
        `;
        for (const grant of input.grants) {
          if (grant.accountId === accountId) continue;
          await transaction`
            insert into folder_grants (folder_id, account_id, role, granted_by_account_id)
            values (${folderId}, ${grant.accountId}, ${grant.role}, ${accountId})
          `;
        }
        return entry(created);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "constraint_name" in error &&
          error.constraint_name === "file_entries_active_sibling_name"
        ) {
          throw new AuthError("FILE_NAME_CONFLICT", "a file entry with this name already exists");
        }
        throw error;
      }
    });
  }

  public async move(accountId: string, spaceId: string, entryId: string, raw: unknown) {
    const input = FileMoveRequest.parse(raw);
    return this.sql.begin(async (transaction) => {
      await requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId,
        permission: "write",
      });
      await requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId: input.targetParentId,
        permission: "write",
      });
      const current = await this.row(transaction, spaceId, entryId);
      if (current.lock_version !== input.expectedVersion)
        throw new AuthError("FILE_VERSION_CONFLICT", "file entry changed");
      const name = input.name ?? current.name;
      try {
        const [updated] = await transaction<EntryRow[]>`
          update file_entries set parent_id = ${input.targetParentId}, name = ${name},
            normalized_name = ${normalize(name)}, lock_version = lock_version + 1, updated_at = now()
          where id = ${entryId} returning id, space_id, parent_id, kind, name, state,
            lock_version, created_by_account_id, created_at, updated_at
        `;
        if (updated === undefined) throw new Error("file move returned no row");
        return entry(await this.row(transaction, spaceId, updated.id));
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "constraint_name" in error &&
          error.constraint_name === "file_entries_active_sibling_name"
        ) {
          throw new AuthError("FILE_NAME_CONFLICT", "target already contains this name");
        }
        throw error;
      }
    });
  }

  public async trash(accountId: string, spaceId: string, entryId: string) {
    return this.sql.begin(async (transaction) => {
      const [boundary] = await transaction<{ exists: boolean }[]>`
        select exists(select 1 from folder_access_policies where folder_id = ${entryId}) as exists
      `;
      await requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId,
        permission: boundary?.exists ? "manage" : "write",
      });
      const current = await this.row(transaction, spaceId, entryId);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000);
      await transaction`
        with recursive tree as (
          select id from file_entries where id = ${entryId}
          union all select child.id from file_entries child join tree on child.parent_id = tree.id
        ) update file_entries set state = 'trash', lock_version = lock_version + 1,
          updated_at = now() where id in (select id from tree)
      `;
      await transaction`
        insert into trash_entries (
          entry_id, original_parent_id, deleted_by_account_id, expires_at, purge_key
        ) values (${entryId}, ${current.parent_id}, ${accountId}, ${expiresAt}, ${`trash:${entryId}`})
      `;
      return {
        ...entry(await this.row(transaction, spaceId, entryId)),
        expiresAt: expiresAt.toISOString(),
      };
    });
  }

  public async restore(accountId: string, spaceId: string, entryId: string, raw: unknown) {
    const input = FileRestoreRequest.parse(raw);
    return this.sql.begin(async (transaction) => {
      const current = await this.row(transaction, spaceId, entryId);
      if (current.state !== "trash" || current.lock_version !== input.expectedVersion) {
        throw new AuthError("FILE_VERSION_CONFLICT", "trash entry changed");
      }
      const [trash] = await transaction<{ original_parent_id: string | null }[]>`
        select original_parent_id from trash_entries
        where entry_id = ${entryId} and purge_status = 'pending' for update
      `;
      if (trash === undefined) throw new AuthError("FILE_NOT_FOUND", "trash entry not found");
      const parentId = input.parentId ?? trash.original_parent_id;
      if (parentId === null)
        throw new AuthError("FILE_VERSION_CONFLICT", "restore target is unavailable");
      await requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId: parentId,
        permission: "write",
      });
      const name = input.name ?? current.name;
      const [conflict] = await transaction<{ id: string }[]>`
        select id from file_entries where space_id = ${spaceId} and parent_id = ${parentId}
          and normalized_name = ${normalize(name)} and state = 'active' limit 1
      `;
      if (conflict !== undefined)
        throw new AuthError("FILE_NAME_CONFLICT", "restore target already contains this name");
      await transaction`
        update file_entries set state = 'active', parent_id = ${parentId}, name = ${name},
          normalized_name = ${normalize(name)}, lock_version = lock_version + 1, updated_at = now()
        where id = ${entryId}
      `;
      await transaction`
        with recursive tree as (
          select id from file_entries where parent_id = ${entryId}
          union all select child.id from file_entries child join tree on child.parent_id = tree.id
        ) update file_entries set state = 'active', updated_at = now()
          where id in (select id from tree)
      `;
      await transaction`delete from trash_entries where entry_id = ${entryId}`;
      return entry(await this.row(transaction, spaceId, entryId));
    });
  }

  public async setGrant(accountId: string, spaceId: string, folderId: string, raw: unknown) {
    const input = FolderGrantSetRequest.parse(raw);
    return this.sql.begin(async (transaction) => {
      await requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId: folderId,
        permission: "manage",
      });
      const [policy] = await transaction<
        { lock_version: number; scope: "organization_public" | "restricted" }[]
      >`
        select lock_version, scope from folder_access_policies where folder_id = ${folderId} for update
      `;
      if (policy === undefined || policy.lock_version !== input.expectedVersion) {
        throw new AuthError("FILE_VERSION_CONFLICT", "folder access changed");
      }
      await transaction`
        insert into folder_grants (folder_id, account_id, role, granted_by_account_id)
        values (${folderId}, ${input.accountId}, ${input.role}, ${accountId})
        on conflict (folder_id, account_id) do update set role = excluded.role,
          granted_by_account_id = excluded.granted_by_account_id, updated_at = now()
      `;
      await transaction`update folder_access_policies set lock_version = lock_version + 1, updated_by_account_id = ${accountId}, updated_at = now() where folder_id = ${folderId}`;
      return this.accessRows(transaction, folderId);
    });
  }

  public async access(accountId: string, spaceId: string, folderId: string) {
    return this.sql.begin(async (transaction) => {
      await requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId: folderId,
        permission: "metadata",
      });
      return this.accessRows(transaction, folderId);
    });
  }

  public async setAccess(accountId: string, spaceId: string, folderId: string, raw: unknown) {
    const input = FolderAccessSetRequest.parse(raw);
    return this.sql.begin(async (transaction) => {
      await requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId: folderId,
        permission: "manage",
      });
      const updated = await transaction`
        update folder_access_policies set scope = ${input.scope}, lock_version = lock_version + 1,
          updated_by_account_id = ${accountId}, updated_at = now()
        where folder_id = ${folderId} and lock_version = ${input.expectedVersion}
        returning folder_id
      `;
      if (updated.length !== 1)
        throw new AuthError("FILE_VERSION_CONFLICT", "folder access changed");
      return this.accessRows(transaction, folderId);
    });
  }

  public async revokeGrant(
    accountId: string,
    spaceId: string,
    folderId: string,
    targetAccountId: string,
  ) {
    return this.sql.begin(async (transaction) => {
      await requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId: folderId,
        permission: "manage",
      });
      await this.repository.revokeFolderGrant(transaction, {
        folderId,
        accountId: targetAccountId,
      });
      await transaction`
        update folder_access_policies set lock_version = lock_version + 1,
          updated_by_account_id = ${accountId}, updated_at = now() where folder_id = ${folderId}
      `;
      return this.accessRows(transaction, folderId);
    });
  }

  public async recoverManager(
    adminAccountId: string,
    spaceId: string,
    folderId: string,
    raw: unknown,
  ) {
    const input = FolderManagerRecoverRequest.parse(raw);
    return this.sql.begin(async (transaction) => {
      const [space] = await transaction<{ organization_id: string | null }[]>`
        select organization_id from spaces where id = ${spaceId}
      `;
      if (space?.organization_id === null || space?.organization_id === undefined) {
        throw new AuthError("SPACE_FORBIDDEN", "manager recovery requires an organization space");
      }
      const [admin] = await transaction<{ exists: boolean }[]>`
        select exists(
          select 1 from memberships where organization_id = ${space.organization_id}
            and account_id = ${adminAccountId} and status = 'active'
            and role in ('org_owner', 'org_admin')
        ) as exists
      `;
      const [target] = await transaction<{ exists: boolean }[]>`
        select exists(
          select 1 from memberships where organization_id = ${space.organization_id}
            and account_id = ${input.accountId} and status = 'active'
        ) as exists
      `;
      if (admin?.exists !== true || target?.exists !== true) {
        throw new AuthError("FOLDER_MANAGER_REQUIRED", "manager recovery is unavailable");
      }
      const [policy] = await transaction<{ lock_version: number }[]>`
        select lock_version from folder_access_policies where folder_id = ${folderId} for update
      `;
      if (policy?.lock_version !== input.expectedVersion) {
        throw new AuthError("FILE_VERSION_CONFLICT", "folder access changed");
      }
      await transaction`
        insert into folder_grants (folder_id, account_id, role, granted_by_account_id)
        values (${folderId}, ${input.accountId}, 'manager', ${adminAccountId})
        on conflict (folder_id, account_id) do update set role = 'manager',
          granted_by_account_id = excluded.granted_by_account_id, updated_at = now()
      `;
      await transaction`
        update folder_access_policies set lock_version = lock_version + 1,
          updated_by_account_id = ${adminAccountId}, updated_at = now() where folder_id = ${folderId}
      `;
      return this.accessRows(transaction, folderId);
    });
  }

  public async versions(accountId: string, spaceId: string, fileEntryId: string) {
    return this.sql.begin(async (transaction) => {
      await requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId: fileEntryId,
        permission: "read",
      });
      const rows = await transaction<
        {
          id: string;
          file_entry_id: string;
          version_number: number;
          size_bytes: string | number;
          content_type: string;
          checksum_sha256: string;
          status: "verifying" | "available" | "corrupt";
          created_by_account_id: string;
          created_at: Date;
        }[]
      >`
        select id, file_entry_id, version_number, size_bytes, content_type,
          checksum_sha256, status, created_by_account_id, created_at
        from file_versions where file_entry_id = ${fileEntryId}
        order by version_number desc
      `;
      return rows.map((row) => ({
        id: row.id,
        fileEntryId: row.file_entry_id,
        versionNumber: row.version_number,
        sizeBytes: Number(row.size_bytes),
        contentType: row.content_type,
        checksumSha256: row.checksum_sha256,
        status: row.status,
        createdByAccountId: row.created_by_account_id,
        createdAt: row.created_at.toISOString(),
      }));
    });
  }

  public async restoreVersion(
    accountId: string,
    spaceId: string,
    fileEntryId: string,
    versionId: string,
    expectedVersion: number,
  ) {
    return this.sql.begin(async (transaction) => {
      await requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId: fileEntryId,
        permission: "write",
      });
      const [version] = await transaction<
        {
          id: string;
          file_entry_id: string;
          version_number: number;
          size_bytes: string | number;
          content_type: string;
          checksum_sha256: string;
          status: "available";
          created_by_account_id: string;
          created_at: Date;
        }[]
      >`
        select id, file_entry_id, version_number, size_bytes, content_type, checksum_sha256,
          status, created_by_account_id, created_at from file_versions where id = ${versionId}
          and file_entry_id = ${fileEntryId} and status = 'available'
      `;
      if (version === undefined) throw new AuthError("FILE_NOT_FOUND", "file version not found");
      const updated = await transaction`
        update file_entries set current_version_id = ${versionId}, lock_version = lock_version + 1,
          updated_at = now() where id = ${fileEntryId} and lock_version = ${expectedVersion}
        returning id
      `;
      if (updated.length !== 1) throw new AuthError("FILE_VERSION_CONFLICT", "file entry changed");
      return {
        entry: entry(await this.row(transaction, spaceId, fileEntryId)),
        version: {
          id: version.id,
          fileEntryId: version.file_entry_id,
          versionNumber: version.version_number,
          sizeBytes: Number(version.size_bytes),
          contentType: version.content_type,
          checksumSha256: version.checksum_sha256,
          status: version.status,
          createdByAccountId: version.created_by_account_id,
          createdAt: version.created_at.toISOString(),
        },
      };
    });
  }

  public async createDownload(accountId: string, spaceId: string, fileEntryId: string) {
    const signer = this.downloadSigner;
    if (signer === undefined) throw new Error("file download signer is unavailable");
    return this.sql.begin(async (transaction) => {
      await requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId: fileEntryId,
        permission: "read",
      });
      const [version] = await transaction<
        { object_key: string; checksum_sha256: string; content_type: string; name: string }[]
      >`
        select version.object_key, version.checksum_sha256, version.content_type, file.name
        from file_entries file join file_versions version on version.id = file.current_version_id
        where file.id = ${fileEntryId} and file.kind = 'file' and version.status = 'available'
      `;
      if (version === undefined)
        throw new AuthError("FILE_NOT_FOUND", "downloadable version not found");
      const expiresAt = new Date(Date.now() + 5 * 60_000);
      return {
        url: await signer.sign({
          objectKey: version.object_key,
          fileName: version.name,
          contentType: version.content_type,
          expiresInSeconds: 300,
        }),
        expiresAt: expiresAt.toISOString(),
        checksumSha256: version.checksum_sha256,
        fileName: version.name,
      };
    });
  }

  public async deletePermanently(accountId: string, spaceId: string, entryId: string) {
    return this.sql.begin(async (transaction) => {
      const current = await this.row(transaction, spaceId, entryId);
      if (current.state !== "trash")
        throw new AuthError("FILE_VERSION_CONFLICT", "entry is not in trash");
      await requireFilePermission(transaction, {
        accountId,
        spaceId,
        entryId,
        permission: current.kind === "folder" ? "manage" : "write",
      });
      const updated = await transaction`
        update trash_entries set purge_status = 'processing'
        where entry_id = ${entryId} and purge_status in ('pending', 'failed') returning entry_id
      `;
      if (updated.length === 1) {
        await transaction`
          insert into file_maintenance_jobs (job_type, payload)
          values ('purge_trash', ${transaction.json({ entryId })})
        `;
      }
      return { entryId, queued: true };
    });
  }
}
