import type { Command } from "commander";

import type { CapabilityId } from "@tashan/capabilities";

import { requireConfirmationAndIdempotency, type CommandContext } from "./context.js";

export const spaceCapabilityIds = [
  "space.list",
  "space.read",
  "space.usage.read",
  "space.quota.set",
] as const satisfies readonly CapabilityId[];

export function registerSpaceCommands(program: Command, context: CommandContext): void {
  const space = program.command("space").description("Personal and organization file spaces");
  space.action(() => context.output.stdout(space.helpInformation()));
  const list = space.command("list");
  list.action(async () => {
    const result = await (await context.runtime()).client.listSpaces();
    context.emit(list, result, result.items.map((item) => `${item.id}\t${item.type}`).join("\n"));
  });
  const read = space.command("get").requiredOption("--space <space-id>");
  read.action(async (options: { space: string }) => {
    const result = await (await context.runtime()).client.readSpace(options.space);
    context.emit(read, result, `${result.space.id}\t${result.space.type}`);
  });
  const usage = space.command("usage").requiredOption("--space <space-id>");
  usage.action(async (options: { space: string }) => {
    const result = await (await context.runtime()).client.readSpaceUsage(options.space);
    context.emit(usage, result, `${result.usedBytes}/${result.quotaBytes} bytes used`);
  });
  const quota = space
    .command("quota-set")
    .requiredOption("--org <organization-id>")
    .requiredOption("--account <account-id>")
    .requiredOption("--bytes <bytes>")
    .option("--yes")
    .option("--idempotency-key <key>");
  quota.action(
    async (options: {
      org: string;
      account: string;
      bytes: string;
      yes?: boolean;
      idempotencyKey?: string;
    }) => {
      const idempotencyKey = requireConfirmationAndIdempotency(context, options);
      const result = await (
        await context.runtime()
      ).client.setPersonalSpaceQuota(
        options.org,
        options.account,
        { quotaBytes: Number(options.bytes) },
        { idempotencyKey },
      );
      context.emit(quota, result, `Personal space quota set to ${result.space.quotaBytes} bytes`);
    },
  );
}
