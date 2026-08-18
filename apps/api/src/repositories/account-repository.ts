import type { TransactionClient } from "../db/transaction.js";

export interface InsertAccountInput {
  username: string;
  passwordHash: string;
  phoneE164?: string;
}

export interface AccountRecord {
  id: string;
  username: string;
  phoneE164: string | null;
  phoneVerifiedAt: Date | null;
  status: "active" | "suspended";
}

export class AccountRepository {
  public async insert(
    transaction: TransactionClient,
    input: InsertAccountInput,
  ): Promise<AccountRecord> {
    const [account] = await transaction<
      {
        id: string;
        username: string;
        phone_e164: string | null;
        phone_verified_at: Date | null;
        status: "active" | "suspended";
      }[]
    >`
      insert into accounts (username, password_hash, phone_e164)
      values (${input.username}, ${input.passwordHash}, ${input.phoneE164 ?? null})
      returning id, username::text, phone_e164, phone_verified_at, status
    `;
    if (account === undefined) throw new Error("account insert returned no row");

    return {
      id: account.id,
      username: account.username,
      phoneE164: account.phone_e164,
      phoneVerifiedAt: account.phone_verified_at,
      status: account.status,
    };
  }

  public async findByUsername(
    transaction: TransactionClient,
    username: string,
  ): Promise<(AccountRecord & { passwordHash: string }) | undefined> {
    const [account] = await transaction<
      {
        id: string;
        username: string;
        password_hash: string;
        phone_e164: string | null;
        phone_verified_at: Date | null;
        status: "active" | "suspended";
      }[]
    >`
      select id, username::text, password_hash, phone_e164, phone_verified_at, status
      from accounts
      where username = ${username}
    `;
    if (account === undefined) return undefined;

    return {
      id: account.id,
      username: account.username,
      passwordHash: account.password_hash,
      phoneE164: account.phone_e164,
      phoneVerifiedAt: account.phone_verified_at,
      status: account.status,
    };
  }
}
