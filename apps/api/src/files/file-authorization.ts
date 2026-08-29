import { AuthError } from "../auth/auth-errors.js";
import type { TransactionClient } from "../db/transaction.js";

export type FilePermission = "metadata" | "read" | "write" | "manage";
type EffectiveRole = "manager" | "editor" | "viewer";

interface SpaceRow {
  id: string;
  type: "personal" | "organization";
  account_id: string | null;
  organization_id: string | null;
  root_folder_id: string;
}

interface EntryRow {
  id: string;
  space_id: string;
  parent_id: string | null;
  kind: "file" | "folder";
}

function permits(role: EffectiveRole | null, permission: FilePermission): boolean {
  if (permission === "metadata" || permission === "read") return role !== null;
  if (permission === "write") return role === "manager" || role === "editor";
  return role === "manager";
}

export async function requireFilePermission(
  transaction: TransactionClient,
  input: { accountId: string; spaceId: string; entryId?: string; permission: FilePermission },
): Promise<{
  space: SpaceRow;
  entry?: EntryRow;
  inheritedFromFolderId?: string;
  effectiveRole: EffectiveRole;
}> {
  const [space] = await transaction<SpaceRow[]>`
    select id, type, account_id, organization_id, root_folder_id
    from spaces where id = ${input.spaceId}
  `;
  if (space === undefined) throw new AuthError("SPACE_NOT_FOUND", "space not found");

  if (space.type === "personal") {
    if (space.account_id !== input.accountId) {
      throw new AuthError("SPACE_FORBIDDEN", "space is unavailable");
    }
    const entry =
      input.entryId === undefined
        ? undefined
        : (
            await transaction<EntryRow[]>`
              select id, space_id, parent_id, kind from file_entries
              where id = ${input.entryId} and space_id = ${space.id}
            `
          )[0];
    if (input.entryId !== undefined && entry === undefined) {
      throw new AuthError("FILE_NOT_FOUND", "file entry not found");
    }
    return {
      space,
      ...(entry === undefined ? {} : { entry, inheritedFromFolderId: space.root_folder_id }),
      effectiveRole: "manager",
    };
  }

  const [membership] = await transaction<{ role: "org_owner" | "org_admin" | "member" }[]>`
    select role from memberships
    where organization_id = ${space.organization_id}
      and account_id = ${input.accountId}
      and status = 'active'
  `;
  if (membership === undefined) throw new AuthError("SPACE_FORBIDDEN", "space is unavailable");

  const entryId = input.entryId ?? space.root_folder_id;
  const [entry] = await transaction<EntryRow[]>`
    select id, space_id, parent_id, kind from file_entries
    where id = ${entryId} and space_id = ${space.id}
  `;
  if (entry === undefined) throw new AuthError("FILE_NOT_FOUND", "file entry not found");

  const [policy] = await transaction<
    {
      folder_id: string;
      scope: "organization_public" | "restricted";
      grant_role: EffectiveRole | null;
    }[]
  >`
    with recursive ancestors as (
      select id, parent_id, 0 as depth from file_entries where id = ${entry.id}
      union all
      select parent.id, parent.parent_id, ancestors.depth + 1
      from file_entries parent join ancestors on ancestors.parent_id = parent.id
      where ancestors.depth < 256
    )
    select policy.folder_id, policy.scope, grants.role as grant_role
    from ancestors
    join folder_access_policies policy on policy.folder_id = ancestors.id
    left join folder_grants grants
      on grants.folder_id = policy.folder_id and grants.account_id = ${input.accountId}
    order by ancestors.depth
    limit 1
  `;
  if (policy === undefined) throw new AuthError("FILE_FORBIDDEN", "file entry is unavailable");

  const effectiveRole: EffectiveRole | null =
    policy.grant_role ?? (policy.scope === "organization_public" ? "editor" : null);
  const adminMetadata =
    input.permission === "metadata" &&
    (membership.role === "org_owner" || membership.role === "org_admin");
  if (!adminMetadata && !permits(effectiveRole, input.permission)) {
    throw new AuthError("FILE_FORBIDDEN", "file entry is unavailable");
  }
  return {
    space,
    entry,
    inheritedFromFolderId: policy.folder_id,
    effectiveRole: effectiveRole ?? "viewer",
  };
}
