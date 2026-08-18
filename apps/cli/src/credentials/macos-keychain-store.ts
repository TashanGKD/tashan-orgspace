import {
  CredentialStoreOperationError,
  spawnFile,
  validateCredentialLabel,
  type CredentialStore,
  type SpawnFile,
} from "./credential-store.js";

const SECURITY = "/usr/bin/security";
const SERVICE = "chat.tashan.orgspace";

export class MacOSKeychainStore implements CredentialStore {
  public constructor(private readonly run: SpawnFile = spawnFile) {}

  public async read(label: string): Promise<string | undefined> {
    validateCredentialLabel(label);
    const result = await this.run(
      SECURITY,
      ["find-generic-password", "-a", label, "-s", SERVICE, "-w"],
      { shell: false },
    );
    if (result.exitCode === 44) return undefined;
    if (result.exitCode !== 0) {
      throw new CredentialStoreOperationError("macOS Keychain read failed");
    }
    return result.stdout.replace(/\r?\n$/, "");
  }

  public async write(label: string, secret: string): Promise<void> {
    validateCredentialLabel(label);
    if (secret.length === 0) throw new Error("credential secret must not be empty");
    const result = await this.run(
      SECURITY,
      ["add-generic-password", "-U", "-a", label, "-s", SERVICE, "-w"],
      { shell: false, stdin: secret },
    );
    if (result.exitCode !== 0) {
      throw new CredentialStoreOperationError("macOS Keychain write failed");
    }
  }

  public async delete(label: string): Promise<void> {
    validateCredentialLabel(label);
    const result = await this.run(
      SECURITY,
      ["delete-generic-password", "-a", label, "-s", SERVICE],
      { shell: false },
    );
    if (result.exitCode !== 0 && result.exitCode !== 44) {
      throw new CredentialStoreOperationError("macOS Keychain delete failed");
    }
  }
}
