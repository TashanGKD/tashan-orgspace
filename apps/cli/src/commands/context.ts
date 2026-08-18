import type { Command } from "commander";

import type { OrgSpaceClient } from "@tashan/sdk";

import type { CliSessionCredentials } from "../credentials/session-credentials.js";
import type { CliOutput } from "../output.js";

export class CliUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export interface CliRuntime {
  client: OrgSpaceClient;
  credentials: CliSessionCredentials;
  deviceId: string;
  device: {
    id: string;
    name: string;
    os: string;
    architecture: string;
    clientVersion: string;
    channel: "cli";
  };
}

export interface CommandContext {
  output: CliOutput;
  runtime(): Promise<CliRuntime>;
  promptHidden(prompt: string): Promise<string>;
  readStdin(): Promise<string>;
  emit(command: Command, data: unknown, text: string): void;
  usage(message: string): never;
}

export function requireConfirmationAndIdempotency(
  context: CommandContext,
  options: { yes?: boolean; idempotencyKey?: string },
): string {
  if (options.yes !== true) context.usage("--yes is required for this operation");
  return requireIdempotency(context, options.idempotencyKey);
}

export function requireIdempotency(context: CommandContext, value?: string): string {
  const key = value?.trim();
  if (key === undefined || key.length === 0 || key.length > 200 || /[\r\n\0]/.test(key)) {
    context.usage("--idempotency-key is required");
  }
  return key;
}
