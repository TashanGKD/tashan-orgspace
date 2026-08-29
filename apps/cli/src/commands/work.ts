import type { Command } from "commander";

import type { CapabilityId } from "@tashan/capabilities";

import { requireConfirmationAndIdempotency, type CommandContext } from "./context.js";

export const workCapabilityIds = [
  "work.item.list",
  "work.item.read",
  "work.item.create",
  "task.create",
  "meeting.create",
  "approval.create",
  "work.item.assign",
  "work.assignment.dispute",
  "work.assignment.transfer.request",
  "work.assignment.transfer.approve",
  "work.item.complete",
  "work.item.reopen",
  "work.item.cancel",
  "process.definition.create",
  "process.version.create",
  "process.version.publish",
  "process.instance.start",
  "process.instance.read",
  "process.instance.decide",
] as const satisfies readonly CapabilityId[];

export function registerWorkCommands(program: Command, context: CommandContext): void {
  const work = program.command("work").description("Organization work items");
  work.action(() => context.output.stdout(work.helpInformation()));
  const list = work
    .command("list")
    .requiredOption("--org <id>")
    .option("--type <type>")
    .option("--status <status>");
  list.action(async (o: { org: string; type?: string; status?: string }) => {
    const result = await (
      await context.runtime()
    ).client.listWorkItems(o.org, {
      ...(o.type === undefined ? {} : { type: o.type }),
      ...(o.status === undefined ? {} : { status: o.status }),
    });
    context.emit(list, result, result.items.map((item) => `${item.id}\t${item.title}`).join("\n"));
  });
  const get = work.command("get").requiredOption("--org <id>").requiredOption("--work <id>");
  get.action(async (o: { org: string; work: string }) => {
    const result = await (await context.runtime()).client.readWorkItem(o.org, o.work);
    context.emit(get, result, `${result.item.id}\t${result.item.title}`);
  });

  const create = work
    .command("create")
    .requiredOption("--org <id>")
    .requiredOption("--type <type>")
    .requiredOption("--title <title>")
    .option("--description <text>", "", "")
    .option("--priority <priority>", "", "normal")
    .option("--due-at <iso>")
    .option("--starts-at <iso>")
    .option("--assignee <account-id...>")
    .option("--yes")
    .option("--idempotency-key <key>");
  create.action(async (o: Record<string, unknown>) => createItem(create, o, context));

  const transition = (name: string, action: string, configure?: (command: Command) => Command) => {
    let command = work
      .command(name)
      .requiredOption("--org <id>")
      .requiredOption("--work <id>")
      .requiredOption("--expected-version <n>");
    command = configure?.(command) ?? command;
    command.option("--yes").option("--idempotency-key <key>");
    command.action(async (o: Record<string, unknown>) => {
      const key = requireConfirmationAndIdempotency(context, o);
      const result = await (
        await context.runtime()
      ).client.transitionWorkItem(
        String(o.org),
        String(o.work),
        {
          action,
          expectedVersion: Number(o.expectedVersion),
          ...(o.account === undefined ? {} : { accountId: o.account }),
          ...(o.assignment === undefined ? {} : { assignmentId: o.assignment }),
          ...(o.target === undefined ? {} : { targetAccountId: o.target }),
          ...(o.reason === undefined ? {} : { reason: o.reason }),
        },
        { idempotencyKey: key },
      );
      context.emit(command, result, `${result.item.status}\t${result.item.version}`);
    });
  };
  transition("assign", "assign", (c) => c.requiredOption("--account <id>"));
  transition("dispute", "dispute", (c) =>
    c.requiredOption("--assignment <id>").requiredOption("--reason <text>"),
  );
  transition("transfer-request", "request_transfer", (c) =>
    c
      .requiredOption("--assignment <id>")
      .requiredOption("--target <id>")
      .requiredOption("--reason <text>"),
  );
  transition("transfer-approve", "approve_transfer", (c) => c.requiredOption("--assignment <id>"));
  transition("complete", "complete");
  transition("reopen", "reopen");
  transition("cancel", "cancel");

  for (const type of ["task", "meeting", "approval"] as const) {
    const group = program.command(type).description(`${type} commands`);
    group.action(() => context.output.stdout(group.helpInformation()));
    const aliasCreate = group
      .command("create")
      .requiredOption("--org <id>")
      .requiredOption("--title <title>")
      .option("--description <text>", "", "")
      .option("--priority <priority>", "", "normal")
      .option("--due-at <iso>")
      .option("--starts-at <iso>")
      .option("--assignee <account-id...>")
      .option("--yes")
      .option("--idempotency-key <key>");
    aliasCreate.action(async (o: Record<string, unknown>) =>
      createItem(aliasCreate, { ...o, type }, context),
    );
  }

  registerProcessCommands(program, context);
}

async function createItem(command: Command, o: Record<string, unknown>, context: CommandContext) {
  const key = requireConfirmationAndIdempotency(context, o);
  const client = (await context.runtime()).client;
  const input = {
    type: o.type,
    title: o.title,
    description: o.description,
    priority: o.priority,
    assigneeAccountIds: o.assignee ?? [],
    ...(o.dueAt === undefined ? {} : { dueAt: o.dueAt }),
    ...(o.startsAt === undefined ? {} : { meetingStartsAt: o.startsAt }),
  };
  const create =
    o.type === "task"
      ? client.createTask
      : o.type === "meeting"
        ? client.createMeeting
        : o.type === "approval"
          ? client.createApproval
          : client.createWorkItem;
  const result = await create(String(o.org), input, { idempotencyKey: key });
  context.emit(command, result, `Created ${result.item.title}`);
}

function registerProcessCommands(program: Command, context: CommandContext) {
  const process = program.command("process").description("Approval process commands");
  process.action(() => context.output.stdout(process.helpInformation()));
  const mutation = (
    command: Command,
    work: (o: Record<string, unknown>, key: string) => Promise<unknown>,
  ) => {
    command.option("--yes").option("--idempotency-key <key>");
    command.action(async (o: Record<string, unknown>) => {
      const key = requireConfirmationAndIdempotency(context, o);
      const result = await work(o, key);
      context.emit(command, result, "Process updated");
    });
  };
  mutation(
    process
      .command("definition-create")
      .requiredOption("--org <id>")
      .requiredOption("--name <name>")
      .requiredOption("--mode <mode>")
      .requiredOption("--approver <id...>"),
    async (o, key) =>
      (await context.runtime()).client.createProcessDefinition(
        String(o.org),
        { name: o.name, mode: o.mode, approverAccountIds: o.approver },
        { idempotencyKey: key },
      ),
  );
  mutation(
    process
      .command("version-create")
      .requiredOption("--org <id>")
      .requiredOption("--definition <id>")
      .requiredOption("--mode <mode>")
      .requiredOption("--approver <id...>")
      .requiredOption("--expected-version <n>"),
    async (o, key) =>
      (await context.runtime()).client.createProcessVersion(
        String(o.org),
        String(o.definition),
        {
          mode: o.mode,
          approverAccountIds: o.approver,
          expectedDefinitionVersion: Number(o.expectedVersion),
        },
        { idempotencyKey: key },
      ),
  );
  mutation(
    process
      .command("version-publish")
      .requiredOption("--org <id>")
      .requiredOption("--version-id <id>"),
    async (o, key) =>
      (await context.runtime()).client.publishProcessVersion(String(o.org), String(o.versionId), {
        idempotencyKey: key,
      }),
  );
  mutation(
    process
      .command("start")
      .requiredOption("--org <id>")
      .requiredOption("--version-id <id>")
      .requiredOption("--subject <json>"),
    async (o, key) =>
      (await context.runtime()).client.startProcessInstance(
        String(o.org),
        String(o.versionId),
        { subject: JSON.parse(String(o.subject)) },
        { idempotencyKey: key },
      ),
  );
  const get = process.command("get").requiredOption("--org <id>").requiredOption("--instance <id>");
  get.action(async (o: { org: string; instance: string }) => {
    const result = await (await context.runtime()).client.readProcessInstance(o.org, o.instance);
    context.emit(get, result, `${result.instance.status}\t${result.instance.version}`);
  });
  mutation(
    process
      .command("decide")
      .requiredOption("--org <id>")
      .requiredOption("--instance <id>")
      .requiredOption("--action <action>")
      .requiredOption("--expected-version <n>")
      .option("--reason <text>")
      .option("--target <id>"),
    async (o, key) =>
      (await context.runtime()).client.decideProcessInstance(
        String(o.org),
        String(o.instance),
        {
          action: o.action,
          expectedVersion: Number(o.expectedVersion),
          ...(o.reason === undefined ? {} : { reason: o.reason }),
          ...(o.target === undefined ? {} : { targetAccountId: o.target }),
        },
        { idempotencyKey: key },
      ),
  );
}
