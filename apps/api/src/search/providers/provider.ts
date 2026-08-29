import { SearchHit, type SearchResourceType } from "@tashan/contracts";
import type { TransactionClient } from "../../db/transaction.js";

export interface CatalogRow {
  organization_id: string;
  resource_type: SearchResourceType;
  resource_id: string;
  resource_subtype: string | null;
  title: string;
  content: string;
  authorization_scope_id: string | null;
  owner_account_id: string | null;
}
export interface SearchProviderContext {
  tx: TransactionClient;
  accountId: string;
  organizationId: string;
  membershipRole: "org_owner" | "org_admin" | "member";
}
export interface SearchProvider {
  authorize(context: SearchProviderContext, row: CatalogRow): Promise<boolean>;
}
export function hit(row: CatalogRow, admin: boolean) {
  const org = encodeURIComponent(row.organization_id),
    id = encodeURIComponent(row.resource_id);
  const href =
    row.resource_type === "file"
      ? `/org/${org}/files/${id}`
      : row.resource_type === "work_item"
        ? `/org/${org}/${row.resource_subtype === "meeting" ? "meetings" : row.resource_subtype === "approval" ? "approvals" : "tasks"}/${id}`
        : row.resource_type === "objective"
          ? `/org/${org}/okr/${id}`
          : row.resource_type === "partner"
            ? `/org/${org}/partners/${id}`
            : row.resource_type === "message"
              ? `/org/${org}/messages/${encodeURIComponent(row.authorization_scope_id ?? "")}`
              : admin
                ? `/org/${org}/admin/members/${encodeURIComponent(row.owner_account_id ?? "")}`
                : `/org/${org}/home`;
  return SearchHit.parse({
    resource: {
      organizationId: row.organization_id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
    },
    type: row.resource_type,
    title: row.title,
    snippet: row.content.slice(0, 240),
    href,
  });
}
