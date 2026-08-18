import type postgres from "postgres";

export type DatabaseClient = ReturnType<typeof postgres>;

export interface OutboxEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempts: number;
  leaseOwner: string;
  leaseExpiresAt: Date;
}

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

export interface OutboxLoopOptions {
  sql: DatabaseClient;
  workerId: string;
  handlers: ReadonlyMap<string, OutboxHandler>;
  clock?: () => Date;
  leaseMilliseconds?: number;
  batchSize?: number;
  pollMilliseconds?: number;
  maxAttempts?: number;
}

interface ClaimedRow {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  lease_owner: string;
  lease_expires_at: Date;
}

export class OutboxLoop {
  private readonly clock: () => Date;
  private readonly leaseMilliseconds: number;
  private readonly batchSize: number;
  private readonly pollMilliseconds: number;
  private readonly maxAttempts: number;
  private stopping = false;
  private activeHandler: Promise<void> | undefined;
  private wakePoll: (() => void) | undefined;

  public constructor(private readonly options: OutboxLoopOptions) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(options.workerId)) {
      throw new Error("worker ID is invalid");
    }
    this.clock = options.clock ?? (() => new Date());
    this.leaseMilliseconds = options.leaseMilliseconds ?? 60_000;
    this.batchSize = options.batchSize ?? 10;
    this.pollMilliseconds = options.pollMilliseconds ?? 500;
    this.maxAttempts = options.maxAttempts ?? 10;
    for (const [name, value] of [
      ["leaseMilliseconds", this.leaseMilliseconds],
      ["batchSize", this.batchSize],
      ["pollMilliseconds", this.pollMilliseconds],
      ["maxAttempts", this.maxAttempts],
    ] as const) {
      if (!Number.isInteger(value) || value < 1)
        throw new Error(`${name} must be a positive integer`);
    }
  }

  public async claimBatch(): Promise<OutboxEvent[]> {
    if (this.stopping) return [];
    const now = this.clock();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseMilliseconds);
    const rows = await this.options.sql<ClaimedRow[]>`
      with candidates as (
        select id
        from outbox_events
        where available_at <= ${now}
          and (
            status = 'pending'
            or (status = 'processing' and lease_expires_at <= ${now})
          )
        order by available_at, created_at, id
        for update skip locked
        limit ${this.batchSize}
      )
      update outbox_events as events
      set
        status = 'processing',
        attempts = events.attempts + 1,
        lease_owner = ${this.options.workerId},
        lease_expires_at = ${leaseExpiresAt},
        updated_at = ${now}
      from candidates
      where events.id = candidates.id
      returning
        events.id, events.event_type, events.payload, events.attempts,
        events.lease_owner, events.lease_expires_at
    `;
    return rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      payload: row.payload,
      attempts: row.attempts,
      leaseOwner: row.lease_owner,
      leaseExpiresAt: row.lease_expires_at,
    }));
  }

  public async processOnce(): Promise<number> {
    const events = await this.claimBatch();
    let processed = 0;
    for (const event of events) {
      if (this.stopping) break;
      this.activeHandler = this.dispatch(event);
      try {
        await this.activeHandler;
      } finally {
        this.activeHandler = undefined;
      }
      processed += 1;
    }
    if (this.stopping) await this.releaseOwnedLeases();
    return processed;
  }

  public async run(): Promise<void> {
    while (!this.stopping) {
      const processed = await this.processOnce();
      if (processed === 0 && !this.stopping) await this.waitForPoll();
    }
  }

  public async stop(): Promise<void> {
    this.stopping = true;
    this.wakePoll?.();
    await this.activeHandler;
    await this.releaseOwnedLeases();
  }

  private async dispatch(event: OutboxEvent): Promise<void> {
    const handler = this.options.handlers.get(event.eventType);
    if (handler === undefined) {
      await this.finish(event.id, "dead_letter", `UNKNOWN_EVENT_TYPE:${event.eventType}`);
      return;
    }

    try {
      await handler(event);
      await this.finish(event.id, "done", null);
    } catch (error) {
      const reason = `HANDLER_FAILED:${error instanceof Error ? error.name : "UnknownError"}`;
      if (event.attempts >= this.maxAttempts) {
        await this.finish(event.id, "dead_letter", reason);
      } else {
        const retryAt = new Date(
          this.clock().getTime() + Math.min(60_000, 1000 * 2 ** event.attempts),
        );
        await this.options.sql`
          update outbox_events
          set status = 'pending', available_at = ${retryAt}, lease_owner = null,
              lease_expires_at = null, last_error = ${reason}, updated_at = ${this.clock()}
          where id = ${event.id} and status = 'processing'
            and lease_owner = ${this.options.workerId}
        `;
      }
    }
  }

  private async finish(
    eventId: string,
    status: "done" | "dead_letter",
    lastError: string | null,
  ): Promise<void> {
    await this.options.sql`
      update outbox_events
      set status = ${status}, lease_owner = null, lease_expires_at = null,
          last_error = ${lastError}, updated_at = ${this.clock()}
      where id = ${eventId} and status = 'processing'
        and lease_owner = ${this.options.workerId}
    `;
  }

  private async releaseOwnedLeases(): Promise<void> {
    await this.options.sql`
      update outbox_events
      set status = 'pending', lease_owner = null, lease_expires_at = null, updated_at = ${this.clock()}
      where status = 'processing' and lease_owner = ${this.options.workerId}
    `;
  }

  private async waitForPoll(): Promise<void> {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, this.pollMilliseconds);
      this.wakePoll = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
    this.wakePoll = undefined;
  }
}
