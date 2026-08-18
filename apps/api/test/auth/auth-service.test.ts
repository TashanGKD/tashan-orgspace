import { generateKeyPair } from "jose";
import { beforeAll, describe, expect, test } from "vitest";

import { AccessTokenService, type TokenCryptoKey } from "../../src/auth/access-token.js";
import { AuthService, type LoginRateLimiter } from "../../src/auth/auth-service.js";
import { hashPassword, verifyPassword } from "../../src/auth/password.js";
import type { DatabaseClient } from "../../src/db/client.js";

let tokenService: AccessTokenService;
let signingKey: TokenCryptoKey;
let verificationKey: TokenCryptoKey;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  signingKey = privateKey;
  verificationKey = publicKey;
  tokenService = new AccessTokenService({
    issuer: "https://api-org.tashan.chat",
    audience: "tashan-orgspace",
    activeKeyId: "test-key-1",
    privateKey,
    publicKeys: new Map([["test-key-1", publicKey]]),
  });
});

describe("access-token verification boundary", () => {
  const claims = {
    subject: "b228e557-2214-4f95-b49d-d4ff7d9759d4",
    principalId: "af4ec631-8335-4c2b-9a02-df7033d45c55",
    sessionId: "3c5442ea-00e2-483b-9e81-2271e34120f1",
    deviceId: "8df6fa80-6de8-48dd-92cb-a14db311c8e8",
    tokenVersion: 1,
    actorSource: "cli" as const,
  };

  test("rejects a token with a tampered signature", async () => {
    const token = await tokenService.sign(claims);
    const segments = token.split(".");
    const signature = Buffer.from(segments[2] ?? "", "base64url");
    const firstByte = signature[0];
    if (firstByte === undefined) throw new Error("JWT signature fixture is empty");
    signature[0] = firstByte ^ 1;
    const tampered = `${segments[0]}.${segments[1]}.${signature.toString("base64url")}`;

    await expect(tokenService.verify(tampered)).rejects.toMatchObject({
      code: "AUTH_TOKEN_REVOKED",
    });
  });

  test("rejects the wrong audience and a non-active key ID", async () => {
    const wrongAudience = new AccessTokenService({
      issuer: "https://api-org.tashan.chat",
      audience: "another-audience",
      activeKeyId: "test-key-1",
      privateKey: signingKey,
      publicKeys: new Map([["test-key-1", verificationKey]]),
    });
    const oldKey = new AccessTokenService({
      issuer: "https://api-org.tashan.chat",
      audience: "tashan-orgspace",
      activeKeyId: "old-key",
      privateKey: signingKey,
      publicKeys: new Map([["old-key", verificationKey]]),
    });

    await expect(tokenService.verify(await wrongAudience.sign(claims))).rejects.toMatchObject({
      code: "AUTH_TOKEN_REVOKED",
    });
    await expect(tokenService.verify(await oldKey.sign(claims))).rejects.toMatchObject({
      code: "AUTH_TOKEN_REVOKED",
    });
  });
});

describe("password primitives", () => {
  test("hashes with Argon2id and verifies without exposing the password", async () => {
    const encoded = await hashPassword("CorrectHorseBattery9");

    expect(encoded).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(encoded, "CorrectHorseBattery9")).resolves.toBe(true);
    await expect(verifyPassword(encoded, "WrongPassword9")).resolves.toBe(false);
    expect(encoded).not.toContain("CorrectHorseBattery9");
  });
});

describe("auth input boundary", () => {
  test("rejects weak registration password before database access", async () => {
    let databaseCalls = 0;
    const sql = new Proxy(() => undefined, {
      apply() {
        databaseCalls += 1;
        throw new Error("database must not be called");
      },
      get() {
        databaseCalls += 1;
        throw new Error("database must not be called");
      },
    }) as unknown as DatabaseClient;
    const rateLimiter: LoginRateLimiter = { consume: async () => true };
    const auth = new AuthService({ sql, tokenService, rateLimiter });

    await expect(auth.register({ username: "alice", password: "password" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(databaseCalls).toBe(0);
  });
});
