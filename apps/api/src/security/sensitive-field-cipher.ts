import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

const Envelope = z
  .object({
    version: z.number().int().min(1),
    nonce: z.string().regex(/^[A-Za-z0-9_-]+$/),
    ciphertext: z.string().regex(/^[A-Za-z0-9_-]+$/),
    tag: z.string().regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
export type SensitiveFieldEnvelope = z.infer<typeof Envelope>;

export class SensitiveFieldCipher {
  private readonly keys: ReadonlyMap<number, Buffer>;
  public constructor(options: { activeVersion: number; keys: ReadonlyMap<number, Uint8Array> }) {
    if (!Number.isSafeInteger(options.activeVersion) || options.activeVersion < 1) {
      throw new Error("active sensitive-field key version is invalid");
    }
    const keys = new Map<number, Buffer>();
    for (const [version, raw] of options.keys) {
      const key = Buffer.from(raw);
      if (!Number.isSafeInteger(version) || version < 1 || key.byteLength !== 32) {
        throw new Error("sensitive-field key must be 32 bytes with a positive version");
      }
      keys.set(version, key);
    }
    if (!keys.has(options.activeVersion)) throw new Error("active sensitive-field key is missing");
    this.activeVersion = options.activeVersion;
    this.keys = keys;
  }
  private readonly activeVersion: number;

  public encrypt(plaintext: string, context: string): SensitiveFieldEnvelope {
    if (context.length === 0) throw new Error("sensitive-field context is required");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.keys.get(this.activeVersion)!, nonce);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return {
      version: this.activeVersion,
      nonce: nonce.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
    };
  }

  public decrypt(raw: unknown, context: string): string {
    const envelope = Envelope.parse(raw);
    const key = this.keys.get(envelope.version);
    if (key === undefined) throw new Error("sensitive-field key version is unavailable");
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(envelope.nonce, "base64url"),
      );
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("sensitive-field authentication failed");
    }
  }
}
