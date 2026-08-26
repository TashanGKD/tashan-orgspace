import { AccountId, AuditEventId, DeviceId, OrganizationId } from "@tashan/contracts";

function organizationRoute(organizationId: string, suffix: string): string {
  const parsed = OrganizationId.parse(organizationId);
  return `/org/${encodeURIComponent(parsed)}/${suffix}`;
}

function organizationResourceRoute(
  organizationId: string,
  prefix: string,
  resourceId: string,
  parseResourceId: (value: string) => string,
): string {
  return organizationRoute(
    organizationId,
    `${prefix}/${encodeURIComponent(parseResourceId(resourceId))}`,
  );
}

export const routes = {
  login: "/login",
  organizations: "/organizations",
  account: "/account",
  device: (deviceId: string) => `/account/devices/${encodeURIComponent(DeviceId.parse(deviceId))}`,
  myWork: "/my-work",
  organizationHome: (organizationId: string) => organizationRoute(organizationId, "home"),
  organizationMembers: (organizationId: string) =>
    organizationRoute(organizationId, "admin/members"),
  organizationMember: (organizationId: string, accountId: string) =>
    organizationResourceRoute(organizationId, "admin/members", accountId, AccountId.parse),
  organizationAudit: (organizationId: string) => organizationRoute(organizationId, "admin/audit"),
  organizationAuditEvent: (organizationId: string, eventId: string) =>
    organizationResourceRoute(organizationId, "admin/audit", eventId, AuditEventId.parse),
} as const;
