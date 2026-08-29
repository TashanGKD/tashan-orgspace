import postgres from "postgres";

import { createInternalS3Client, S3FileMaintenanceStore } from "@tashan/object-store";

import { loadWorkerConfig } from "./config.js";
import { FileMaintenanceLoop } from "./files/file-maintenance-loop.js";
import { OutboxLoop, type OutboxHandler } from "./outbox-loop.js";

const config = loadWorkerConfig();
const sql = postgres(config.databaseUrl, {
  max: 5,
  connect_timeout: 10,
  idle_timeout: 20,
  prepare: false,
});
const handlers = new Map<string, OutboxHandler>([["capability.succeeded", async () => {}]]);
const loop = new OutboxLoop({
  sql,
  workerId: config.workerId,
  handlers,
  leaseMilliseconds: config.leaseMilliseconds,
  pollMilliseconds: config.pollMilliseconds,
  batchSize: config.batchSize,
});
const fileLoop =
  config.fileStorageEnabled && config.objectStore !== undefined
    ? new FileMaintenanceLoop({
        sql,
        workerId: `${config.workerId}:files`,
        objectStore: new S3FileMaintenanceStore(
          createInternalS3Client(config.objectStore),
          config.objectStore.bucket,
        ),
        leaseMilliseconds: config.leaseMilliseconds,
        pollMilliseconds: config.pollMilliseconds,
        batchSize: config.batchSize,
      })
    : undefined;

let shutdownStarted = false;
async function shutdown(): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  await Promise.all([loop.stop(), fileLoop?.stop()]);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  await Promise.all([loop.run(), fileLoop?.run()]);
} finally {
  await sql.end();
}
