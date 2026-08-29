import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { parseObjectStoreConfig } from "@tashan/object-store";

const RuntimeEnvironment = z.enum(["development", "test", "production"]);

function required(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]?.trim();
  if (value === undefined || value === "") throw new Error(`${key} is required`);
  return value;
}

export function loadWorkerConfig(environment: NodeJS.ProcessEnv = process.env) {
  const runtime = RuntimeEnvironment.parse(environment.NODE_ENV ?? "development");
  const fileStorageEnabled = z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .parse(environment.FILE_STORAGE_ENABLED ?? "false");
  return {
    runtime,
    databaseUrl: required(environment, "DATABASE_URL"),
    fileStorageEnabled,
    objectStore: fileStorageEnabled
      ? parseObjectStoreConfig(
          {
            endpoint: required(environment, "S3_ENDPOINT"),
            publicOrigin: required(environment, "S3_PUBLIC_ORIGIN"),
            region: required(environment, "S3_REGION"),
            bucket: required(environment, "S3_BUCKET"),
            accessKeyId: required(environment, "S3_ACCESS_KEY_ID"),
            secretAccessKey: required(environment, "S3_SECRET_ACCESS_KEY"),
            forcePathStyle: z
              .enum(["true", "false"])
              .transform((value) => value === "true")
              .parse(required(environment, "S3_FORCE_PATH_STYLE")),
          },
          runtime,
        )
      : undefined,
    workerId: environment.WORKER_ID?.trim() || `${hostname()}-${process.pid}-${randomUUID()}`,
    leaseMilliseconds: z.coerce
      .number()
      .int()
      .min(1000)
      .max(15 * 60_000)
      .parse(environment.OUTBOX_LEASE_MILLISECONDS ?? 60_000),
    pollMilliseconds: z.coerce
      .number()
      .int()
      .min(50)
      .max(60_000)
      .parse(environment.OUTBOX_POLL_MILLISECONDS ?? 500),
    batchSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(environment.OUTBOX_BATCH_SIZE ?? 10),
  };
}
