import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../../api/src/db/client.js";
import { migrateDatabase, resetTestDatabase } from "../../api/src/db/migrate.js";
import { OutboxLoop } from "./outbox-loop.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for worker integration tests");
}

let sql: DatabaseClient;
const now = new Date("2026-08-18T12:00:00.000Z");

beforeAll(async () => {
  await resetTestDatabase(testDatabaseUrl);
  await migrateDatabase(testDatabaseUrl);
  sql = createDatabaseClient(testDatabaseUrl);
}, 30_000);

beforeEach(async () => {
  await sql`truncate table outbox_events`;
});

afterAll(async () => {
  await sql?.end();
});

async function insertPendingEvent(eventType = "capability.succeeded") {
  const [event] = await sql<{ id: string }[]>`
    insert into outbox_events (event_type, payload, available_at)
    values (${eventType}, ${sql.json({ requestId: "request-1" })}, ${now})
    returning id
  `;
  if (event === undefined) throw new Error("failed to create outbox fixture");
  return event;
}

function worker(workerId: string, handlers = new Map([["capability.succeeded", vi.fn()]])) {
  return new OutboxLoop({
    sql,
    workerId,
    handlers,
    clock: () => now,
    leaseMilliseconds: 60_000,
    batchSize: 10,
  });
}

describe("recoverable outbox leasing", () => {
  test("reclaims an expired lease after worker crash", async () => {
    const event = await insertPendingEvent();
    await sql`
      update outbox_events
      set status = 'processing', lease_owner = 'dead-worker',
          lease_expires_at = ${new Date(now.getTime() - 10 * 60_000)}
      where id = ${event.id}
    `;

    await expect(worker("worker-b").claimBatch()).resolves.toEqual([
      expect.objectContaining({ id: event.id, leaseOwner: "worker-b" }),
    ]);
  });

  test("does not process an event twice while lease is live", async () => {
    const event = await insertPendingEvent();
    await sql`
      update outbox_events
      set status = 'processing', lease_owner = 'worker-a',
          lease_expires_at = ${new Date(now.getTime() + 60_000)}
      where id = ${event.id}
    `;

    await expect(worker("worker-b").claimBatch()).resolves.toEqual([]);
  });

  test("two concurrent workers claim a pending event at most once", async () => {
    const event = await insertPendingEvent();
    const [claimedA, claimedB] = await Promise.all([
      worker("worker-a").claimBatch(),
      worker("worker-b").claimBatch(),
    ]);

    expect([...claimedA, ...claimedB].map(({ id }) => id)).toEqual([event.id]);
  });

  test("moves an unknown event type to dead-letter with a stable reason", async () => {
    const event = await insertPendingEvent("unknown.future.event");
    const outbox = worker("worker-a", new Map());
    await outbox.processOnce();

    const [row] = await sql<{ status: string; last_error: string }[]>`
      select status, last_error from outbox_events where id = ${event.id}
    `;
    expect(row).toEqual({
      status: "dead_letter",
      last_error: "UNKNOWN_EVENT_TYPE:unknown.future.event",
    });
  });

  test("stop waits for the active handler and releases the remaining batch leases", async () => {
    const first = await insertPendingEvent();
    const second = await insertPendingEvent();
    let releaseHandler: (() => void) | undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const handler = vi.fn(async () => {
      markStarted?.();
      await handlerStarted;
    });
    const outbox = worker("worker-a", new Map([["capability.succeeded", handler]]));
    const processing = outbox.processOnce();
    await started;
    const stopping = outbox.stop();
    let stopped = false;
    void stopping.then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    releaseHandler?.();
    await Promise.all([processing, stopping]);

    expect(handler).toHaveBeenCalledTimes(1);
    const rows = await sql<{ status: string; lease_owner: string | null; count: number }[]>`
      select status, lease_owner, count(*)::int as count
      from outbox_events
      group by status, lease_owner
      order by status
    `;
    expect([first.id, second.id]).toHaveLength(2);
    expect(rows).toEqual([
      { status: "done", lease_owner: null, count: 1 },
      { status: "pending", lease_owner: null, count: 1 },
    ]);
  });
});
