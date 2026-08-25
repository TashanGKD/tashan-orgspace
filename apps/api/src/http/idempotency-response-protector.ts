import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENVELOPE_KEY = "__torg_sealed_response_v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SealedIdempotencyResponse {
  __torg_sealed_response_v1: string;
}

function envelopeValue(input: unknown): string {
  const value =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)[ENVELOPE_KEY]
      : undefined;
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    typeof value !== "string"
  ) {
    throw new Error("invalid sealed idempotency response");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid sealed idempotency response");
  }
  return value;
}

export class IdempotencyResponseProtector {
  private readonly key: Buffer;

  public constructor(secret: string) {
    if (secret.length < 16) throw new Error("idempotency response secret is too short");
    this.key = createHash("sha256")
      .update("torg:idempotency-response:v1\0", "utf8")
      .update(secret, "utf8")
      .digest();
  }

  public isEnvelope(input: unknown): boolean {
    return (
      typeof input === "object" &&
      input !== null &&
      !Array.isArray(input) &&
      Object.hasOwn(input, ENVELOPE_KEY)
    );
  }

  public seal(input: unknown): SealedIdempotencyResponse {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(input), "utf8"),
      cipher.final(),
    ]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    return { __torg_sealed_response_v1: payload.toString("base64url") };
  }

  public open(input: unknown): unknown {
    const encoded = envelopeValue(input);
    const payload = Buffer.from(encoded, "base64url");
    if (payload.length <= IV_BYTES + TAG_BYTES) {
      throw new Error("invalid sealed idempotency response");
    }
    const iv = payload.subarray(0, IV_BYTES);
    const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        "utf8",
      );
      return JSON.parse(plaintext) as unknown;
    } catch {
      throw new Error("sealed idempotency response could not be decrypted");
    }
  }
}
