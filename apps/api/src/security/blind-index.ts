import { createHmac } from "node:crypto";

export class BlindIndex {
  private readonly key: Buffer;
  public constructor(rawKey: Uint8Array) {
    this.key = Buffer.from(rawKey);
    if (this.key.byteLength !== 32) throw new Error("blind-index key must be 32 bytes");
  }
  private digest(namespace: string, value: string): string {
    return createHmac("sha256", this.key)
      .update(namespace)
      .update("\0")
      .update(value)
      .digest("base64url");
  }
  public phone(raw: string): string {
    let digits = raw.replaceAll(/[^0-9]/g, "");
    if (/^1[3-9][0-9]{9}$/.test(digits)) digits = `86${digits}`;
    if (!/^86[1-9][0-9]{7,14}$/.test(digits)) throw new Error("phone is invalid");
    return this.digest("phone", `+${digits}`);
  }
  public email(raw: string): string {
    const normalized = raw.normalize("NFKC").trim().toLocaleLowerCase("en-US");
    if (normalized.length === 0) throw new Error("email is invalid");
    return this.digest("email", normalized);
  }
  public wechat(raw: string): string {
    const normalized = raw.normalize("NFKC").trim().toLocaleLowerCase("en-US");
    if (normalized.length === 0) throw new Error("WeChat ID is invalid");
    return this.digest("wechat", normalized);
  }
}
