import { writeFile } from "node:fs/promises";

import { generateKeyPair } from "jose";
import { createClient } from "redis";

import { buildApp } from "../../../apps/api/src/app.js";
import { AccessTokenService } from "../../../apps/api/src/auth/access-token.js";
import { createDatabaseClient } from "../../../apps/api/src/db/client.js";
import type { VerificationCodeSender } from "../../../apps/api/src/phone/verification-code-sender.js";
import { RedisFixedWindowRateLimiter } from "../../../apps/api/src/rate-limit/redis-fixed-window.js";

function required(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.trim() === "") throw new Error(`${key} is required`);
  return value;
}

function requireLoopback(raw: string, label: string): void {
  const host = new URL(raw).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    throw new Error(`E2E ${label} URL must use loopback`);
  }
}

class FileVerificationCodeSender implements VerificationCodeSender {
  public readonly available = true;
  private readonly messages: { phone: string; code: string; expiresAt: string }[] = [];

  public constructor(private readonly path: string) {}

  public async send(input: { phone: string; code: string; expiresAt: Date }): Promise<void> {
    this.messages.push({ ...input, expiresAt: input.expiresAt.toISOString() });
    await writeFile(this.path, JSON.stringify(this.messages), { encoding: "utf8", mode: 0o600 });
  }
}

const databaseUrl = required("E2E_DATABASE_URL");
const redisUrl = required("E2E_REDIS_URL");
const codeFile = required("E2E_CODE_FILE");
const namespace = required("E2E_RUN_ID");
requireLoopback(databaseUrl, "database");
requireLoopback(redisUrl, "Redis");

const sql = createDatabaseClient(databaseUrl);
const redis = createClient({ url: redisUrl });
await redis.connect();
const { privateKey, publicKey } = await generateKeyPair("EdDSA");
const tokenService = new AccessTokenService({
  issuer: "https://api-org.tashan.chat",
  audience: "tashan-orgspace",
  activeKeyId: `e2e-${namespace}`,
  privateKey,
  publicKeys: new Map([[`e2e-${namespace}`, publicKey]]),
});
const app = await buildApp({
  sql,
  tokenService,
  phoneSender: new FileVerificationCodeSender(codeFile),
  loginRateLimiter: new RedisFixedWindowRateLimiter({
    client: redis,
    namespace: `e2e:${namespace}:login`,
    maxAttempts: 100,
    windowMilliseconds: 60_000,
  }),
  phoneRateLimiter: new RedisFixedWindowRateLimiter({
    client: redis,
    namespace: `e2e:${namespace}:phone`,
    maxAttempts: 100,
    windowMilliseconds: 60_000,
  }),
  phoneCodePepper: "phase0-e2e-phone-code-pepper",
  trustedProxyCidrs: [],
  corsOrigins: ["http://127.0.0.1:4173"],
});

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await app.close();
  await Promise.all([redis.close(), sql.end()]);
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
const address = await app.listen({ host: "127.0.0.1", port: 0 });
process.stdout.write(`E2E_API_READY ${address}\n`);
