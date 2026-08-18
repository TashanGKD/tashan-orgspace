import type { RedisClientType } from "redis";

const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`;

export interface RedisFixedWindowOptions {
  client: Pick<RedisClientType, "eval" | "pTTL">;
  namespace: string;
  maxAttempts: number;
  windowMilliseconds: number;
}

export class RedisFixedWindowRateLimiter {
  public constructor(private readonly options: RedisFixedWindowOptions) {
    if (options.namespace.trim() === "") throw new Error("rate-limit namespace is required");
    if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
      throw new Error("rate-limit maxAttempts must be a positive integer");
    }
    if (!Number.isInteger(options.windowMilliseconds) || options.windowMilliseconds < 1) {
      throw new Error("rate-limit window must be a positive integer");
    }
  }

  private redisKey(key: string): string {
    if (key.length === 0 || key.length > 512 || /[\r\n\0]/.test(key)) {
      throw new Error("rate-limit key is invalid");
    }
    return `${this.options.namespace}:${key}`;
  }

  public async consume(key: string): Promise<boolean> {
    const count = await this.options.client.eval(FIXED_WINDOW_SCRIPT, {
      keys: [this.redisKey(key)],
      arguments: [String(this.options.windowMilliseconds)],
    });
    if (typeof count !== "number") throw new Error("Redis rate limiter returned an invalid count");
    return count <= this.options.maxAttempts;
  }

  public timeToLive(key: string): Promise<number> {
    return this.options.client.pTTL(this.redisKey(key));
  }
}
