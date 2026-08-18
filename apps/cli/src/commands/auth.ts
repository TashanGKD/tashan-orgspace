import type { Command } from "commander";

import type { CapabilityId } from "@tashan/capabilities";

import {
  requireConfirmationAndIdempotency,
  requireIdempotency,
  type CommandContext,
} from "./context.js";

export const authCapabilityIds = [
  "auth.verification.send",
  "auth.password.reset",
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

async function codeAndPassword(
  context: CommandContext,
  options: { codeStdin?: boolean; passwordStdin?: boolean },
  passwordPrompt: string,
): Promise<{ code: string; password: string }> {
  if (options.codeStdin === true && options.passwordStdin === true) {
    const values = (await context.readStdin()).split(/\r?\n/);
    if (values.length !== 2 || values.some((value) => value.length === 0)) {
      context.usage("combined stdin must contain exactly two non-empty lines: code then password");
    }
    return { code: values[0] as string, password: values[1] as string };
  }
  return {
    code: await secretInput(context, options.codeStdin, "Verification code: "),
    password: await secretInput(context, options.passwordStdin, passwordPrompt),
  };
}

export function registerAuthCommands(program: Command, context: CommandContext): void {
  const auth = program.command("auth").description("Phone account and session commands");

  const codeSend = auth
    .command("code-send")
    .requiredOption("--phone <phone>")
    .requiredOption("--purpose <register|password-reset>")
    .option("--idempotency-key <key>");
  codeSend.action(async (options: { phone: string; purpose: string; idempotencyKey?: string }) => {
    const purpose =
      options.purpose === "register"
        ? "register"
        : options.purpose === "password-reset"
          ? "password_reset"
          : context.usage("--purpose must be register or password-reset");
    const idempotencyKey = requireIdempotency(context, options.idempotencyKey);
    const { client } = await context.runtime();
    const result = await client.sendVerificationCode(
      { phone: options.phone, purpose },
      { idempotencyKey },
    );
    context.emit(codeSend, result, `Verification challenge ${result.challengeId} created`);
  });

  const register = auth
    .command("register")
    .requiredOption("--phone <phone>")
    .requiredOption("--challenge <uuid>")
    .option("--code-stdin")
    .option("--password-stdin")
    .option("--idempotency-key <key>");
  register.action(
    async (options: {
      phone: string;
      challenge: string;
      codeStdin?: boolean;
      passwordStdin?: boolean;
      idempotencyKey?: string;
    }) => {
      const idempotencyKey = requireIdempotency(context, options.idempotencyKey);
      const secrets = await codeAndPassword(context, options, "Password: ");
      const runtime = await context.runtime();
      const result = await runtime.client.register(
        {
          phone: options.phone,
          challengeId: options.challenge,
          code: secrets.code,
          password: secrets.password,
          device: runtime.device,
        },
        { idempotencyKey },
      );
      await runtime.credentials.updateIdentity({
        accountId: result.account.id,
        displayName: result.account.displayName,
        phone: result.account.phone,
      });
      context.emit(
        register,
        { account: result.account, deviceId: result.deviceId },
        `Registered ${result.account.displayName}`,
      );
    },
  );

  const login = auth.command("login").requiredOption("--phone <phone>").option("--password-stdin");
  login.action(async (options: { phone: string; passwordStdin?: boolean }) => {
    const password = await secretInput(context, options.passwordStdin, "Password: ");
    const runtime = await context.runtime();
    const result = await runtime.client.login({
      phone: options.phone,
      password,
      device: runtime.device,
    });
    await runtime.credentials.updateIdentity({
      accountId: result.account.id,
      displayName: result.account.displayName,
      phone: result.account.phone,
    });
    context.emit(
      login,
      { account: result.account, deviceId: result.deviceId },
      `Logged in as ${result.account.displayName}`,
    );
  });

  const passwordReset = auth
    .command("password-reset")
    .requiredOption("--phone <phone>")
    .requiredOption("--challenge <uuid>")
    .option("--code-stdin")
    .option("--password-stdin")
    .option("--yes")
    .option("--idempotency-key <key>");
  passwordReset.action(
    async (options: {
      phone: string;
      challenge: string;
      codeStdin?: boolean;
      passwordStdin?: boolean;
      yes?: boolean;
      idempotencyKey?: string;
    }) => {
      const idempotencyKey = requireConfirmationAndIdempotency(context, options);
      const secrets = await codeAndPassword(context, options, "New password: ");
      const runtime = await context.runtime();
      const result = await runtime.client.resetPassword(
        {
          phone: options.phone,
          challengeId: options.challenge,
          code: secrets.code,
          newPassword: secrets.password,
        },
        { idempotencyKey },
      );
      await runtime.credentials.clearTokens();
      context.emit(passwordReset, result, "Password reset complete; log in again");
    },
  );

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
    context.emit(whoami, result, `${result.account.displayName} (${result.account.id})`);
  });
}
