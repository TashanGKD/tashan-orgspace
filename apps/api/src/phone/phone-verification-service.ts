import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { PhoneNumber, VerificationPurpose } from "@tashan/contracts";

import { AuthError } from "../auth/auth-errors.js";
import type { DatabaseClient } from "../db/client.js";
import type { TransactionClient } from "../db/transaction.js";
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

type Purpose = "register" | "password_reset";

function invalidChallenge(): AuthError {
  return new AuthError("VERIFICATION_INVALID", "verification challenge is invalid");
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

  public async start(
    input: {
      phone: string;
      purpose: Purpose;
      serverIp: string;
      requestId: string;
    },
    existingTransaction?: TransactionClient,
  ): Promise<{ challengeId: string; expiresAt: Date }> {
    const parsedPhone = PhoneNumber.safeParse(input.phone);
    const parsedPurpose = VerificationPurpose.safeParse(input.purpose);
    if (!parsedPhone.success || !parsedPurpose.success) {
      throw new AuthError("VALIDATION_FAILED", "phone verification request is invalid");
    }
    const phone = parsedPhone.data;
    const purpose = parsedPurpose.data;
    const allowed = await Promise.all([
      this.options.rateLimiter.consume(`verification:${purpose}:phone:${phone}`),
      this.options.rateLimiter.consume(`verification:${purpose}:ip:${input.serverIp}`),
    ]);
    if (allowed.includes(false)) {
      throw new AuthError("VERIFICATION_RATE_LIMITED", "verification rate limit exceeded");
    }
    if (!this.options.sender.available) {
      throw new AuthError(
        "PHONE_PROVIDER_UNAVAILABLE",
        "phone verification provider is unavailable",
      );
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const operation = async (transaction: TransactionClient) => {
      const [challenge] = await transaction<{ id: string }[]>`
        insert into phone_verifications (
          account_id, phone_e164, purpose, code_hash, expires_at,
          request_id, server_ip, delivery_result
        ) values (
          null, ${phone}, ${purpose}, ${this.codeHash(phone, code)}, ${expiresAt},
          ${input.requestId}, ${input.serverIp}, 'pending'
        )
        returning id
      `;
      if (challenge === undefined) throw new Error("phone challenge insert returned no row");

      await this.options.sender.send({ phone, code, expiresAt, purpose });
      await transaction`
        update phone_verifications set delivery_result = 'accepted' where id = ${challenge.id}
      `;
      return { challengeId: challenge.id, expiresAt };
    };
    return existingTransaction === undefined
      ? this.options.sql.begin(operation)
      : operation(existingTransaction);
  }

  public async consume(
    input: {
      phone: string;
      purpose: Purpose;
      challengeId: string;
      code: string;
    },
    transaction: TransactionClient,
  ): Promise<void> {
    const parsedPhone = PhoneNumber.safeParse(input.phone);
    const parsedPurpose = VerificationPurpose.safeParse(input.purpose);
    if (!parsedPhone.success || !parsedPurpose.success || !/^\d{6}$/.test(input.code)) {
      throw invalidChallenge();
    }

    const preflight = await this.options.sql.begin(async (attemptTransaction) => {
      const [challenge] = await attemptTransaction<
        {
          id: string;
          phone_e164: string;
          purpose: Purpose;
          code_hash: string;
          attempts: number;
          expires_at: Date;
          consumed_at: Date | null;
        }[]
      >`
        select id, phone_e164, purpose, code_hash, attempts, expires_at, consumed_at
        from phone_verifications
        where id = ${input.challengeId}
        for update
      `;

      if (
        challenge === undefined ||
        challenge.consumed_at !== null ||
        challenge.attempts >= 5 ||
        challenge.phone_e164 !== parsedPhone.data ||
        challenge.purpose !== parsedPurpose.data
      ) {
        return { kind: "invalid" } as const;
      }
      if (challenge.expires_at.getTime() <= Date.now()) {
        return { kind: "expired" } as const;
      }

      const expected = Buffer.from(challenge.code_hash, "base64url");
      const actual = Buffer.from(this.codeHash(challenge.phone_e164, input.code), "base64url");
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        await attemptTransaction`
          update phone_verifications set attempts = attempts + 1 where id = ${challenge.id}
        `;
        return { kind: "invalid" } as const;
      }
      return { kind: "valid" } as const;
    });

    if (preflight.kind === "expired") {
      throw new AuthError("VERIFICATION_EXPIRED", "verification challenge has expired");
    }
    if (preflight.kind !== "valid") throw invalidChallenge();

    const [challenge] = await transaction<
      {
        id: string;
        phone_e164: string;
        purpose: Purpose;
        code_hash: string;
        attempts: number;
        expires_at: Date;
        consumed_at: Date | null;
      }[]
    >`
      select id, phone_e164, purpose, code_hash, attempts, expires_at, consumed_at
      from phone_verifications
      where id = ${input.challengeId}
      for update
    `;

    if (
      challenge === undefined ||
      challenge.consumed_at !== null ||
      challenge.attempts >= 5 ||
      challenge.phone_e164 !== parsedPhone.data ||
      challenge.purpose !== parsedPurpose.data
    ) {
      throw invalidChallenge();
    }
    if (challenge.expires_at.getTime() <= Date.now()) {
      throw new AuthError("VERIFICATION_EXPIRED", "verification challenge has expired");
    }

    const expected = Buffer.from(challenge.code_hash, "base64url");
    const actual = Buffer.from(this.codeHash(challenge.phone_e164, input.code), "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw invalidChallenge();

    await transaction`
      update phone_verifications set consumed_at = now() where id = ${challenge.id}
    `;
  }
}
