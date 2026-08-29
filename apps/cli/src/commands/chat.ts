import type { Command } from "commander";
import type { CapabilityId } from "@tashan/capabilities";
import {
  requireConfirmationAndIdempotency,
  requireIdempotency,
  type CommandContext,
} from "./context.js";

export const chatCapabilityIds = [
  "chat.conversation.list",
  "chat.conversation.read",
  "chat.conversation.direct.create",
  "chat.conversation.group.create",
  "chat.message.list",
  "chat.message.send",
  "chat.message.edit",
  "chat.message.retract",
  "chat.message.reaction.set",
  "chat.event.list",
  "chat.message.convert",
  "chat.compliance.create",
  "chat.compliance.read",
] as const satisfies readonly CapabilityId[];

export function registerChatCommands(program: Command, context: CommandContext) {
  const chat = program.command("chat").description("Organization conversations");
  chat.action(() => context.output.stdout(chat.helpInformation()));
  const conversation = chat.command("conversation");
  const list = conversation.command("list").requiredOption("--org <id>");
  list.action(async (options: { org: string }) => {
    const result = await (await context.runtime()).client.listConversations(options.org);
    context.emit(
      list,
      result,
      result.items.map((item) => `${item.id}\t${item.title ?? "私聊"}`).join("\n"),
    );
  });
  const get = conversation
    .command("get")
    .requiredOption("--org <id>")
    .requiredOption("--conversation <id>");
  get.action(async (options: { org: string; conversation: string }) => {
    const result = await (
      await context.runtime()
    ).client.readConversation(options.org, options.conversation);
    context.emit(get, result, `${result.id}\t${result.title ?? "私聊"}`);
  });
  const direct = conversation
    .command("direct-create")
    .requiredOption("--org <id>")
    .requiredOption("--account <id>")
    .option("--yes")
    .option("--idempotency-key <key>");
  direct.action(
    async (options: { org: string; account: string; yes?: boolean; idempotencyKey?: string }) => {
      const key = requireConfirmationAndIdempotency(context, options);
      const result = await (
        await context.runtime()
      ).client.createDirectConversation(
        options.org,
        { accountId: options.account },
        { idempotencyKey: key },
      );
      context.emit(direct, result, `Conversation ${result.id}`);
    },
  );
  const group = conversation
    .command("group-create")
    .requiredOption("--org <id>")
    .requiredOption("--title <title>")
    .requiredOption("--member <account-id...>")
    .option("--yes")
    .option("--idempotency-key <key>");
  group.action(
    async (options: {
      org: string;
      title: string;
      member: string[];
      yes?: boolean;
      idempotencyKey?: string;
    }) => {
      const key = requireConfirmationAndIdempotency(context, options);
      const result = await (
        await context.runtime()
      ).client.createGroupConversation(
        options.org,
        { title: options.title, memberAccountIds: options.member },
        { idempotencyKey: key },
      );
      context.emit(group, result, `Conversation ${result.id}`);
    },
  );

  const message = chat.command("message");
  const messages = message
    .command("list")
    .requiredOption("--org <id>")
    .requiredOption("--conversation <id>")
    .option("--after <sequence>", "server sequence", "0");
  messages.action(async (options: { org: string; conversation: string; after: string }) => {
    const result = await (
      await context.runtime()
    ).client.listChatMessages(options.org, options.conversation, {
      afterSequence: Number(options.after),
    });
    context.emit(
      messages,
      result,
      result.items
        .map((item) => `${item.sequence}\t${item.senderAccountId}\t${item.body ?? "[已撤回]"}`)
        .join("\n"),
    );
  });
  const send = message
    .command("send")
    .requiredOption("--org <id>")
    .requiredOption("--conversation <id>")
    .requiredOption("--body <text>")
    .option("--reply-to <message-id>")
    .option("--attachments <json>", "file and work attachments", "[]")
    .option("--mention <account-id...>")
    .option("--client-message-id <id>")
    .option("--idempotency-key <key>");
  send.action(
    async (options: {
      org: string;
      conversation: string;
      body: string;
      replyTo?: string;
      attachments: string;
      mention?: string[];
      clientMessageId?: string;
      idempotencyKey?: string;
    }) => {
      const key = requireIdempotency(context, options.idempotencyKey);
      const result = await (
        await context.runtime()
      ).client.sendChatMessage(
        options.org,
        options.conversation,
        {
          clientMessageId: options.clientMessageId ?? crypto.randomUUID(),
          body: options.body,
          attachments: JSON.parse(options.attachments),
          mentionAccountIds: options.mention ?? [],
          ...(options.replyTo ? { replyToMessageId: options.replyTo } : {}),
        },
        { idempotencyKey: key },
      );
      context.emit(send, result, `${result.sequence}\t${result.id}`);
    },
  );
  const edit = message
    .command("edit")
    .requiredOption("--org <id>")
    .requiredOption("--conversation <id>")
    .requiredOption("--message <id>")
    .requiredOption("--body <text>")
    .option("--idempotency-key <key>");
  edit.action(
    async (options: {
      org: string;
      conversation: string;
      message: string;
      body: string;
      idempotencyKey?: string;
    }) => {
      const key = requireIdempotency(context, options.idempotencyKey);
      const result = await (
        await context.runtime()
      ).client.editChatMessage(
        options.org,
        options.conversation,
        options.message,
        { body: options.body },
        { idempotencyKey: key },
      );
      context.emit(edit, result, `Edited ${result.id}`);
    },
  );
  const retract = message
    .command("retract")
    .requiredOption("--org <id>")
    .requiredOption("--conversation <id>")
    .requiredOption("--message <id>")
    .option("--yes")
    .option("--idempotency-key <key>");
  retract.action(
    async (options: {
      org: string;
      conversation: string;
      message: string;
      yes?: boolean;
      idempotencyKey?: string;
    }) => {
      const key = requireConfirmationAndIdempotency(context, options);
      const result = await (
        await context.runtime()
      ).client.retractChatMessage(options.org, options.conversation, options.message, {
        idempotencyKey: key,
      });
      context.emit(retract, result, `Retracted ${result.id}`);
    },
  );
  const reaction = message
    .command("reaction")
    .requiredOption("--org <id>")
    .requiredOption("--conversation <id>")
    .requiredOption("--message <id>")
    .requiredOption("--emoji <emoji>")
    .requiredOption("--active <true|false>")
    .option("--idempotency-key <key>");
  reaction.action(
    async (options: {
      org: string;
      conversation: string;
      message: string;
      emoji: string;
      active: string;
      idempotencyKey?: string;
    }) => {
      if (!["true", "false"].includes(options.active))
        context.usage("--active must be true or false");
      const key = requireIdempotency(context, options.idempotencyKey);
      const result = await (
        await context.runtime()
      ).client.setChatReaction(
        options.org,
        options.conversation,
        options.message,
        { emoji: options.emoji, active: options.active === "true" },
        { idempotencyKey: key },
      );
      context.emit(reaction, result, `${result.emoji}\t${result.active ? "active" : "removed"}`);
    },
  );
  const convert = message
    .command("convert")
    .requiredOption("--org <id>")
    .requiredOption("--conversation <id>")
    .requiredOption("--message <id>")
    .requiredOption("--type <task|meeting|approval>")
    .requiredOption("--title <title>")
    .option("--assignee <account-id...>")
    .option("--due-at <iso>")
    .option("--starts-at <iso>")
    .option("--send-sms")
    .option("--yes")
    .option("--idempotency-key <key>");
  convert.action(async (options: Record<string, unknown>) => {
    const key = requireConfirmationAndIdempotency(context, options);
    const result = await (
      await context.runtime()
    ).client.convertChatMessage(
      String(options.org),
      String(options.conversation),
      String(options.message),
      {
        type: options.type,
        title: options.title,
        assigneeAccountIds: options.assignee ?? [],
        ...(options.dueAt ? { dueAt: options.dueAt } : {}),
        ...(options.startsAt ? { meetingStartsAt: options.startsAt } : {}),
        sendSms: options.sendSms === true,
      },
      { idempotencyKey: key },
    );
    context.emit(convert, result, `Created ${result.item.type} ${result.item.id}`);
  });
  const events = chat
    .command("event")
    .command("list")
    .requiredOption("--org <id>")
    .requiredOption("--conversation <id>")
    .option("--after <sequence>", "server sequence", "0");
  events.action(async (options: { org: string; conversation: string; after: string }) => {
    const result = await (
      await context.runtime()
    ).client.listChatEvents(options.org, options.conversation, {
      afterSequence: Number(options.after),
    });
    context.emit(
      events,
      result,
      result.items.map((item) => `${item.sequence}\t${item.eventType}`).join("\n"),
    );
  });
  const compliance = chat.command("compliance");
  const complianceCreate = compliance
    .command("create")
    .requiredOption("--org <id>")
    .requiredOption("--conversation <id>")
    .requiredOption("--reason <text>")
    .requiredOption("--starts-at <iso>")
    .requiredOption("--ends-at <iso>")
    .option("--yes")
    .option("--idempotency-key <key>");
  complianceCreate.action(async (options: Record<string, unknown>) => {
    const key = requireConfirmationAndIdempotency(context, options);
    const result = await (
      await context.runtime()
    ).client.createChatComplianceReview(
      String(options.org),
      {
        conversationId: options.conversation,
        reason: options.reason,
        startsAt: options.startsAt,
        endsAt: options.endsAt,
      },
      { idempotencyKey: key },
    );
    context.emit(complianceCreate, result, `Compliance review ${result.id}`);
  });
  const complianceGet = compliance
    .command("get")
    .requiredOption("--org <id>")
    .requiredOption("--review <id>");
  complianceGet.action(async (options: { org: string; review: string }) => {
    const result = await (
      await context.runtime()
    ).client.readChatComplianceReview(options.org, options.review);
    context.emit(
      complianceGet,
      result,
      result.events.map((event) => `${event.sequence}\t${event.eventType}`).join("\n"),
    );
  });
}
