import { AuthError } from "../../auth/auth-errors.js";
import { requireConversationAccess } from "../../chat/chat-authorization.js";
import type { CatalogRow, SearchProvider, SearchProviderContext } from "./provider.js";

export class MessageSearchProvider implements SearchProvider {
  public async authorize(context: SearchProviderContext, row: CatalogRow) {
    if (!row.authorization_scope_id) return false;
    try {
      await requireConversationAccess(
        context.tx,
        context.accountId,
        context.organizationId,
        row.authorization_scope_id,
      );
      return true;
    } catch (error) {
      if (error instanceof AuthError) return false;
      throw error;
    }
  }
}
