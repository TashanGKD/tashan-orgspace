import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { PhoneNumber } from "@tashan/contracts";

import { AuthError } from "../auth/auth-errors.js";
import type { DatabaseClient } from "../db/client.js";
import type { VerificationCodeSender } from "./verification-code-sender.js";

export interface PhoneRateLimiter {
  consume(key: string): Promise<boolean>;
}

export interface PhoneVerificationServiceOptions {
  sql: DatabaseClient;
  sender: VerificationCodeSender;
  rateLimiter: PhoneRateLimiter;
  codePepper: string;
}

function invalidChallenge(): AuthError {
  return new AuthError("VALIDATION_FAILED", "phone verification challenge is invalid");
}

export class PhoneVerificationService {
  public constructor(private readonly options: PhoneVerificationServiceOptions) {
    if (options.codePepper.length < 8) throw new Error("phone verification pepper is too short");
  }

  private codeHash(phone: string, code: string): string {
    return createHmac("sha256", this.options.codePepper)
      .update(`${phone}:${code}`, "utf8")
      .digest("base64url");
  }

  public async start(accountId: string, rawPhone: string, serverIp: string) {
    const parsedPhone = PhoneNumber.safeParse(rawPhone);
    if (!parsedPhone.success)
      throw new AuthError("VALIDATION_FAILED", "phone must use E.164 format");
    const phone = parsedPhone.data;
    const allowed = await Promise.all([
      this.options.rateLimiter.consume(`phone:account:${accountId}`),
      this.options.rateLimiter.consume(`phone:number:${phone}`),
      this.options.rateLimiter.consume(`phone:ip:${serverIp}`),
    ]);
    if (allowed.includes(false)) {
      throw new AuthError("RATE_LIMITED", "phone verification rate limit exceeded");
    }
    if (!this.options.sender.available) {
      throw new AuthError(
        "PHONE_PROVIDER_UNAVAILABLE",
        "phone verification provider is unavailable",
      );
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    return this.options.sql.begin(async (transaction) => {
      const [account] = await transaction<{ id: string }[]>`
        select id from accounts where id = ${accountId} and status = 'active' for update
      `;
      if (account === undefined) throw new AuthError("AUTH_REQUIRED", "account is unavailable");
      const [challenge] = await transaction<{ id: string }[]>`
        insert into phone_verifications (account_id, phone_e164, code_hash, expires_at)
        values (${accountId}, ${phone}, ${this.codeHash(phone, code)}, ${expiresAt})
        returning id
      `;
      if (challenge === undefined) throw new Error("phone challenge insert returned no row");
      await this.options.sender.send({ phone, code, expiresAt });
      return { challengeId: challenge.id, expiresAt };
    });
  }

  public async confirm(accountId: string, challengeId: string, code: string) {
    if (!/^\d{6}$/.test(code)) throw invalidChallenge();
    const outcome = await this.options.sql.begin(async (transaction) => {
      const [challenge] = await transaction<
        {
          id: string;
          phone_e164: string;
          code_hash: string;
          attempts: number;
          expires_at: Date;
          consumed_at: Date | null;
        }[]
      >`
        select id, phone_e164, code_hash, attempts, expires_at, consumed_at
        from phone_verifications
        where id = ${challengeId} and account_id = ${accountId}
        for update
      `;
      if (
        challenge === undefined ||
        challenge.consumed_at !== null ||
        challenge.expires_at.getTime() <= Date.now() ||
        challenge.attempts >= 5
      ) {
        return { kind: "invalid" } as const;
      }

      const expected = Buffer.from(challenge.code_hash, "base64url");
      const actual = Buffer.from(this.codeHash(challenge.phone_e164, code), "base64url");
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        await transaction`
          update phone_verifications set attempts = attempts + 1 where id = ${challenge.id}
        `;
        return { kind: "invalid" } as const;
      }

      const verifiedAt = new Date();
      await transaction`
        update phone_verifications set consumed_at = ${verifiedAt} where id = ${challenge.id}
      `;
      await transaction`
        update accounts
        set phone_e164 = ${challenge.phone_e164}, phone_verified_at = ${verifiedAt}, updated_at = now()
        where id = ${accountId}
      `;
      return { kind: "verified", phone: challenge.phone_e164, verifiedAt } as const;
    });

    if (outcome.kind !== "verified") throw invalidChallenge();
    return outcome;
  }
}
