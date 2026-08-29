export function notificationCollectionPath(organizationId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/notifications`;
}
export function notificationItemPath(organizationId: string, notificationId: string) {
  return `${notificationCollectionPath(organizationId)}/${encodeURIComponent(notificationId)}`;
}
export function notificationPreferencePath(organizationId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/notification-preference`;
}
export function notificationPolicyPath(organizationId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/notification-policy`;
}
