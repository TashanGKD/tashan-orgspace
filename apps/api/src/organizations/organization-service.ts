import { AuthError } from "../auth/auth-errors.js";
import type { DatabaseClient } from "../db/client.js";
import type { TransactionClient } from "../db/transaction.js";
import { requireOrganizationMembership, type MembershipRole } from "./authorization.js";

export class OrganizationService {
  public constructor(private readonly sql: DatabaseClient) {}

  public async createOrganization(
    accountId: string,
    name: string,
    existingTransaction?: TransactionClient,
  ) {
    const normalizedName = name.trim();
    if (normalizedName.length === 0 || normalizedName.length > 128) {
      throw new AuthError("VALIDATION_FAILED", "organization name is invalid");
    }

    const operation = async (transaction: TransactionClient) => {
      const [account] = await transaction<{ phone_verified_at: Date | null }[]>`
        select phone_verified_at from accounts where id = ${accountId} and status = 'active' for update
      `;
      if (account?.phone_verified_at == null) {
        throw new AuthError("PHONE_NOT_VERIFIED", "verified phone is required for membership");
      }
      const [organization] = await transaction<{ id: string; name: string }[]>`
        insert into organizations (name) values (${normalizedName}) returning id, name
      `;
      if (organization === undefined) throw new Error("organization insert returned no row");
      const [membership] = await transaction<{ id: string }[]>`
        insert into memberships (organization_id, account_id, role, status)
        values (${organization.id}, ${accountId}, 'org_owner', 'active')
        returning id
      `;
      if (membership === undefined) throw new Error("owner membership insert returned no row");
      return { ...organization, membershipId: membership.id };
    };
    return existingTransaction === undefined
      ? this.sql.begin(operation)
      : operation(existingTransaction);
  }

  public async addMember(
    actorAccountId: string,
    organizationId: string,
    targetAccountId: string,
    role: MembershipRole,
    existingTransaction?: TransactionClient,
  ) {
    const operation = async (transaction: TransactionClient) => {
      await requireOrganizationMembership(transaction, actorAccountId, organizationId, [
        "org_owner",
        "org_admin",
      ]);
      const [target] = await transaction<{ phone_verified_at: Date | null }[]>`
        select phone_verified_at
        from accounts
        where id = ${targetAccountId} and status = 'active'
        for update
      `;
      if (target?.phone_verified_at == null) {
        throw new AuthError("PHONE_NOT_VERIFIED", "verified phone is required for membership");
      }

      const [membership] = await transaction<{ id: string }[]>`
        insert into memberships (organization_id, account_id, role, status)
        values (${organizationId}, ${targetAccountId}, ${role}, 'active')
        returning id
      `;
      if (membership === undefined) throw new Error("membership insert returned no row");
      return membership;
    };
    return existingTransaction === undefined
      ? this.sql.begin(operation)
      : operation(existingTransaction);
  }

  public async listMembers(actorAccountId: string, organizationId: string) {
    return this.sql.begin(async (transaction) => {
      await requireOrganizationMembership(transaction, actorAccountId, organizationId);
      return transaction<
        {
          id: string;
          organization_id: string;
          account_id: string;
          username: string;
          role: MembershipRole;
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
        where m.organization_id = ${organizationId} and m.status = 'active'
        order by m.created_at, m.id
      `;
    });
  }
}
