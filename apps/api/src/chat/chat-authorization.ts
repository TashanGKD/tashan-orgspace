import { AuthError } from "../auth/auth-errors.js";
import type { TransactionClient } from "../db/transaction.js";
import { requireOrganizationMembership } from "../organizations/authorization.js";

export async function requireChatOrganizationMember(
  tx: TransactionClient,
  accountId: string,
  organizationId: string,
) {
  try {
    return await requireOrganizationMembership(tx, accountId, organizationId);
  } catch (error) {
    if (error instanceof AuthError && error.code === "ORG_FORBIDDEN") {
      throw new AuthError("CHAT_FORBIDDEN", "chat is unavailable");
    }
    throw error;
  }
}

export async function requireConversationAccess(
  tx: TransactionClient,
  accountId: string,
  organizationId: string,
  conversationId: string,
) {
  await requireChatOrganizationMember(tx, accountId, organizationId);
  const [row] = await tx<{ kind: "direct" | "group" }[]>`
    select conversation.kind from conversations conversation
    join conversation_members member on member.conversation_id=conversation.id
    where conversation.id=${conversationId} and conversation.organization_id=${organizationId}
      and member.account_id=${accountId} and member.left_at is null
  `;
  if (!row) throw new AuthError("CHAT_NOT_FOUND", "conversation was not found");
  return row;
}
