import { open } from "node:fs/promises";
import type { Command } from "commander";
import type { CapabilityId } from "@tashan/capabilities";
import { requireConfirmationAndIdempotency, type CommandContext } from "./context.js";

export const partnerCapabilityIds = [
  "partner.list",
  "partner.read",
  "partner.create",
  "partner.update",
  "partner.archive",
  "partner.restore",
  "partner.transfer",
  "partner.bulk.transfer",
  "partner.duplicate.list",
  "partner.awaiting.owner.list",
  "partner.contact.read",
  "partner.interaction.list",
  "partner.interaction.add",
  "partner.interaction.correct",
  "partner.link.create",
  "partner.link.unlink",
  "partner.export",
] as const satisfies readonly CapabilityId[];
export function registerPartnerCommands(program: Command, context: CommandContext) {
  const partner = program.command("partner").description("Organization partner contacts");
  partner.action(() => context.output.stdout(partner.helpInformation()));
  const list = partner
    .command("list")
    .requiredOption("--org <id>")
    .option("--owner <self|all>", "scope", "self")
    .option("--admin-scope");
  list.action(async (o: { org: string; owner: string; adminScope?: boolean }) => {
    if (o.owner === "all" && !o.adminScope) context.usage("--owner all requires --admin-scope");
    const result = await (await context.runtime()).client.listPartners(o.org, { owner: o.owner });
    context.emit(
      list,
      result,
      result.items.map((x) => `${x.id}\t${x.name}\t${x.phoneMasked ?? ""}`).join("\n"),
    );
  });
  const get = partner.command("get").requiredOption("--org <id>").requiredOption("--partner <id>");
  get.action(async (o: { org: string; partner: string }) => {
    const r = await (await context.runtime()).client.readPartner(o.org, o.partner);
    context.emit(get, r, `${r.partner.name}\t${r.partner.organizationName ?? ""}`);
  });
  const contact = partner
    .command("contact")
    .requiredOption("--org <id>")
    .requiredOption("--partner <id>");
  contact.action(async (o: { org: string; partner: string }) => {
    const r = await (await context.runtime()).client.readPartnerContact(o.org, o.partner);
    context.emit(
      contact,
      r,
      `${r.partner.phone ?? ""}\t${r.partner.wechat ?? ""}\t${r.partner.email ?? ""}`,
    );
  });
  const mutation = (
    cmd: Command,
    fn: (o: Record<string, unknown>, key: string) => Promise<unknown>,
    text = "Partner updated",
  ) => {
    cmd.option("--yes").option("--idempotency-key <key>");
    cmd.action(async (o: Record<string, unknown>) => {
      const key = requireConfirmationAndIdempotency(context, o);
      const r = await fn(o, key);
      context.emit(cmd, r, text);
    });
  };
  mutation(
    partner.command("create").requiredOption("--org <id>").requiredOption("--data <json>"),
    async (o, k) =>
      (await context.runtime()).client.createPartner(String(o.org), JSON.parse(String(o.data)), {
        idempotencyKey: k,
      }),
    "Partner created",
  );
  mutation(
    partner
      .command("update")
      .requiredOption("--org <id>")
      .requiredOption("--partner <id>")
      .requiredOption("--patch <json>")
      .requiredOption("--expected-version <n>"),
    async (o, k) =>
      (await context.runtime()).client.updatePartner(
        String(o.org),
        String(o.partner),
        { ...JSON.parse(String(o.patch)), expectedVersion: Number(o.expectedVersion) },
        { idempotencyKey: k },
      ),
  );
  for (const action of ["archive", "restore"] as const)
    mutation(
      partner
        .command(action)
        .requiredOption("--org <id>")
        .requiredOption("--partner <id>")
        .requiredOption("--expected-version <n>"),
      async (o, k) =>
        (await context.runtime()).client[
          action === "archive" ? "archivePartner" : "restorePartner"
        ](
          String(o.org),
          String(o.partner),
          { expectedVersion: Number(o.expectedVersion) },
          { idempotencyKey: k },
        ),
    );
  mutation(
    partner
      .command("transfer")
      .requiredOption("--org <id>")
      .requiredOption("--partner <id>")
      .requiredOption("--account <id>")
      .requiredOption("--expected-version <n>"),
    async (o, k) =>
      (await context.runtime()).client.transferPartner(
        String(o.org),
        String(o.partner),
        { accountId: o.account, expectedVersion: Number(o.expectedVersion) },
        { idempotencyKey: k },
      ),
  );
  mutation(
    partner
      .command("bulk-transfer")
      .requiredOption("--org <id>")
      .requiredOption("--account <id>")
      .requiredOption("--items <json>"),
    async (o, k) =>
      (await context.runtime()).client.bulkTransferPartners(
        String(o.org),
        { accountId: o.account, items: JSON.parse(String(o.items)) },
        { idempotencyKey: k },
      ),
  );
  const duplicates = partner.command("duplicates").requiredOption("--org <id>");
  duplicates.action(async (o: { org: string }) => {
    const r = await (await context.runtime()).client.listPartnerDuplicates(o.org);
    context.emit(duplicates, r, JSON.stringify(r.groups));
  });
  const awaiting = partner.command("awaiting-owner").requiredOption("--org <id>");
  awaiting.action(async (o: { org: string }) => {
    const r = await (await context.runtime()).client.listAwaitingPartners(o.org);
    context.emit(awaiting, r, r.items.map((x) => `${x.id}\t${x.name}`).join("\n"));
  });
  const interaction = partner.command("interaction");
  const ilist = interaction
    .command("list")
    .requiredOption("--org <id>")
    .requiredOption("--partner <id>");
  ilist.action(async (o: { org: string; partner: string }) => {
    const r = await (await context.runtime()).client.listPartnerInteractions(o.org, o.partner);
    context.emit(ilist, r, r.items.map((x) => `${x.id}\t${x.summary}`).join("\n"));
  });
  mutation(
    interaction
      .command("add")
      .requiredOption("--org <id>")
      .requiredOption("--partner <id>")
      .requiredOption("--data <json>"),
    async (o, k) =>
      (await context.runtime()).client.addPartnerInteraction(
        String(o.org),
        String(o.partner),
        JSON.parse(String(o.data)),
        { idempotencyKey: k },
      ),
  );
  mutation(
    interaction
      .command("correct")
      .requiredOption("--org <id>")
      .requiredOption("--partner <id>")
      .requiredOption("--interaction <id>")
      .requiredOption("--data <json>"),
    async (o, k) =>
      (await context.runtime()).client.correctPartnerInteraction(
        String(o.org),
        String(o.partner),
        String(o.interaction),
        JSON.parse(String(o.data)),
        { idempotencyKey: k },
      ),
  );
  mutation(
    partner
      .command("link")
      .requiredOption("--org <id>")
      .requiredOption("--partner <id>")
      .requiredOption("--data <json>"),
    async (o, k) =>
      (await context.runtime()).client.linkPartnerResource(
        String(o.org),
        String(o.partner),
        JSON.parse(String(o.data)),
        { idempotencyKey: k },
      ),
  );
  mutation(
    partner
      .command("unlink")
      .requiredOption("--org <id>")
      .requiredOption("--partner <id>")
      .requiredOption("--link <id>"),
    async (o, k) =>
      (await context.runtime()).client.unlinkPartnerResource(
        String(o.org),
        String(o.partner),
        String(o.link),
        { idempotencyKey: k },
      ),
  );
  const exp = partner
    .command("export")
    .requiredOption("--org <id>")
    .requiredOption("--owner <all>")
    .requiredOption("--output <path>")
    .option("--yes")
    .option("--idempotency-key <key>");
  exp.action(
    async (o: {
      org: string;
      owner: string;
      output: string;
      yes?: boolean;
      idempotencyKey?: string;
    }) => {
      if (o.owner !== "all") context.usage("partner export requires --owner all");
      const key = requireConfirmationAndIdempotency(context, o);
      const r = await (
        await context.runtime()
      ).client.exportPartners(o.org, { owner: "all", format: "csv" }, { idempotencyKey: key });
      const file = await open(o.output, "wx", 0o600);
      try {
        await file.writeFile(r.content, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      context.emit(exp, { count: r.count, output: o.output }, `Exported ${r.count} partners`);
    },
  );
}
