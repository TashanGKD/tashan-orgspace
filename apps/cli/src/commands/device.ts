import type { Command } from "commander";

import type { CapabilityId } from "@tashan/capabilities";

import { requireConfirmationAndIdempotency, type CommandContext } from "./context.js";

export const deviceCapabilityIds = [
  "device.list",
  "device.revoke",
] as const satisfies readonly CapabilityId[];

export function registerDeviceCommands(program: Command, context: CommandContext): void {
  const device = program.command("device").description("Manage this account's device sessions");

  const list = device.command("list");
  list.action(async () => {
    const { client } = await context.runtime();
    const result = await client.listDevices();
    const text = result.items
      .map((item) => `${item.id}\t${item.name}${item.current ? " (current)" : ""}`)
      .join("\n");
    context.emit(list, result, text || "No devices");
  });

  const revoke = device
    .command("revoke <device-id>")
    .option("--yes")
    .option("--idempotency-key <key>")
    .option("--allow-current-device");
  revoke.action(
    async (
      deviceId: string,
      options: { yes?: boolean; idempotencyKey?: string; allowCurrentDevice?: boolean },
    ) => {
      const idempotencyKey = requireConfirmationAndIdempotency(context, options);
      const runtime = await context.runtime();
      if (deviceId === runtime.deviceId && options.allowCurrentDevice !== true) {
        context.usage("--allow-current-device is required to revoke the current device");
      }
      const result = await runtime.client.revokeDevice(deviceId, { idempotencyKey });
      context.emit(revoke, result, `Revoked device ${result.deviceId}`);
    },
  );
}
