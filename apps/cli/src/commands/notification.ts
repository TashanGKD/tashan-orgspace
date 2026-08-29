import type { Command } from "commander";
import type { CapabilityId } from "@tashan/capabilities";
import {
  requireConfirmationAndIdempotency,
  requireIdempotency,
  type CommandContext,
} from "./context.js";

export const notificationCapabilityIds = [
  "notification.list",
  "notification.read",
  "notification.mark.read",
  "notification.preference.read",
  "notification.preference.update",
  "notification.policy.read",
  "notification.policy.publish",
] as const satisfies readonly CapabilityId[];

export function registerNotificationCommands(program: Command, context: CommandContext) {
  const notification = program.command("notification").description("Notifications and reminders");
  notification.action(() => context.output.stdout(notification.helpInformation()));

  const list = notification
    .command("list")
    .requiredOption("--org <id>")
    .option("--status <unread|read>");
  list.action(async (options: { org: string; status?: string }) => {
    const result = await (
      await context.runtime()
    ).client.listNotifications(options.org, {
      ...(options.status ? { status: options.status } : {}),
    });
    context.emit(
      list,
      result,
      result.items.map((item) => `${item.id}\t${item.status}\t${item.title}`).join("\n"),
    );
  });

  const get = notification
    .command("get")
    .requiredOption("--org <id>")
    .requiredOption("--notification <id>");
  get.action(async (options: { org: string; notification: string }) => {
    const result = await (
      await context.runtime()
    ).client.readNotification(options.org, options.notification);
    context.emit(get, result, `${result.title}\n${result.body}`);
  });

  const markRead = notification
    .command("mark-read")
    .requiredOption("--org <id>")
    .requiredOption("--notification <id>")
    .option("--idempotency-key <key>");
  markRead.action(
    async (options: { org: string; notification: string; idempotencyKey?: string }) => {
      const key = requireIdempotency(context, options.idempotencyKey);
      const result = await (
        await context.runtime()
      ).client.markNotificationRead(options.org, options.notification, { idempotencyKey: key });
      context.emit(markRead, result, "Notification marked as read");
    },
  );

  const preferenceGet = notification.command("preference-get").requiredOption("--org <id>");
  preferenceGet.action(async (options: { org: string }) => {
    const result = await (await context.runtime()).client.readNotificationPreference(options.org);
    context.emit(
      preferenceGet,
      result,
      `Daily summary: ${result.dailySummaryEnabled ? "on" : "off"}`,
    );
  });

  const preferenceSet = notification
    .command("preference-set")
    .requiredOption("--org <id>")
    .requiredOption("--daily-summary <on|off>")
    .option("--yes")
    .option("--idempotency-key <key>");
  preferenceSet.action(
    async (options: {
      org: string;
      dailySummary: string;
      yes?: boolean;
      idempotencyKey?: string;
    }) => {
      if (!["on", "off"].includes(options.dailySummary)) {
        context.usage("--daily-summary must be on or off");
      }
      const key = requireConfirmationAndIdempotency(context, options);
      const result = await (
        await context.runtime()
      ).client.updateNotificationPreference(
        options.org,
        { dailySummaryEnabled: options.dailySummary === "on" },
        { idempotencyKey: key },
      );
      context.emit(
        preferenceSet,
        result,
        `Daily summary: ${result.dailySummaryEnabled ? "on" : "off"}`,
      );
    },
  );

  const policyGet = notification.command("policy-get").requiredOption("--org <id>");
  policyGet.action(async (options: { org: string }) => {
    const result = await (await context.runtime()).client.readNotificationPolicy(options.org);
    context.emit(policyGet, result, `${result.timezone}\tv${result.policyVersion}`);
  });

  const policyPublish = notification
    .command("policy-publish")
    .requiredOption("--org <id>")
    .requiredOption("--timezone <iana-timezone>")
    .requiredOption("--expected-version <n>")
    .option("--yes")
    .option("--idempotency-key <key>");
  policyPublish.action(
    async (options: {
      org: string;
      timezone: string;
      expectedVersion: string;
      yes?: boolean;
      idempotencyKey?: string;
    }) => {
      const key = requireConfirmationAndIdempotency(context, options);
      const result = await (
        await context.runtime()
      ).client.publishNotificationPolicy(
        options.org,
        { timezone: options.timezone, expectedVersion: Number(options.expectedVersion) },
        { idempotencyKey: key },
      );
      context.emit(policyPublish, result, `${result.timezone}\tv${result.policyVersion}`);
    },
  );
}
