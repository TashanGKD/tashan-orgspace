import type { Command } from "commander";
import type { CapabilityId } from "@tashan/capabilities";
import type { CommandContext } from "./context.js";

export const myWorkCapabilityIds = ["my.work.list"] as const satisfies readonly CapabilityId[];
export function registerMyWorkCommands(program: Command, context: CommandContext) {
  const myWork = program.command("my-work").description("Work assigned to the current account");
  myWork.action(() => context.output.stdout(myWork.helpInformation()));
  const list = myWork.command("list").option("--kind <kind>");
  list.action(async (options: { kind?: string }) => {
    const result = await (
      await context.runtime()
    ).client.listMyWork({
      ...(options.kind ? { kind: options.kind } : {}),
    });
    context.emit(
      list,
      result,
      result.items
        .map((item) => `${item.kind}\t${item.organizationName}\t${item.title}\t${item.href}`)
        .join("\n"),
    );
  });
}
