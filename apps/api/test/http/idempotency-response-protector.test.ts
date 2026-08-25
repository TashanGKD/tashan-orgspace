import { describe, expect, test } from "vitest";

import { IdempotencyResponseProtector } from "../../src/http/idempotency-response-protector.js";

const response = {
  account: { id: "b228e557-2214-4f95-b49d-d4ff7d9759d4" },
  tokens: { accessToken: "access-secret", refreshToken: "refresh-secret" },
};

describe("IdempotencyResponseProtector", () => {
  test("seals and opens a response without retaining plaintext secrets", () => {
    const protector = new IdempotencyResponseProtector("a".repeat(32));
    const sealed = protector.seal(response);
    expect(JSON.stringify(sealed)).not.toContain("access-secret");
    expect(JSON.stringify(sealed)).not.toContain("refresh-secret");
    expect(protector.open(sealed)).toEqual(response);
  });

  test("rejects ciphertext tampering", () => {
    const protector = new IdempotencyResponseProtector("a".repeat(32));
    const sealed = protector.seal(response);
    const value = sealed.__torg_sealed_response_v1;
    const tampered = Buffer.from(value, "base64url");
    const lastIndex = tampered.length - 1;
    tampered[lastIndex] = (tampered[lastIndex] ?? 0) ^ 1;
    expect(() =>
      protector.open({
        __torg_sealed_response_v1: tampered.toString("base64url"),
      }),
    ).toThrow(/could not be decrypted/);
  });

  test("rejects a wrong key and malformed envelopes", () => {
    const sealed = new IdempotencyResponseProtector("a".repeat(32)).seal(response);
    expect(() => new IdempotencyResponseProtector("b".repeat(32)).open(sealed)).toThrow(
      /could not be decrypted/,
    );
    expect(() =>
      new IdempotencyResponseProtector("a".repeat(32)).open({
        __torg_sealed_response_v1: "not-base64url",
      }),
    ).toThrow(/invalid sealed idempotency response/);
  });
});
