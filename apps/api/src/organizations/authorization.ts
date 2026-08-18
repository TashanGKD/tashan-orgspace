import { AuthError } from "../auth/auth-errors.js";
import type { TransactionClient } from "../db/transaction.js";

export type MembershipRole = "org_owner" | "org_admin" | "member";

export async function requireOrganizationMembership(
  transaction: TransactionClient,
  accountId: string,
  organizationId: string,
  allowedRoles: readonly MembershipRole[] = ["org_owner", "org_admin", "member"],
): Promise<{ membershipId: string; role: MembershipRole }> {
  const [membership] = await transaction<{ id: string; role: MembershipRole }[]>`
    select id, role
    from memberships
    where organization_id = ${organizationId}
      and account_id = ${accountId}
      and status = 'active'
  `;
  if (membership === undefined || !allowedRoles.includes(membership.role)) {
    throw new AuthError("ORG_FORBIDDEN", "organization access is forbidden");
  }
  return { membershipId: membership.id, role: membership.role };
}
