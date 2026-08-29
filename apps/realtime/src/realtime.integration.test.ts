import { describe, expect, test, vi } from "vitest";
import { RealtimeCursorGapError, RealtimeCursorSubscription } from "./cursor.js";
import { DurableEventRelay } from "./relay.js";

describe("realtime cursor repair", () => {
  test("replays missed events from HTTP-truth storage on subscribe", async () => {
    const emitted: number[] = [];
    const subscription = new RealtimeCursorSubscription(0, {
      authorize: vi.fn(),
      load: vi.fn().mockResolvedValue([{ sequence: 1 }, { sequence: 2 }]),
      emit: (event) => {
        emitted.push(event.sequence);
      },
    });
    expect(await subscription.sync()).toBe(2);
    expect(emitted).toEqual([1, 2]);
  });
  test("repairs a Redis cursor gap and suppresses duplicate hints", async () => {
    const emitted: number[] = [];
    const load = vi.fn(async (after: number) =>
      [{ sequence: 3 }, { sequence: 4 }].filter((event) => event.sequence > after),
    );
    const subscription = new RealtimeCursorSubscription(2, {
      authorize: vi.fn(),
      load,
      emit: (event) => {
        emitted.push(event.sequence);
      },
    });
    expect(await subscription.sync(4)).toBe(2);
    expect(await subscription.sync(4)).toBe(0);
    expect(emitted).toEqual([3, 4]);
    expect(load).toHaveBeenCalledTimes(1);
  });
  test("fails closed when durable history cannot fill a hinted gap", async () => {
    const subscription = new RealtimeCursorSubscription(2, {
      authorize: vi.fn(),
      load: vi.fn().mockResolvedValue([{ sequence: 4 }]),
      emit: vi.fn(),
    });
    await expect(subscription.sync(4)).rejects.toBeInstanceOf(RealtimeCursorGapError);
  });
  test("rechecks authorization before every repair and blocks revoked membership", async () => {
    const authorize = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("membership revoked"));
    const subscription = new RealtimeCursorSubscription(0, {
      authorize,
      load: vi.fn().mockResolvedValueOnce([{ sequence: 1 }]),
      emit: vi.fn(),
    });
    expect(await subscription.sync()).toBe(1);
    await expect(subscription.sync(2)).rejects.toThrow("membership revoked");
  });
});

describe("durable Redis relay", () => {
  test("starts after persisted history and publishes each new row once across polls", async () => {
    const published: Array<{ conversationId: string; sequence: number }> = [];
    const rows = [
      { globalPosition: 3, conversationId: crypto.randomUUID(), sequence: 1 },
      { globalPosition: 4, conversationId: crypto.randomUUID(), sequence: 2 },
    ];
    const relay = new DurableEventRelay(2, {
      readAfter: async (position) => rows.filter((row) => row.globalPosition > position),
      publish: async (hint) => {
        published.push(hint);
      },
    });
    expect(await relay.processOnce()).toBe(2);
    expect(await relay.processOnce()).toBe(0);
    expect(relay.current()).toBe(4);
    expect(published).toEqual(
      rows.map(({ conversationId, sequence }) => ({ conversationId, sequence })),
    );
  });
});
