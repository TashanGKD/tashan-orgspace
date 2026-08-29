import { AuthError } from "../../auth/auth-errors.js";
import { requireFilePermission } from "../../files/file-authorization.js";
import type { CatalogRow, SearchProvider, SearchProviderContext } from "./provider.js";

export class FileSearchProvider implements SearchProvider {
  public async authorize(context: SearchProviderContext, row: CatalogRow) {
    if (!row.authorization_scope_id) return false;
    try {
      await requireFilePermission(context.tx, {
        accountId: context.accountId,
        spaceId: row.authorization_scope_id,
        entryId: row.resource_id,
        permission: "metadata",
      });
      return true;
    } catch (error) {
      if (error instanceof AuthError) return false;
      throw error;
    }
  }
}
