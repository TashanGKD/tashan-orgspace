import type { TransactionClient } from "../db/transaction.js";

export interface InsertSessionInput {
  accountId: string;
  principalId: string;
  deviceId: string;
  refreshTokenHash: string;
  tokenVersion: number;
  clientChannel: "web" | "cli";
  expiresAt: Date;
}

export class SessionRepository {
  public async insert(transaction: TransactionClient, input: InsertSessionInput) {
    const [session] = await transaction<{ id: string }[]>`
      insert into sessions (
        account_id, principal_id, device_id, refresh_token_hash,
        token_version, client_channel, expires_at
      ) values (
        ${input.accountId}, ${input.principalId}, ${input.deviceId}, ${input.refreshTokenHash},
        ${input.tokenVersion}, ${input.clientChannel}, ${input.expiresAt}
      )
      returning id
    `;
    if (session === undefined) throw new Error("session insert returned no row");
    return session;
  }

  public async revoke(transaction: TransactionClient, sessionId: string): Promise<boolean> {
    const rows = await transaction<{ id: string }[]>`
      update sessions
      set revoked_at = coalesce(revoked_at, now()), updated_at = now(), token_version = token_version + 1
      where id = ${sessionId} and revoked_at is null
      returning id
    `;
    return rows.length === 1;
  }
}
