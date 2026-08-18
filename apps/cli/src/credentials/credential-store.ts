import { spawn } from "node:child_process";

export interface CredentialStore {
  read(label: string): Promise<string | undefined>;
  write(label: string, secret: string): Promise<void>;
  delete(label: string): Promise<void>;
}

export interface SpawnFileOptions {
  shell: false;
  stdin?: string;
}

export interface SpawnFileResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type SpawnFile = (
  binary: string,
  argv: readonly string[],
  options: SpawnFileOptions,
) => Promise<SpawnFileResult>;

export class CredentialBackendUnavailableError extends Error {
  public constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CredentialBackendUnavailableError";
  }
}

export class CredentialStoreOperationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CredentialStoreOperationError";
  }
}

export const spawnFile: SpawnFile = async (binary, argv, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, [...argv], {
      shell: options.shell,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 1024 * 1024) {
        child.kill();
        reject(new Error("credential helper output exceeded 1 MiB"));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", (error) => {
      reject(
        new CredentialBackendUnavailableError(`credential helper is unavailable: ${binary}`, error),
      );
    });
    child.once("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin.end(options.stdin);
  });

export function validateCredentialLabel(label: string): void {
  if (
    label.length === 0 ||
    label.length > 256 ||
    /[\r\n\0]/.test(label) ||
    ["__proto__", "constructor", "prototype"].includes(label)
  ) {
    throw new Error("credential label is invalid");
  }
}

class FallbackCredentialStore implements CredentialStore {
  public constructor(
    private readonly primary: CredentialStore,
    private readonly fallback: CredentialStore,
  ) {}

  private async attempt<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    try {
      return await primary();
    } catch (error) {
      if (!(error instanceof CredentialBackendUnavailableError)) throw error;
      return fallback();
    }
  }

  public read(label: string): Promise<string | undefined> {
    return this.attempt(
      () => this.primary.read(label),
      () => this.fallback.read(label),
    );
  }

  public write(label: string, secret: string): Promise<void> {
    return this.attempt(
      () => this.primary.write(label, secret),
      () => this.fallback.write(label, secret),
    );
  }

  public delete(label: string): Promise<void> {
    return this.attempt(
      () => this.primary.delete(label),
      () => this.fallback.delete(label),
    );
  }
}

export function withMemoryFallback(
  primary: CredentialStore,
  memory: CredentialStore,
): CredentialStore {
  return new FallbackCredentialStore(primary, memory);
}
