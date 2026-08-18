import type { Command } from "commander";

import type { CapabilityId } from "@tashan/capabilities";

import { requireConfirmationAndIdempotency, type CommandContext } from "./context.js";

export const organizationCapabilityIds = [
  "organization.list",
  "organization.create",
  "organization.member.list",
  "organization.member.add",
] as const satisfies readonly CapabilityId[];

export function registerOrganizationCommands(program: Command, context: CommandContext): void {
  const organization = program.command("org").description("Organization commands");

  const list = organization.command("list");
  list.action(async () => {
    const { client } = await context.runtime();
    const result = await client.listOrganizations();
    context.emit(
      list,
      result,
      result.items.map((item) => `${item.id}\t${item.name}`).join("\n") || "No organizations",
    );
  });

  const create = organization
    .command("create")
    .requiredOption("--name <name>")
    .option("--yes")
    .option("--idempotency-key <key>");
  create.action(async (options: { name: string; yes?: boolean; idempotencyKey?: string }) => {
    const idempotencyKey = requireConfirmationAndIdempotency(context, options);
    const { client } = await context.runtime();
    const result = await client.createOrganization({ name: options.name }, { idempotencyKey });
    context.emit(create, result, `Created organization ${result.organization.name}`);
  });

  const member = organization.command("member").description("Organization member commands");
  const memberList = member.command("list").requiredOption("--org <org-id>");
  memberList.action(async (options: { org: string }) => {
    const { client } = await context.runtime();
    const result = await client.listMembers(options.org);
    context.emit(
      memberList,
      result,
      result.items.map((item) => `${item.accountId}\t${item.username}\t${item.role}`).join("\n") ||
        "No members",
    );
  });

  const memberAdd = member
    .command("add")
    .requiredOption("--org <org-id>")
    .requiredOption("--account <account-id>")
    .requiredOption("--role <role>")
    .option("--yes")
    .option("--idempotency-key <key>");
  memberAdd.action(
    async (options: {
      org: string;
      account: string;
      role: string;
      yes?: boolean;
      idempotencyKey?: string;
    }) => {
      const idempotencyKey = requireConfirmationAndIdempotency(context, options);
      const { client } = await context.runtime();
      const result = await client.addMember(
        options.org,
        { accountId: options.account, role: options.role },
        { idempotencyKey },
      );
      context.emit(memberAdd, result, `Added ${result.membership.username}`);
    },
  );
}
