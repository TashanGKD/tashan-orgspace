import type { TransactionSql } from "postgres";

import type { DatabaseClient } from "./client.js";

export type TransactionClient = TransactionSql;

export class UnitOfWork {
  public constructor(private readonly sql: DatabaseClient) {}

  public async run<T>(work: (transaction: TransactionClient) => Promise<T>): Promise<T> {
    return (await this.sql.begin(work)) as T;
  }
}
