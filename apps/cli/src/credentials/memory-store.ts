import { validateCredentialLabel, type CredentialStore } from "./credential-store.js";

export class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();

  public async read(label: string): Promise<string | undefined> {
    validateCredentialLabel(label);
    return this.values.get(label);
  }

  public async write(label: string, secret: string): Promise<void> {
    validateCredentialLabel(label);
    if (secret.length === 0) throw new Error("credential secret must not be empty");
    this.values.set(label, secret);
  }

  public async delete(label: string): Promise<void> {
    validateCredentialLabel(label);
    this.values.delete(label);
  }
}
