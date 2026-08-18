import type { Command } from "commander";

import type { CapabilityId } from "@tashan/capabilities";

import type { CommandContext } from "./context.js";

export const auditCapabilityIds = ["audit.list"] as const satisfies readonly CapabilityId[];

export function registerAuditCommands(program: Command, context: CommandContext): void {
  const audit = program.command("audit").description("Read append-only audit events");
  const list = audit
    .command("list")
    .requiredOption("--org <org-id>")
    .option("--cursor <cursor>")
    .option("--limit <number>", "maximum events", "25");
  list.action(async (options: { org: string; cursor?: string; limit: string }) => {
    const { client } = await context.runtime();
    const result = await client.listAuditEvents({
      organizationId: options.org,
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      limit: options.limit,
    });
    context.emit(
      list,
      result,
      result.items
        .map((item) => `${item.occurredAt}\t${item.capabilityId}\t${item.result}`)
        .join("\n") || "No audit events",
    );
  });
}
