import type { TransactionClient } from "../db/transaction.js";

export async function accountAndPrincipalSummary(
  transaction: TransactionClient,
  accountId: string,
  principalId: string,
) {
  const [row] = await transaction<
    {
      account_id: string;
      username: string;
      phone_e164: string | null;
      phone_verified_at: Date | null;
      account_status: "active" | "suspended";
      account_created_at: Date;
      principal_id: string;
      principal_type: "human" | "system" | "ai_employee" | "service_account";
      principal_account_id: string | null;
    }[]
  >`
    select
      a.id as account_id, a.username::text, a.phone_e164, a.phone_verified_at,
      a.status as account_status, a.created_at as account_created_at,
      p.id as principal_id, p.type as principal_type, p.account_id as principal_account_id
    from accounts a
    join principals p on p.id = ${principalId}
    where a.id = ${accountId}
  `;
  if (row === undefined) throw new Error("account identity disappeared");
  return {
    account: {
      id: row.account_id,
      username: row.username,
      phone: row.phone_e164,
      phoneVerifiedAt: row.phone_verified_at?.toISOString() ?? null,
      status: row.account_status,
      createdAt: row.account_created_at.toISOString(),
    },
    principal: {
      id: row.principal_id,
      type: row.principal_type,
      accountId: row.principal_account_id,
    },
  };
}

export async function organizationSummary(transaction: TransactionClient, organizationId: string) {
  const [row] = await transaction<
    {
      id: string;
      name: string;
      status: "active" | "suspended" | "closed";
      storage_quota_bytes: string | number;
      created_at: Date;
    }[]
  >`
    select id, name, status, storage_quota_bytes, created_at
    from organizations where id = ${organizationId}
  `;
  if (row === undefined) throw new Error("organization disappeared");
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    storageQuotaBytes: Number(row.storage_quota_bytes),
    createdAt: row.created_at.toISOString(),
  };
}

export async function membershipSummary(transaction: TransactionClient, membershipId: string) {
  const [row] = await transaction<
    {
      id: string;
      organization_id: string;
      account_id: string;
      username: string;
      role: "org_owner" | "org_admin" | "member";
      status: "active" | "suspended" | "removed";
      created_at: Date;
      updated_at: Date;
    }[]
  >`
    select
      m.id, m.organization_id, m.account_id, a.username::text,
      m.role, m.status, m.created_at, m.updated_at
    from memberships m
    join accounts a on a.id = m.account_id
    where m.id = ${membershipId}
  `;
  if (row === undefined) throw new Error("membership disappeared");
  return {
    id: row.id,
    organizationId: row.organization_id,
    accountId: row.account_id,
    username: row.username,
    role: row.role,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
