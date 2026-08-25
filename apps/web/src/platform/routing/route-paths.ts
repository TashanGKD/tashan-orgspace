import { OrganizationId } from "@tashan/contracts";

function organizationRoute(organizationId: string, suffix: string): string {
  const parsed = OrganizationId.parse(organizationId);
  return `/org/${encodeURIComponent(parsed)}/${suffix}`;
}

export const routes = {
  login: "/login",
  account: "/account",
  myWork: "/my-work",
  organizationHome: (organizationId: string) => organizationRoute(organizationId, "home"),
  organizationMembers: (organizationId: string) =>
    organizationRoute(organizationId, "admin/members"),
  organizationAudit: (organizationId: string) => organizationRoute(organizationId, "admin/audit"),
} as const;
