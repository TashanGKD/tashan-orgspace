import postgres from "postgres";

import { createInternalS3Client, S3FileMaintenanceStore } from "@tashan/object-store";

import { loadWorkerConfig } from "./config.js";
import { FileMaintenanceLoop } from "./files/file-maintenance-loop.js";
import { OutboxLoop, type OutboxHandler } from "./outbox-loop.js";
import { NotificationProjector } from "./notifications/notification-projector.js";
import { ReminderScheduler } from "./notifications/reminder-scheduler.js";
import { AliyunSmsDelivery } from "./notifications/aliyun-delivery.js";
import { AliyunSmsProvider } from "./notifications/aliyun-sms-provider.js";
import { PostgresSmsDeliveryStore } from "./notifications/postgres-sms-delivery-store.js";
import { SmsDeliveryLoop } from "./notifications/sms-delivery-loop.js";

const config = loadWorkerConfig();
const sql = postgres(config.databaseUrl, {
  max: 5,
  connect_timeout: 10,
  idle_timeout: 20,
  prepare: false,
});
const notificationProjector = new NotificationProjector(sql);
const handlers = new Map<string, OutboxHandler>([
  ["capability.succeeded", async () => {}],
  [
    "domain.event",
    async (event) => {
      const domainEventId = event.payload.domainEventId;
      if (typeof domainEventId !== "string") throw new Error("domain event ID is missing");
      await notificationProjector.project(domainEventId);
    },
  ],
]);
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
const reminderScheduler = new ReminderScheduler({
  sql,
  workerId: `${config.workerId}:reminders`,
  pollMilliseconds: config.pollMilliseconds,
});
const smsLoop =
  config.smsDeliveryEnabled && config.sms !== undefined
    ? (() => {
        const store = new PostgresSmsDeliveryStore({
          sql,
          templateCode: config.sms.templateCode,
          templateParamKey: config.sms.templateParamKey,
        });
        return new SmsDeliveryLoop({
          sql,
          workerId: `${config.workerId}:sms`,
          pollMilliseconds: config.pollMilliseconds,
          delivery: new AliyunSmsDelivery({
            store,
            provider: new AliyunSmsProvider(config.sms),
          }),
        });
      })()
    : undefined;

let shutdownStarted = false;
async function shutdown(): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  reminderScheduler.stop();
  await Promise.all([loop.stop(), fileLoop?.stop(), smsLoop?.stop()]);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  await Promise.all([loop.run(), fileLoop?.run(), reminderScheduler.run(), smsLoop?.run()]);
} finally {
  await sql.end();
}
