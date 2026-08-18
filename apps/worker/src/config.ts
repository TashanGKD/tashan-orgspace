import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { z } from "zod";

function required(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]?.trim();
  if (value === undefined || value === "") throw new Error(`${key} is required`);
  return value;
}

export function loadWorkerConfig(environment: NodeJS.ProcessEnv = process.env) {
  return {
    databaseUrl: required(environment, "DATABASE_URL"),
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
