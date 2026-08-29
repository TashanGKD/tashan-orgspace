import type { Command } from "commander";
import type { CapabilityId } from "@tashan/capabilities";
import { requireConfirmationAndIdempotency, type CommandContext } from "./context.js";

export const okrCapabilityIds = [
  "okr.objective.list",
  "okr.objective.read",
  "okr.objective.create",
  "okr.progress.update",
  "okr.change.request",
  "okr.change.approve",
  "okr.objective.edit.admin",
] as const satisfies readonly CapabilityId[];

export function registerOkrCommands(program: Command, context: CommandContext) {
  const okr = program.command("okr").description("Objectives and key results");
  okr.action(() => context.output.stdout(okr.helpInformation()));
  const list = okr
    .command("list")
    .requiredOption("--org <id>")
    .option("--cycle <cycle>")
    .option("--owner <account-id>");
  list.action(async (o: { org: string; cycle?: string; owner?: string }) => {
    const result = await (
      await context.runtime()
    ).client.listObjectives(o.org, {
      ...(o.cycle ? { cycle: o.cycle } : {}),
      ...(o.owner ? { ownerAccountId: o.owner } : {}),
    });
    context.emit(list, result, result.items.map((item) => `${item.id}\t${item.title}`).join("\n"));
  });
  const get = okr.command("get").requiredOption("--org <id>").requiredOption("--objective <id>");
  get.action(async (o: { org: string; objective: string }) => {
    const result = await (await context.runtime()).client.readObjective(o.org, o.objective);
    context.emit(get, result, `${result.objective.title}\t${result.objective.progress}`);
  });
  const mutation = (
    command: Command,
    work: (o: Record<string, unknown>, key: string) => Promise<unknown>,
  ) => {
    command.option("--yes").option("--idempotency-key <key>");
    command.action(async (o: Record<string, unknown>) => {
      const key = requireConfirmationAndIdempotency(context, o);
      const result = await work(o, key);
      context.emit(command, result, "OKR updated");
    });
  };
  mutation(
    okr
      .command("create")
      .requiredOption("--org <id>")
      .requiredOption("--title <title>")
      .requiredOption("--cycle <cycle>")
      .requiredOption("--key-results <json>"),
    async (o, key) =>
      (await context.runtime()).client.createObjective(
        String(o.org),
        { title: o.title, cycle: o.cycle, keyResults: JSON.parse(String(o.keyResults)) },
        { idempotencyKey: key },
      ),
  );
  mutation(
    okr
      .command("progress")
      .requiredOption("--org <id>")
      .requiredOption("--key-result <id>")
      .requiredOption("--value <number>")
      .requiredOption("--expected-version <n>"),
    async (o, key) =>
      (await context.runtime()).client.updateKeyResultProgress(
        String(o.org),
        String(o.keyResult),
        { progress: Number(o.value), expectedVersion: Number(o.expectedVersion) },
        { idempotencyKey: key },
      ),
  );
  mutation(
    okr
      .command("change-request")
      .requiredOption("--org <id>")
      .requiredOption("--objective <id>")
      .requiredOption("--patch <json>")
      .requiredOption("--expected-version <n>"),
    async (o, key) =>
      (await context.runtime()).client.requestOkrChange(
        String(o.org),
        String(o.objective),
        { patch: JSON.parse(String(o.patch)), expectedVersion: Number(o.expectedVersion) },
        { idempotencyKey: key },
      ),
  );
  mutation(
    okr
      .command("approve")
      .requiredOption("--org <id>")
      .requiredOption("--change-request <id>")
      .requiredOption("--expected-version <n>"),
    async (o, key) =>
      (await context.runtime()).client.approveOkrChange(
        String(o.org),
        String(o.changeRequest),
        { expectedObjectiveVersion: Number(o.expectedVersion) },
        { idempotencyKey: key },
      ),
  );
  mutation(
    okr
      .command("admin-edit")
      .requiredOption("--org <id>")
      .requiredOption("--objective <id>")
      .requiredOption("--patch <json>")
      .requiredOption("--expected-version <n>"),
    async (o, key) =>
      (await context.runtime()).client.adminEditObjective(
        String(o.org),
        String(o.objective),
        { patch: JSON.parse(String(o.patch)), expectedVersion: Number(o.expectedVersion) },
        { idempotencyKey: key },
      ),
  );
}
