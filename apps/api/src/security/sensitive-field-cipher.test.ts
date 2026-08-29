import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { SensitiveFieldCipher } from "./sensitive-field-cipher.js";

const key1 = randomBytes(32);
const key2 = randomBytes(32);
describe("sensitive field cipher", () => {
  test("uses random nonces and never serializes plaintext", () => {
    const cipher = new SensitiveFieldCipher({ activeVersion: 1, keys: new Map([[1, key1]]) });
    const first = cipher.encrypt("+8613812345678", "partner:p1:phone");
    const second = cipher.encrypt("+8613812345678", "partner:p1:phone");
    expect(first.nonce).not.toBe(second.nonce);
    expect(JSON.stringify(first)).not.toContain("13812345678");
    expect(cipher.decrypt(first, "partner:p1:phone")).toBe("+8613812345678");
  });
  test("decrypts historical versions and rejects tamper or wrong context", () => {
    const oldCipher = new SensitiveFieldCipher({ activeVersion: 1, keys: new Map([[1, key1]]) });
    const envelope = oldCipher.encrypt("wx-secret", "partner:p1:wechat");
    const rotated = new SensitiveFieldCipher({
      activeVersion: 2,
      keys: new Map([
        [1, key1],
        [2, key2],
      ]),
    });
    expect(rotated.decrypt(envelope, "partner:p1:wechat")).toBe("wx-secret");
    expect(() =>
      rotated.decrypt(
        { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -1)}A` },
        "partner:p1:wechat",
      ),
    ).toThrow("authentication failed");
    expect(() => rotated.decrypt(envelope, "partner:p2:wechat")).toThrow("authentication failed");
  });
});
