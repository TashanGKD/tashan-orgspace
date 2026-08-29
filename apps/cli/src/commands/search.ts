import type { Command } from "commander";
import type { CapabilityId } from "@tashan/capabilities";
import type { CommandContext } from "./context.js";

export const searchCapabilityIds = ["search.query"] as const satisfies readonly CapabilityId[];
export function registerSearchCommands(program: Command, context: CommandContext) {
  const search = program.command("search").description("Search authorized organization content");
  search.action(() => context.output.stdout(search.helpInformation()));
  const query = search
    .command("query")
    .requiredOption("--org <id>")
    .requiredOption("--text <query>")
    .option("--type <type...>")
    .option("--limit <n>", "maximum authorized results", "30");
  query.action(async (options: { org: string; text: string; type?: string[]; limit: string }) => {
    const result = await (
      await context.runtime()
    ).client.searchOrganization(options.org, {
      query: options.text,
      limit: Number(options.limit),
      ...(options.type ? { types: options.type } : {}),
    });
    context.emit(
      query,
      result,
      result.groups
        .flatMap((group) => group.items)
        .map((item) => `${item.type}\t${item.title}\t${item.href}`)
        .join("\n"),
    );
  });
}
