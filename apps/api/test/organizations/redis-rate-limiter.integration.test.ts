import { randomUUID } from "node:crypto";

import { createClient, type RedisClientType } from "redis";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { RedisFixedWindowRateLimiter } from "../../src/rate-limit/redis-fixed-window.js";

const testRedisUrl = process.env.TEST_REDIS_URL;
if (testRedisUrl === undefined) {
  throw new Error("TEST_REDIS_URL is required for Redis integration tests");
}

let client: RedisClientType;
const namespaces: string[] = [];

beforeAll(async () => {
  client = createClient({ url: testRedisUrl });
  await client.connect();
});

afterAll(async () => {
  for (const namespace of namespaces) {
    const keys = await client.keys(`${namespace}:*`);
    if (keys.length > 0) await client.del(keys);
  }
  await client?.quit();
});

function limiter(maxAttempts: number) {
  const namespace = `orgspace-test:${randomUUID()}`;
  namespaces.push(namespace);
  return new RedisFixedWindowRateLimiter({
    client,
    namespace,
    maxAttempts,
    windowMilliseconds: 60_000,
  });
}

describe("Redis rate limiter", () => {
  test("allows only the configured number of attempts", async () => {
    const rateLimiter = limiter(2);

    await expect(rateLimiter.consume("login:username:alice")).resolves.toBe(true);
    await expect(rateLimiter.consume("login:username:alice")).resolves.toBe(true);
    await expect(rateLimiter.consume("login:username:alice")).resolves.toBe(false);
  });

  test("keeps concurrent increments atomic and attaches an expiry", async () => {
    const rateLimiter = limiter(3);
    const results = await Promise.all(
      Array.from({ length: 12 }, () => rateLimiter.consume("phone:number:+8613800138000")),
    );

    expect(results.filter(Boolean)).toHaveLength(3);
    await expect(rateLimiter.timeToLive("phone:number:+8613800138000")).resolves.toBeGreaterThan(0);
  });
});
