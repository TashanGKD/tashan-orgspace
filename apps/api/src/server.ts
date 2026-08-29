import { importPKCS8, importSPKI } from "jose";
import { createClient } from "redis";
import {
  createInternalS3Client,
  createPresignS3Client,
  S3FileDataStore,
} from "@tashan/object-store";

import { AccessTokenService } from "./auth/access-token.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabaseClient } from "./db/client.js";
import { AliyunVerificationCodeSender } from "./phone/aliyun-verification-code-sender.js";
import { UnavailableVerificationCodeSender } from "./phone/verification-code-sender.js";
import { RedisFixedWindowRateLimiter } from "./rate-limit/redis-fixed-window.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.objectStore === undefined) {
    throw new Error("FILE_STORAGE_ENABLED=true is required for the file capability server");
  }
  const sql = createDatabaseClient(config.databaseUrl);
  const redis = createClient({ url: config.redisUrl });
  await redis.connect();
  const privateKey = await importPKCS8(config.jwt.privateKeyPem, "EdDSA");
  const publicKey = await importSPKI(config.jwt.publicKeyPem, "EdDSA");
  const tokenService = new AccessTokenService({
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
    activeKeyId: config.jwt.activeKeyId,
    privateKey,
    publicKeys: new Map([[config.jwt.activeKeyId, publicKey]]),
  });
  const app = await buildApp({
    sql,
    tokenService,
    serviceVersion: config.serviceVersion,
    phoneSender:
      config.phone.provider === "aliyun"
        ? new AliyunVerificationCodeSender(config.phone)
        : new UnavailableVerificationCodeSender(),
    loginRateLimiter: new RedisFixedWindowRateLimiter({
      client: redis,
      namespace: "orgspace:login",
      maxAttempts: 10,
      windowMilliseconds: 15 * 60 * 1000,
    }),
    phoneRateLimiter: new RedisFixedWindowRateLimiter({
      client: redis,
      namespace: "orgspace:phone",
      maxAttempts: 5,
      windowMilliseconds: 60 * 60 * 1000,
    }),
    phoneCodePepper: config.phoneCodePepper,
    trustedProxyCidrs: config.trustedProxyCidrs,
    corsOrigins: config.corsOrigins,
    fileDataStore: new S3FileDataStore({
      internalClient: createInternalS3Client(config.objectStore),
      presignClient: createPresignS3Client(config.objectStore),
      bucket: config.objectStore.bucket,
    }),
    ...(config.partnerSecurity.enabled
      ? {
          partnerSecurity: {
            activeKeyVersion: config.partnerSecurity.activeKeyVersion,
            fieldKeys: config.partnerSecurity.fieldKeys,
            blindIndexKey: config.partnerSecurity.blindIndexKey,
          },
        }
      : {}),
  });

  const shutdown = async () => {
    await app.close();
    await Promise.all([redis.close(), sql.end()]);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  await app.listen({ host: config.host, port: config.port });
}

await main();
