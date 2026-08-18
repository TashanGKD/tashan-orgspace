import { Command, CommanderError } from "commander";

import type { OrgSpaceClient } from "@tashan/sdk";

import { withMemoryFallback, type CredentialStore } from "./credentials/credential-store.js";
import { LinuxSecretServiceStore } from "./credentials/linux-secret-service-store.js";
import { MacOSKeychainStore } from "./credentials/macos-keychain-store.js";
import { MemoryCredentialStore } from "./credentials/memory-store.js";
import { CliOutput, type CliRunResult } from "./output.js";

export interface CliDependencies {
  createClient?: () => OrgSpaceClient;
  credentialStore?: CredentialStore;
  promptHidden?: (prompt: string) => Promise<string>;
}

function buildProgram(output: CliOutput): Command {
  const program = new Command()
    .name("torg")
    .description("Tashan OrgSpace command line client")
    .version("0.0.0")
    .option("--json", "emit one JSON value on stdout")
    .exitOverride()
    .configureOutput({
      writeOut: (value) => output.stdout(value),
      writeErr: (value) => output.stderr(value),
    });
  program.action(() => {
    if (program.opts<{ json?: boolean }>().json === true) {
      output.json({ help: program.helpInformation() });
    } else {
      output.stdout(program.helpInformation());
    }
  });

  program
    .command("auth")
    .description("Account and session commands")
    .command("login")
    .description("Log in without exposing a password in argv")
    .option("--username <name>")
    .option("--password-stdin")
    .action(() => {
      throw new Error("auth login command is not implemented yet");
    });
  return program;
}

function defaultCredentialStore(): CredentialStore {
  const memory = new MemoryCredentialStore();
  if (process.platform === "darwin") {
    return withMemoryFallback(new MacOSKeychainStore(), memory);
  }
  if (process.platform === "linux") {
    return withMemoryFallback(new LinuxSecretServiceStore(), memory);
  }
  return memory;
}

export async function runCli(
  argv: readonly string[],
  dependencies: CliDependencies = {},
): Promise<CliRunResult> {
  void dependencies.createClient;
  void (dependencies.credentialStore ?? defaultCredentialStore());
  void dependencies.promptHidden;
  const output = new CliOutput();
  const program = buildProgram(output);
  if (argv.length === 0) {
    output.stdout(program.helpInformation());
    return output.result(0);
  }

  try {
    await program.parseAsync(["node", "torg", ...argv], { from: "node" });
    return output.result(0);
  } catch (error) {
    if (error instanceof CommanderError) {
      return output.result(error.exitCode === 0 ? 0 : 2);
    }
    output.stderr(error instanceof Error ? error.message : "command failed");
    return output.result(1);
  }
}
