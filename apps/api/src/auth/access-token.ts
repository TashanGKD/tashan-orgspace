import { randomUUID, type webcrypto } from "node:crypto";

import { errors, jwtVerify, SignJWT } from "jose";
import { z } from "zod";

import { AuthError } from "./auth-errors.js";

const AccessTokenClaims = z.object({
  sub: z.uuid(),
  principalId: z.uuid(),
  sessionId: z.uuid(),
  deviceId: z.uuid(),
  tokenVersion: z.number().int().positive(),
  actorSource: z.enum(["web", "cli"]),
  jti: z.uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type AccessTokenClaims = z.infer<typeof AccessTokenClaims>;
export type TokenCryptoKey = webcrypto.CryptoKey;

export interface AccessTokenInput {
  subject: string;
  principalId: string;
  sessionId: string;
  deviceId: string;
  tokenVersion: number;
  actorSource: "web" | "cli";
}

export interface AccessTokenServiceOptions {
  issuer: string;
  audience: string;
  activeKeyId: string;
  privateKey: TokenCryptoKey;
  publicKeys: ReadonlyMap<string, TokenCryptoKey>;
  clock?: () => number;
}

export class AccessTokenService {
  private readonly clock: () => number;

  public constructor(private readonly options: AccessTokenServiceOptions) {
    this.clock = options.clock ?? Date.now;
  }

  public async sign(
    input: AccessTokenInput,
    options: { lifetimeSeconds?: number } = {},
  ): Promise<string> {
    const issuedAt = Math.floor(this.clock() / 1000);
    const lifetimeSeconds = options.lifetimeSeconds ?? 15 * 60;

    return new SignJWT({
      principalId: input.principalId,
      sessionId: input.sessionId,
      deviceId: input.deviceId,
      tokenVersion: input.tokenVersion,
      actorSource: input.actorSource,
    })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: this.options.activeKeyId })
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setSubject(input.subject)
      .setJti(randomUUID())
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + lifetimeSeconds)
      .sign(this.options.privateKey);
  }

  public async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(
        token,
        (protectedHeader) => {
          if (protectedHeader.alg !== "EdDSA" || protectedHeader.kid !== this.options.activeKeyId) {
            throw new AuthError("AUTH_TOKEN_REVOKED", "access token key is not active");
          }
          const key = this.options.publicKeys.get(protectedHeader.kid);
          if (key === undefined) {
            throw new AuthError("AUTH_TOKEN_REVOKED", "access token key is unavailable");
          }
          return key;
        },
        {
          algorithms: ["EdDSA"],
          issuer: this.options.issuer,
          audience: this.options.audience,
          currentDate: new Date(this.clock()),
        },
      );

      const parsed = AccessTokenClaims.safeParse(payload);
      if (!parsed.success) {
        throw new AuthError("AUTH_TOKEN_REVOKED", "access token claims are invalid");
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (error instanceof errors.JWTExpired) {
        throw new AuthError("AUTH_TOKEN_EXPIRED", "access token has expired");
      }
      throw new AuthError("AUTH_TOKEN_REVOKED", "access token is invalid");
    }
  }
}
