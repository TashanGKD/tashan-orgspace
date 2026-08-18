import type { TransactionClient } from "../db/transaction.js";

export class OrganizationRepository {
  public async create(transaction: TransactionClient, name: string) {
    const [organization] = await transaction<{ id: string; name: string }[]>`
      insert into organizations (name)
      values (${name})
      returning id, name
    `;
    if (organization === undefined) throw new Error("organization insert returned no row");
    return organization;
  }

  public async addMembership(
    transaction: TransactionClient,
    input: {
      organizationId: string;
      accountId: string;
      role: "org_owner" | "org_admin" | "member";
    },
  ) {
    const [membership] = await transaction<{ id: string }[]>`
      insert into memberships (organization_id, account_id, role, status)
      values (${input.organizationId}, ${input.accountId}, ${input.role}, 'active')
      returning id
    `;
    if (membership === undefined) throw new Error("membership insert returned no row");
    return membership;
  }
}
