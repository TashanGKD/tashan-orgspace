import type { TransactionClient } from "../db/transaction.js";

export interface InsertAccountInput {
  displayName: string;
  passwordHash: string;
  phoneE164: string;
  phoneVerifiedAt: Date;
}

export interface AccountRecord {
  id: string;
  displayName: string;
  phoneE164: string;
  phoneVerifiedAt: Date;
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
        display_name: string;
        phone_e164: string;
        phone_verified_at: Date;
        status: "active" | "suspended";
      }[]
    >`
      insert into accounts (display_name, password_hash, phone_e164, phone_verified_at)
      values (${input.displayName}, ${input.passwordHash}, ${input.phoneE164}, ${input.phoneVerifiedAt})
      returning id, display_name, phone_e164, phone_verified_at, status
    `;
    if (account === undefined) throw new Error("account insert returned no row");

    return {
      id: account.id,
      displayName: account.display_name,
      phoneE164: account.phone_e164,
      phoneVerifiedAt: account.phone_verified_at,
      status: account.status,
    };
  }

  public async findByPhone(
    transaction: TransactionClient,
    phoneE164: string,
  ): Promise<(AccountRecord & { passwordHash: string }) | undefined> {
    const [account] = await transaction<
      {
        id: string;
        display_name: string;
        password_hash: string;
        phone_e164: string;
        phone_verified_at: Date;
        status: "active" | "suspended";
      }[]
    >`
      select id, display_name, password_hash, phone_e164, phone_verified_at, status
      from accounts
      where phone_e164 = ${phoneE164}
    `;
    if (account === undefined) return undefined;

    return {
      id: account.id,
      displayName: account.display_name,
      passwordHash: account.password_hash,
      phoneE164: account.phone_e164,
      phoneVerifiedAt: account.phone_verified_at,
      status: account.status,
    };
  }
}
