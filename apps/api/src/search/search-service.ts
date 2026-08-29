import { SearchQuery, SearchResponse, type SearchResourceType } from "@tashan/contracts";
import type { TransactionClient } from "../db/transaction.js";
import { requireOrganizationMembership } from "../organizations/authorization.js";
import { FileSearchProvider } from "./providers/file-provider.js";
import { MessageSearchProvider } from "./providers/message-provider.js";
import { OrganizationSearchProvider } from "./providers/organization-provider.js";
import { PartnerSearchProvider } from "./providers/partner-provider.js";
import { hit, type CatalogRow, type SearchProvider } from "./providers/provider.js";

const allTypes: SearchResourceType[] = [
  "file",
  "work_item",
  "objective",
  "partner",
  "member",
  "message",
];
export class SearchService {
  private readonly providers: Record<SearchResourceType, SearchProvider> = {
    file: new FileSearchProvider(),
    work_item: new OrganizationSearchProvider(),
    objective: new OrganizationSearchProvider(),
    partner: new PartnerSearchProvider(),
    member: new OrganizationSearchProvider(),
    message: new MessageSearchProvider(),
  };
  public async search(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    raw: unknown,
  ) {
    const input = SearchQuery.parse(raw);
    const membership = await requireOrganizationMembership(tx, accountId, organizationId);
    const types = input.types ?? allTypes;
    const groups: Array<{ type: SearchResourceType; items: ReturnType<typeof hit>[] }> = [];
    let remaining = input.limit;
    for (const type of types) {
      if (remaining === 0) break;
      const candidates = await tx<CatalogRow[]>`
        select organization_id,resource_type,resource_id,resource_subtype,title,content,
          authorization_scope_id,owner_account_id
        from search_resource_catalog
        where organization_id=${organizationId} and resource_type=${type}
          and (strpos(lower(title),lower(${input.query}))>0 or strpos(lower(content),lower(${input.query}))>0)
        order by updated_at desc,resource_id limit ${Math.min(500, input.limit * 10)}
      `;
      const items = [];
      for (const row of candidates) {
        if (items.length >= remaining) break;
        if (
          await this.providers[type].authorize(
            {
              tx,
              accountId,
              organizationId,
              membershipRole: membership.role,
            },
            row,
          )
        )
          items.push(hit(row, membership.role === "org_owner" || membership.role === "org_admin"));
      }
      if (items.length > 0) groups.push({ type, items });
      remaining -= items.length;
    }
    return SearchResponse.parse({
      organizationId,
      query: input.query,
      groups,
      totalAuthorized: input.limit - remaining,
    });
  }
}
