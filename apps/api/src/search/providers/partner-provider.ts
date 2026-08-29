import type { CatalogRow, SearchProvider, SearchProviderContext } from "./provider.js";

export class PartnerSearchProvider implements SearchProvider {
  public async authorize(context: SearchProviderContext, row: CatalogRow) {
    return (
      context.membershipRole === "org_owner" ||
      context.membershipRole === "org_admin" ||
      row.owner_account_id === context.accountId
    );
  }
}
