import type { Command } from "commander";

import { CapabilityId, type CapabilityId as CapabilityIdType } from "@tashan/capabilities";

import type { CommandContext } from "./context.js";

export const capabilityCapabilityIds = [
  "system.health.read",
  "capability.list",
  "capability.describe",
] as const satisfies readonly CapabilityIdType[];

export function registerCapabilityCommands(program: Command, context: CommandContext): void {
  const health = program.command("health");
  health.action(async () => {
    const { client } = await context.runtime();
    const result = await client.health();
    context.emit(health, result, `${result.status} ${result.version}`);
  });

  const capability = program.command("capability").description("Inspect server capabilities");
  const list = capability.command("list");
  list.action(async () => {
    const { client } = await context.runtime();
    const result = await client.listCapabilities();
    context.emit(
      list,
      result,
      result.items.map((item) => `${item.id}\tv${item.version}`).join("\n"),
    );
  });

  const describe = capability.command("describe <capability-id>");
  describe.action(async (capabilityId: string) => {
    const { client } = await context.runtime();
    const result = await client.describeCapability(CapabilityId.parse(capabilityId));
    context.emit(describe, result, `${result.id}\n${result.cli}`);
  });
}
