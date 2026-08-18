import {
  CredentialStoreOperationError,
  spawnFile,
  validateCredentialLabel,
  type CredentialStore,
  type SpawnFile,
} from "./credential-store.js";

const SECRET_TOOL = "secret-tool";
const SERVICE = "chat.tashan.orgspace";

export class LinuxSecretServiceStore implements CredentialStore {
  public constructor(private readonly run: SpawnFile = spawnFile) {}

  public async read(label: string): Promise<string | undefined> {
    validateCredentialLabel(label);
    const result = await this.run(SECRET_TOOL, ["lookup", "service", SERVICE, "account", label], {
      shell: false,
    });
    if (result.exitCode === 1) return undefined;
    if (result.exitCode !== 0) {
      throw new CredentialStoreOperationError("Secret Service read failed");
    }
    return result.stdout.replace(/\r?\n$/, "");
  }

  public async write(label: string, secret: string): Promise<void> {
    validateCredentialLabel(label);
    if (secret.length === 0) throw new Error("credential secret must not be empty");
    const result = await this.run(
      SECRET_TOOL,
      ["store", "--label=Tashan OrgSpace", "service", SERVICE, "account", label],
      { shell: false, stdin: secret },
    );
    if (result.exitCode !== 0) {
      throw new CredentialStoreOperationError("Secret Service write failed");
    }
  }

  public async delete(label: string): Promise<void> {
    validateCredentialLabel(label);
    const result = await this.run(SECRET_TOOL, ["clear", "service", SERVICE, "account", label], {
      shell: false,
    });
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new CredentialStoreOperationError("Secret Service delete failed");
    }
  }
}
