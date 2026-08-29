import type { Command } from "commander";

import type { CapabilityId } from "@tashan/capabilities";

import { requireConfirmationAndIdempotency, type CommandContext } from "./context.js";

export const folderCapabilityIds = [
  "folder.access.read",
  "folder.access.set",
  "folder.grant.set",
  "folder.grant.revoke",
  "folder.manager.recover",
] as const satisfies readonly CapabilityId[];

export function registerFolderCommands(program: Command, context: CommandContext): void {
  const folder = program.command("folder").description("Folder and access commands");
  folder.action(() => context.output.stdout(folder.helpInformation()));
  const access = folder
    .command("get-access")
    .requiredOption("--space <id>")
    .requiredOption("--folder <id>");
  access.action(async (o: { space: string; folder: string }) => {
    const result = await (await context.runtime()).client.readFolderAccess(o.space, o.folder);
    context.emit(access, result, `${result.scope}\t${result.grants.length} grants`);
  });
  const accessSet = folder
    .command("access")
    .requiredOption("--space <id>")
    .requiredOption("--folder <id>")
    .requiredOption("--scope <scope>")
    .requiredOption("--expected-version <n>")
    .option("--yes")
    .option("--idempotency-key <key>");
  accessSet.action(
    async (o: {
      space: string;
      folder: string;
      scope: string;
      expectedVersion: string;
      yes?: boolean;
      idempotencyKey?: string;
    }) => {
      const key = requireConfirmationAndIdempotency(context, o);
      const result = await (
        await context.runtime()
      ).client.setFolderAccess(
        o.space,
        o.folder,
        { scope: o.scope, expectedVersion: Number(o.expectedVersion) },
        { idempotencyKey: key },
      );
      context.emit(accessSet, result, `Folder access set to ${result.scope}`);
    },
  );
  const grantSet = folder
    .command("grant")
    .requiredOption("--space <id>")
    .requiredOption("--folder <id>")
    .requiredOption("--account <id>")
    .requiredOption("--role <manager|editor|viewer>")
    .requiredOption("--expected-version <n>")
    .option("--yes")
    .option("--idempotency-key <key>");
  grantSet.action(
    async (o: {
      space: string;
      folder: string;
      account: string;
      role: string;
      expectedVersion: string;
      yes?: boolean;
      idempotencyKey?: string;
    }) => {
      const key = requireConfirmationAndIdempotency(context, o);
      const result = await (
        await context.runtime()
      ).client.setFolderGrant(
        o.space,
        o.folder,
        { accountId: o.account, role: o.role, expectedVersion: Number(o.expectedVersion) },
        { idempotencyKey: key },
      );
      context.emit(grantSet, result, `Updated folder access for ${o.account}`);
    },
  );
  const revoke = folder
    .command("revoke")
    .requiredOption("--space <id>")
    .requiredOption("--folder <id>")
    .requiredOption("--account <id>")
    .option("--yes")
    .option("--idempotency-key <key>");
  revoke.action(
    async (o: {
      space: string;
      folder: string;
      account: string;
      yes?: boolean;
      idempotencyKey?: string;
    }) => {
      const key = requireConfirmationAndIdempotency(context, o);
      const result = await (
        await context.runtime()
      ).client.revokeFolderGrant(o.space, o.folder, o.account, { idempotencyKey: key });
      context.emit(revoke, result, `Revoked folder access for ${o.account}`);
    },
  );
  const recover = folder
    .command("manager-recover")
    .requiredOption("--space <id>")
    .requiredOption("--folder <id>")
    .requiredOption("--account <id>")
    .requiredOption("--reason <reason>")
    .requiredOption("--expected-version <n>")
    .option("--yes")
    .option("--idempotency-key <key>");
  recover.action(
    async (o: {
      space: string;
      folder: string;
      account: string;
      reason: string;
      expectedVersion: string;
      yes?: boolean;
      idempotencyKey?: string;
    }) => {
      const key = requireConfirmationAndIdempotency(context, o);
      const result = await (
        await context.runtime()
      ).client.recoverFolderManager(
        o.space,
        o.folder,
        { accountId: o.account, reason: o.reason, expectedVersion: Number(o.expectedVersion) },
        { idempotencyKey: key },
      );
      context.emit(recover, result, `Recovered folder manager ${o.account}`);
    },
  );
}
