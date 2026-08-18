import postgres from "postgres";

import { loadWorkerConfig } from "./config.js";
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

let shutdownStarted = false;
async function shutdown(): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  await loop.stop();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  await loop.run();
} finally {
  await sql.end();
}
