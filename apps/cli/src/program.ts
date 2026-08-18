import { hostname } from "node:os";

import { Command, CommanderError } from "commander";
import { ZodError, z } from "zod";

import {
  createFetchTransport,
  createOrgSpaceClient,
  OrgSpaceApiError,
  type OrgSpaceClient,
  type SdkCredentialStore,
} from "@tashan/sdk";

import { auditCapabilityIds, registerAuditCommands } from "./commands/audit.js";
import { authCapabilityIds, registerAuthCommands } from "./commands/auth.js";
import { capabilityCapabilityIds, registerCapabilityCommands } from "./commands/capability.js";
import { CliUsageError, type CliRuntime, type CommandContext } from "./commands/context.js";
import { deviceCapabilityIds, registerDeviceCommands } from "./commands/device.js";
import {
  organizationCapabilityIds,
  registerOrganizationCommands,
} from "./commands/organization.js";
import { resolveCliConfig } from "./config.js";
import { withMemoryFallback, type CredentialStore } from "./credentials/credential-store.js";
import { EncryptedFileStore } from "./credentials/encrypted-file-store.js";
import { LinuxSecretServiceStore } from "./credentials/linux-secret-service-store.js";
import { MacOSKeychainStore } from "./credentials/macos-keychain-store.js";
import { MemoryCredentialStore } from "./credentials/memory-store.js";
import { CliSessionCredentials } from "./credentials/session-credentials.js";
import { promptHidden as defaultPromptHidden, readSingleLine } from "./input.js";
import { CliOutput, type CliRunResult } from "./output.js";

export const registeredCapabilityIds = new Set([
  ...authCapabilityIds,
  ...deviceCapabilityIds,
  ...organizationCapabilityIds,
  ...capabilityCapabilityIds,
  ...auditCapabilityIds,
]);

export interface CliDependencies {
  createClient?: (
    credentials: SdkCredentialStore,
    deviceId: string,
    apiUrl: string,
  ) => OrgSpaceClient;
  credentialStore?: CredentialStore;
  promptHidden?: (prompt: string) => Promise<string>;
  readStdin?: () => Promise<string>;
  deviceId?: string;
  deviceMetadata?: Partial<Pick<CliRuntime["device"], "name" | "os" | "architecture">>;
  environment?: Record<string, string | undefined>;
}

function osCredentialStore(): CredentialStore {
  const memory = new MemoryCredentialStore();
  if (process.platform === "darwin") {
    return withMemoryFallback(new MacOSKeychainStore(), memory);
  }
  if (process.platform === "linux") {
    return withMemoryFallback(new LinuxSecretServiceStore(), memory);
  }
  return memory;
}

export function buildProgram(output: CliOutput, dependencies: CliDependencies = {}): Command {
  const program = new Command()
    .name("torg")
    .description("Tashan OrgSpace command line client")
    .version("0.0.0")
    .option("--json", "emit one JSON value on stdout")
    .option("--api-url <url>", "explicit API origin")
    .option("--credential-file <absolute-path>", "explicit encrypted credential file")
    .option("--invocation-source <source>", "cli or ai_via_cli", "cli")
    .exitOverride()
    .configureOutput({
      writeOut: (value) => output.stdout(value),
      writeErr: (value) => output.stderr(value),
    });

  let runtimePromise: Promise<CliRuntime> | undefined;
  const commandContext: CommandContext = {
    output,
    runtime: () => {
      runtimePromise ??= createRuntime(program, dependencies);
      return runtimePromise;
    },
    promptHidden: dependencies.promptHidden ?? defaultPromptHidden,
    readStdin: dependencies.readStdin ?? (() => readSingleLine()),
    emit: (command, data, text) => {
      if (command.optsWithGlobals<{ json?: boolean }>().json === true) output.json(data);
      else output.stdout(text);
    },
    usage: (message) => {
      throw new CliUsageError(message);
    },
  };

  registerCapabilityCommands(program, commandContext);
  registerAuthCommands(program, commandContext);
  registerDeviceCommands(program, commandContext);
  registerOrganizationCommands(program, commandContext);
  registerAuditCommands(program, commandContext);

  program.action(() => {
    if (program.opts<{ json?: boolean }>().json === true) {
      output.json({ help: program.helpInformation() });
    } else {
      output.stdout(program.helpInformation());
    }
  });
  return program;
}

async function createRuntime(program: Command, dependencies: CliDependencies): Promise<CliRuntime> {
  const globalOptions = program.opts<{
    apiUrl?: string;
    credentialFile?: string;
    invocationSource: string;
  }>();
  const environment = {
    ...(dependencies.environment ?? process.env),
    ...(globalOptions.apiUrl === undefined ? {} : { TORG_API_URL: globalOptions.apiUrl }),
  };
  const config = resolveCliConfig(environment);
  const invocationSource = z.enum(["cli", "ai_via_cli"]).parse(globalOptions.invocationSource);
  const prompt = dependencies.promptHidden ?? defaultPromptHidden;
  const credentialPath = globalOptions.credentialFile ?? config.credentialFile;
  const store =
    dependencies.credentialStore ??
    (credentialPath === undefined
      ? osCredentialStore()
      : new EncryptedFileStore({
          path: credentialPath,
          getPassphrase: () => prompt("Credential file passphrase: "),
        }));
  const credentials = await CliSessionCredentials.load(
    store,
    `session:${config.apiUrl}`,
    dependencies.deviceId,
  );
  const client =
    dependencies.createClient?.(credentials, credentials.deviceId, config.apiUrl) ??
    createOrgSpaceClient({
      transport: createFetchTransport({
        baseUrl: config.apiUrl,
        timeoutMilliseconds: 15_000,
      }),
      credentials,
      deviceId: credentials.deviceId,
      clientChannel: "cli",
      invocationSource,
    });
  return {
    client,
    credentials,
    deviceId: credentials.deviceId,
    device: {
      id: credentials.deviceId,
      name: dependencies.deviceMetadata?.name ?? hostname(),
      os: dependencies.deviceMetadata?.os ?? process.platform,
      architecture: dependencies.deviceMetadata?.architecture ?? process.arch,
      clientVersion: "0.0.0",
      channel: "cli",
    },
  };
}

function exitCodeForApiError(error: OrgSpaceApiError): number {
  if (error.code.startsWith("AUTH_") || error.code === "DEVICE_REVOKED") return 3;
  if (error.code === "ORG_FORBIDDEN" || error.code === "PHONE_NOT_VERIFIED") return 4;
  if (error.status >= 500) return 5;
  return 1;
}

export async function runCli(
  argv: readonly string[],
  dependencies: CliDependencies = {},
): Promise<CliRunResult> {
  const output = new CliOutput();
  if (argv.some((argument) => argument === "--password" || argument.startsWith("--password="))) {
    output.stderr("error: unknown option '--password'; use the hidden prompt or --password-stdin");
    return output.result(2);
  }
  const program = buildProgram(output, dependencies);
  if (argv.length === 0) {
    output.stdout(program.helpInformation());
    return output.result(0);
  }

  try {
    await program.parseAsync(["node", "torg", ...argv], { from: "node" });
    return output.result(0);
  } catch (error) {
    if (error instanceof CommanderError) return output.result(error.exitCode === 0 ? 0 : 2);
    if (error instanceof CliUsageError) {
      output.stderr(`error: ${error.message}`);
      return output.result(2);
    }
    if (error instanceof ZodError) {
      output.stderr(`error: ${error.issues[0]?.message ?? "invalid input"}`);
      return output.result(2);
    }
    if (error instanceof OrgSpaceApiError) {
      output.stderr(`error [${error.code}]: ${error.message}`);
      return output.result(exitCodeForApiError(error));
    }
    output.stderr(error instanceof Error ? error.message : "command failed");
    return output.result(1);
  }
}
