import type { JSONValue } from "postgres";

import type { TransactionClient } from "../db/transaction.js";

export class OutboxRepository {
  public async append(
    transaction: TransactionClient,
    input: {
      eventType: string;
      payload: Record<string, JSONValue | undefined>;
      availableAt?: Date;
    },
  ) {
    const [event] = await transaction<{ id: string }[]>`
      insert into outbox_events (event_type, payload, available_at)
      values (
        ${input.eventType},
        ${transaction.json(input.payload)},
        ${input.availableAt ?? new Date()}
      )
      returning id
    `;
    if (event === undefined) throw new Error("outbox insert returned no row");
    return event;
  }
}
