import { AuthError } from "../auth/auth-errors.js";
import type { DatabaseClient } from "../db/client.js";
import { requireOrganizationMembership, type MembershipRole } from "./authorization.js";

export class OrganizationService {
  public constructor(private readonly sql: DatabaseClient) {}

  public async createOrganization(accountId: string, name: string) {
    const normalizedName = name.trim();
    if (normalizedName.length === 0 || normalizedName.length > 128) {
      throw new AuthError("VALIDATION_FAILED", "organization name is invalid");
    }

    return this.sql.begin(async (transaction) => {
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
      await transaction`
        insert into memberships (organization_id, account_id, role, status)
        values (${organization.id}, ${accountId}, 'org_owner', 'active')
      `;
      return organization;
    });
  }

  public async addMember(
    actorAccountId: string,
    organizationId: string,
    targetAccountId: string,
    role: MembershipRole,
  ) {
    return this.sql.begin(async (transaction) => {
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
    });
  }

  public async listMembers(actorAccountId: string, organizationId: string) {
    return this.sql.begin(async (transaction) => {
      await requireOrganizationMembership(transaction, actorAccountId, organizationId);
      return transaction<
        { id: string; account_id: string; username: string; role: MembershipRole; status: string }[]
      >`
        select m.id, m.account_id, a.username::text, m.role, m.status
        from memberships m
        join accounts a on a.id = m.account_id
        where m.organization_id = ${organizationId} and m.status = 'active'
        order by m.created_at, m.id
      `;
    });
  }
}
