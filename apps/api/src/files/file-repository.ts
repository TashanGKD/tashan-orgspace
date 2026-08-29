import { AuthError } from "../auth/auth-errors.js";
import type { TransactionClient } from "../db/transaction.js";

export class FileRepository {
  public async revokeFolderGrant(
    transaction: TransactionClient,
    input: { folderId: string; accountId: string },
  ): Promise<void> {
    const [grant] = await transaction<{ role: "manager" | "editor" | "viewer" }[]>`
      select role from folder_grants
      where folder_id = ${input.folderId} and account_id = ${input.accountId}
      for update
    `;
    if (grant === undefined) return;
    if (grant.role === "manager") {
      const [managers] = await transaction<{ count: number }[]>`
        select count(*)::int as count from folder_grants
        where folder_id = ${input.folderId} and role = 'manager'
      `;
      if ((managers?.count ?? 0) <= 1) {
        throw new AuthError("FOLDER_LAST_MANAGER", "folder must retain a manager");
      }
    }
    await transaction`
      delete from folder_grants
      where folder_id = ${input.folderId} and account_id = ${input.accountId}
    `;
  }
}
