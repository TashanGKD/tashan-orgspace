import type { Command } from "commander";

import type { CapabilityId } from "@tashan/capabilities";

import { requireIdempotency, type CommandContext } from "./context.js";

export const authCapabilityIds = [
  "auth.phone.start",
  "auth.phone.confirm",
  "auth.register",
  "auth.login",
  "auth.refresh",
  "auth.logout",
  "auth.whoami",
] as const satisfies readonly CapabilityId[];

async function secretInput(
  context: CommandContext,
  fromStdin: boolean | undefined,
  prompt: string,
): Promise<string> {
  const value = fromStdin === true ? await context.readStdin() : await context.promptHidden(prompt);
  if (value.length === 0) context.usage("secret input must not be empty");
  return value;
}

export function registerAuthCommands(program: Command, context: CommandContext): void {
  const auth = program.command("auth").description("Account, phone and session commands");

  const phoneStart = auth
    .command("phone-start")
    .requiredOption("--phone <e164>")
    .option("--idempotency-key <key>");
  phoneStart.action(async (options: { phone: string; idempotencyKey?: string }) => {
    const idempotencyKey = requireIdempotency(context, options.idempotencyKey);
    const { client } = await context.runtime();
    const result = await client.startPhoneVerification(
      { phone: options.phone },
      { idempotencyKey },
    );
    context.emit(phoneStart, result, `Verification challenge ${result.challengeId} created`);
  });

  const phoneConfirm = auth
    .command("phone-confirm")
    .requiredOption("--challenge <uuid>")
    .option("--code-stdin")
    .option("--idempotency-key <key>");
  phoneConfirm.action(
    async (options: { challenge: string; codeStdin?: boolean; idempotencyKey?: string }) => {
      const idempotencyKey = requireIdempotency(context, options.idempotencyKey);
      const code = await secretInput(context, options.codeStdin, "Verification code: ");
      const { client } = await context.runtime();
      const result = await client.confirmPhoneVerification(
        { challengeId: options.challenge, code },
        { idempotencyKey },
      );
      context.emit(phoneConfirm, result, `Phone ${result.phone} verified`);
    },
  );

  const register = auth
    .command("register")
    .requiredOption("--username <name>")
    .option("--password-stdin")
    .option("--idempotency-key <key>");
  register.action(
    async (options: { username: string; passwordStdin?: boolean; idempotencyKey?: string }) => {
      const idempotencyKey = requireIdempotency(context, options.idempotencyKey);
      const password = await secretInput(context, options.passwordStdin, "Password: ");
      const runtime = await context.runtime();
      const result = await runtime.client.register(
        { username: options.username, password },
        { idempotencyKey },
      );
      await runtime.credentials.updateIdentity({
        accountId: result.account.id,
        username: result.account.username,
      });
      context.emit(register, result, `Registered ${result.account.username}`);
    },
  );

  const login = auth
    .command("login")
    .requiredOption("--username <name>")
    .option("--password-stdin");
  login.action(async (options: { username: string; passwordStdin?: boolean }) => {
    const password = await secretInput(context, options.passwordStdin, "Password: ");
    const runtime = await context.runtime();
    const result = await runtime.client.login({
      username: options.username,
      password,
      device: runtime.device,
    });
    await runtime.credentials.updateTokens(result.tokens);
    await runtime.credentials.updateIdentity({
      accountId: result.account.id,
      username: result.account.username,
    });
    context.emit(
      login,
      { account: result.account, deviceId: result.deviceId },
      `Logged in as ${result.account.username}`,
    );
  });

  const refresh = auth.command("refresh");
  refresh.action(async () => {
    const runtime = await context.runtime();
    const result = await runtime.client.refresh();
    await runtime.credentials.updateTokens(result.tokens);
    context.emit(
      refresh,
      { sessionId: result.sessionId, deviceId: result.deviceId },
      "Session refreshed",
    );
  });

  const logout = auth.command("logout").option("--yes");
  logout.action(async (options: { yes?: boolean }) => {
    if (options.yes !== true) context.usage("--yes is required for this operation");
    const runtime = await context.runtime();
    const refreshToken = await runtime.credentials.getRefreshToken();
    const result = await runtime.client.logout(refreshToken === undefined ? {} : { refreshToken });
    await runtime.credentials.clearTokens();
    context.emit(logout, result, "Logged out");
  });

  const whoami = auth.command("whoami");
  whoami.action(async () => {
    const { client } = await context.runtime();
    const result = await client.whoami();
    context.emit(whoami, result, `${result.account.username} (${result.account.id})`);
  });
}
