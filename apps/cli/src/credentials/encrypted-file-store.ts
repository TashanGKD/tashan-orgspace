import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { open, rename as fsRename, unlink } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { scrypt } from "node:crypto";

import { z } from "zod";

import { validateCredentialLabel, type CredentialStore } from "./credential-store.js";

const MAX_FILE_BYTES = 1024 * 1024;
const AAD = Buffer.from("torg-credentials-v1", "utf8");
const EncryptedDocument = z
  .object({
    version: z.literal(1),
    salt: z.string().min(1),
    iv: z.string().min(1),
    tag: z.string().min(1),
    ciphertext: z.string().min(1),
  })
  .strict();

interface EncryptedFileStoreOptions {
  path: string;
  getPassphrase(): Promise<string>;
  rename?: (from: string, to: string) => Promise<void>;
}

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      passphrase,
      salt,
      32,
      { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error === null ? resolve(key as Buffer) : reject(error)),
    );
  });
}

export class EncryptedFileStore implements CredentialStore {
  private readonly rename: (from: string, to: string) => Promise<void>;

  public constructor(private readonly options: EncryptedFileStoreOptions) {
    if (!isAbsolute(options.path))
      throw new Error("credential file path must be explicit and absolute");
    this.rename = options.rename ?? fsRename;
  }

  public async read(label: string): Promise<string | undefined> {
    validateCredentialLabel(label);
    const passphrase = await this.passphrase();
    return (await this.readAll(false, passphrase))[label];
  }

  public async write(label: string, secret: string): Promise<void> {
    validateCredentialLabel(label);
    if (secret.length === 0) throw new Error("credential secret must not be empty");
    const passphrase = await this.passphrase();
    const values = await this.readAll(true, passphrase);
    values[label] = secret;
    await this.writeAll(values, passphrase);
  }

  public async delete(label: string): Promise<void> {
    validateCredentialLabel(label);
    const passphrase = await this.passphrase();
    const values = await this.readAll(true, passphrase);
    delete values[label];
    await this.writeAll(values, passphrase);
  }

  private async passphrase(): Promise<string> {
    const value = await this.options.getPassphrase();
    if (value.length < 12)
      throw new Error("credential-file passphrase must be at least 12 characters");
    return value;
  }

  private async readAll(
    missingIsEmpty: boolean,
    passphrase: string,
  ): Promise<Record<string, string>> {
    let handle;
    try {
      handle = await open(this.options.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (
        missingIsEmpty &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return {};
      }
      throw error;
    }
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw new Error("credential file must be a regular file");
      if ((metadata.mode & 0o777) !== 0o600) {
        throw new Error("credential file permissions must be 0600");
      }
      if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
        throw new Error("credential file must be owned by the current user");
      }
      if (metadata.size > MAX_FILE_BYTES) throw new Error("credential file exceeds 1 MiB");
      const raw = await handle.readFile({ encoding: "utf8" });
      const document = EncryptedDocument.parse(JSON.parse(raw) as unknown);
      const salt = Buffer.from(document.salt, "base64url");
      const iv = Buffer.from(document.iv, "base64url");
      const tag = Buffer.from(document.tag, "base64url");
      const ciphertext = Buffer.from(document.ciphertext, "base64url");
      const key = await deriveKey(passphrase, salt);
      let plaintext: Buffer | undefined;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(AAD);
        decipher.setAuthTag(tag);
        plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return z
          .record(z.string().min(1).max(256), z.string().min(1))
          .parse(JSON.parse(plaintext.toString("utf8")) as unknown);
      } finally {
        plaintext?.fill(0);
        key.fill(0);
      }
    } finally {
      await handle.close();
    }
  }

  private async writeAll(values: Record<string, string>, passphrase: string): Promise<void> {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await deriveKey(passphrase, salt);
    const plaintext = Buffer.from(JSON.stringify(values), "utf8");
    let document: string;
    try {
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(AAD);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      document = JSON.stringify({
        version: 1,
        salt: salt.toString("base64url"),
        iv: iv.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
      });
    } finally {
      plaintext.fill(0);
      key.fill(0);
    }

    const temporaryPath = `${this.options.path}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
    let handle;
    let renamed = false;
    try {
      handle = await open(
        temporaryPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      await handle.writeFile(document, { encoding: "utf8" });
      await handle.chmod(0o600);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.rename(temporaryPath, this.options.path);
      renamed = true;
    } finally {
      await handle?.close().catch(() => undefined);
      if (!renamed) await unlink(temporaryPath).catch(() => undefined);
    }
  }
}
