import {
  LoginRequest,
  PasswordResetRequest,
  RegisterRequest,
  type DeviceLoginMetadata as DeviceLoginInput,
} from "@tashan/contracts";

import type { DatabaseClient } from "../db/client.js";
import type { TransactionClient } from "../db/transaction.js";
import type { PhoneVerificationService } from "../phone/phone-verification-service.js";
import { AuthError, invalidCredentials } from "./auth-errors.js";
import { type AccessTokenInput, AccessTokenService } from "./access-token.js";
import { hashPassword, verifyPassword } from "./password.js";
import { generateRefreshToken, hashRefreshToken } from "./refresh-token.js";
import { createPersonalSpace } from "../spaces/space-bootstrap.js";
import { SessionAuthenticator } from "./session-authenticator.js";

export interface LoginRateLimiter {
  consume(key: string): Promise<boolean>;
}

export interface AuthServiceOptions {
  sql: DatabaseClient;
  tokenService: AccessTokenService;
  rateLimiter: LoginRateLimiter;
  phones: PhoneVerificationService;
}

interface SessionResult {
  accountId: string;
  principalId: string;
  sessionId: string;
  deviceId: string;
  tokenVersion: number;
  accessToken: string;
  refreshToken: string;
}

function validationError(): AuthError {
  return new AuthError("VALIDATION_FAILED", "request validation failed");
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint_name" in error &&
    error.constraint_name === constraint
  );
}

export class AuthService {
  private readonly sql: DatabaseClient;
  private readonly tokenService: AccessTokenService;
  private readonly rateLimiter: LoginRateLimiter;
  private readonly phones: PhoneVerificationService;
  private readonly sessionAuthenticator: SessionAuthenticator;

  public constructor(options: AuthServiceOptions) {
    this.sql = options.sql;
    this.tokenService = options.tokenService;
    this.rateLimiter = options.rateLimiter;
    this.phones = options.phones;
    this.sessionAuthenticator = new SessionAuthenticator(options.sql, options.tokenService);
  }

  private async createSession(
    transaction: TransactionClient,
    identity: { accountId: string; principalId: string },
    device: DeviceLoginInput,
  ): Promise<SessionResult> {
    const devices = await transaction<{ id: string }[]>`
      insert into devices (id, account_id, name, os, architecture, client_version)
      values (
        ${device.id}, ${identity.accountId}, ${device.name}, ${device.os},
        ${device.architecture}, ${device.clientVersion}
      )
      on conflict (id) do update set
        name = excluded.name,
        os = excluded.os,
        architecture = excluded.architecture,
        client_version = excluded.client_version,
        last_seen_at = now(),
        updated_at = now()
      where devices.account_id = excluded.account_id and devices.revoked_at is null
      returning id
    `;
    if (devices.length !== 1) throw new AuthError("DEVICE_REVOKED", "device is unavailable");

    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const [session] = await transaction<{ id: string; token_version: number }[]>`
      insert into sessions (
        account_id, principal_id, device_id, refresh_token_hash,
        token_version, client_channel, expires_at
      ) values (
        ${identity.accountId}, ${identity.principalId}, ${device.id}, ${refreshTokenHash},
        1, ${device.channel}, now() + interval '30 days'
      )
      returning id, token_version
    `;
    if (session === undefined) throw new Error("session creation returned no row");
    await transaction`
      insert into session_refresh_tokens (token_hash, session_id, token_version)
      values (${refreshTokenHash}, ${session.id}, ${session.token_version})
    `;

    const accessToken = await this.tokenService.sign({
      subject: identity.accountId,
      principalId: identity.principalId,
      sessionId: session.id,
      deviceId: device.id,
      tokenVersion: session.token_version,
      actorSource: device.channel,
    });
    return {
      accountId: identity.accountId,
      principalId: identity.principalId,
      sessionId: session.id,
      deviceId: device.id,
      tokenVersion: session.token_version,
      accessToken,
      refreshToken,
    };
  }

  public async register(
    rawInput: unknown,
    existingTransaction?: TransactionClient,
  ): Promise<SessionResult> {
    const parsed = RegisterRequest.safeParse(rawInput);
    if (!parsed.success) throw validationError();

    const input = parsed.data;
    const passwordHash = await hashPassword(input.password);
    try {
      const operation = async (transaction: TransactionClient) => {
        await this.phones.consume(
          {
            phone: input.phone,
            purpose: "register",
            challengeId: input.challengeId,
            code: input.code,
          },
          transaction,
        );
        const verifiedAt = new Date();
        const [account] = await transaction<{ id: string }[]>`
          insert into accounts (display_name, password_hash, phone_e164, phone_verified_at)
          values (${`用户${input.phone.slice(-4)}`}, ${passwordHash}, ${input.phone}, ${verifiedAt})
          returning id
        `;
        if (account === undefined) throw new Error("account registration returned no row");
        const [principal] = await transaction<{ id: string }[]>`
          insert into principals (account_id, type)
          values (${account.id}, 'human')
          returning id
        `;
        if (principal === undefined) throw new Error("Principal registration returned no row");
        await createPersonalSpace(transaction, account.id);
        await transaction`
          update phone_verifications set account_id = ${account.id} where id = ${input.challengeId}
        `;
        return this.createSession(
          transaction,
          { accountId: account.id, principalId: principal.id },
          input.device,
        );
      };
      return existingTransaction === undefined
        ? ((await this.sql.begin(operation)) as SessionResult)
        : await operation(existingTransaction);
    } catch (error) {
      if (isUniqueViolation(error, "accounts_phone_e164_key")) {
        throw new AuthError("ACCOUNT_EXISTS", "an account already exists for this phone");
      }
      throw error;
    }
  }

  public async login(
    rawInput: unknown,
    context: { serverIp: string },
    existingTransaction?: TransactionClient,
  ): Promise<SessionResult> {
    const parsed = LoginRequest.safeParse(rawInput);
    if (!parsed.success) throw validationError();
    const input = parsed.data;
    const phone = input.phone;
    const allowed = await Promise.all([
      this.rateLimiter.consume(`login:phone:${phone}`),
      this.rateLimiter.consume(`login:ip:${context.serverIp}`),
    ]);
    if (allowed.includes(false)) throw new AuthError("RATE_LIMITED", "login rate limit exceeded");

    const identityQuery = existingTransaction ?? this.sql;
    const [identity] = await identityQuery<
      {
        account_id: string;
        password_hash: string;
        account_status: string;
        principal_id: string;
      }[]
    >`
      select
        a.id as account_id,
        a.password_hash,
        a.status as account_status,
        p.id as principal_id
      from accounts a
      join principals p on p.account_id = a.id and p.type = 'human'
      where a.phone_e164 = ${phone}
    `;
    if (identity === undefined) {
      await hashPassword(input.password);
      throw invalidCredentials();
    }
    const passwordMatches = await verifyPassword(identity.password_hash, input.password);
    if (!passwordMatches || identity.account_status !== "active") throw invalidCredentials();

    const operation = (transaction: TransactionClient): Promise<SessionResult> =>
      this.createSession(
        transaction,
        { accountId: identity.account_id, principalId: identity.principal_id },
        input.device,
      );
    return existingTransaction === undefined
      ? ((await this.sql.begin(operation)) as SessionResult)
      : operation(existingTransaction);
  }

  public async resetPassword(
    rawInput: unknown,
    existingTransaction?: TransactionClient,
  ): Promise<void> {
    const parsed = PasswordResetRequest.safeParse(rawInput);
    if (!parsed.success) throw validationError();
    const input = parsed.data;
    const passwordHash = await hashPassword(input.newPassword);
    const operation = async (transaction: TransactionClient) => {
      await this.phones.consume(
        {
          phone: input.phone,
          purpose: "password_reset",
          challengeId: input.challengeId,
          code: input.code,
        },
        transaction,
      );
      const [account] = await transaction<{ id: string }[]>`
        select id from accounts where phone_e164 = ${input.phone} and status = 'active' for update
      `;
      if (account === undefined) {
        throw new AuthError("PASSWORD_RESET_FAILED", "password reset could not be completed");
      }
      await transaction`
        update accounts set password_hash = ${passwordHash}, updated_at = now() where id = ${account.id}
      `;
      await transaction`
        update sessions
        set revoked_at = coalesce(revoked_at, now()), token_version = token_version + 1, updated_at = now()
        where account_id = ${account.id} and revoked_at is null
      `;
      await transaction`
        update session_refresh_tokens set status = 'revoked'
        where session_id in (select id from sessions where account_id = ${account.id})
      `;
      await transaction`
        update phone_verifications set account_id = ${account.id} where id = ${input.challengeId}
      `;
    };
    if (existingTransaction === undefined) await this.sql.begin(operation);
    else await operation(existingTransaction);
  }

  public async authenticate(accessToken: string) {
    return this.sessionAuthenticator.authenticate(accessToken);
  }

  public async refresh(
    rawRefreshToken: string,
    existingTransaction?: TransactionClient,
  ): Promise<SessionResult> {
    const presentedHash = hashRefreshToken(rawRefreshToken);
    const operation = async (transaction: TransactionClient) => {
      const [history] = await transaction<
        { session_id: string; token_version: number; status: "active" | "rotated" | "revoked" }[]
      >`
        select session_id, token_version, status
        from session_refresh_tokens
        where token_hash = ${presentedHash}
        for update
      `;
      if (history === undefined) return { kind: "invalid" } as const;
      if (history.status !== "active") {
        await transaction`
          update sessions
          set revoked_at = coalesce(revoked_at, now()), token_version = token_version + 1, updated_at = now()
          where id = ${history.session_id}
        `;
        await transaction`
          update session_refresh_tokens set status = 'revoked'
          where session_id = ${history.session_id}
        `;
        return { kind: "reuse" } as const;
      }

      const [session] = await transaction<
        {
          id: string;
          account_id: string;
          principal_id: string;
          device_id: string;
          refresh_token_hash: string;
          token_version: number;
          client_channel: "web" | "cli";
          expires_at: Date;
          revoked_at: Date | null;
          device_revoked_at: Date | null;
          account_status: string;
        }[]
      >`
        select
          s.id, s.account_id, s.principal_id, s.device_id, s.refresh_token_hash,
          s.token_version, s.client_channel, s.expires_at, s.revoked_at,
          d.revoked_at as device_revoked_at, a.status as account_status
        from sessions s
        join devices d on d.id = s.device_id
        join accounts a on a.id = s.account_id
        where s.id = ${history.session_id}
        for update of s
      `;
      if (
        session === undefined ||
        session.revoked_at !== null ||
        session.device_revoked_at !== null ||
        session.account_status !== "active" ||
        session.expires_at.getTime() <= Date.now()
      ) {
        return { kind: "invalid" } as const;
      }

      const nextRefreshToken = generateRefreshToken();
      const nextHash = hashRefreshToken(nextRefreshToken);
      const [rotated] = await transaction<{ token_version: number }[]>`
        update sessions
        set refresh_token_hash = ${nextHash}, token_version = token_version + 1, updated_at = now()
        where id = ${session.id}
          and refresh_token_hash = ${presentedHash}
          and token_version = ${history.token_version}
          and revoked_at is null
        returning token_version
      `;
      if (rotated === undefined) return { kind: "invalid" } as const;

      await transaction`
        update session_refresh_tokens
        set status = 'rotated', replaced_by_hash = ${nextHash}, used_at = now()
        where token_hash = ${presentedHash}
      `;
      await transaction`
        insert into session_refresh_tokens (token_hash, session_id, token_version)
        values (${nextHash}, ${session.id}, ${rotated.token_version})
      `;

      const tokenInput: AccessTokenInput = {
        subject: session.account_id,
        principalId: session.principal_id,
        sessionId: session.id,
        deviceId: session.device_id,
        tokenVersion: rotated.token_version,
        actorSource: session.client_channel,
      };
      return {
        kind: "rotated",
        result: {
          accountId: session.account_id,
          principalId: session.principal_id,
          sessionId: session.id,
          deviceId: session.device_id,
          tokenVersion: rotated.token_version,
          accessToken: await this.tokenService.sign(tokenInput),
          refreshToken: nextRefreshToken,
        },
      } as const;
    };
    const outcome =
      existingTransaction === undefined
        ? await this.sql.begin(operation)
        : await operation(existingTransaction);

    if (outcome.kind !== "rotated") {
      throw new AuthError("AUTH_TOKEN_REVOKED", "refresh token is invalid or reused");
    }
    return outcome.result;
  }

  public async logout(
    rawRefreshToken: string,
    existingTransaction?: TransactionClient,
    expectedSessionId?: string,
  ): Promise<void> {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const operation = async (transaction: TransactionClient) => {
      const [history] = await transaction<{ session_id: string }[]>`
        select session_id from session_refresh_tokens where token_hash = ${tokenHash} for update
      `;
      if (history === undefined) return;
      if (expectedSessionId !== undefined && history.session_id !== expectedSessionId) {
        throw new AuthError("AUTH_TOKEN_REVOKED", "refresh token does not belong to this session");
      }
      await transaction`
        update sessions
        set revoked_at = coalesce(revoked_at, now()), token_version = token_version + 1, updated_at = now()
        where id = ${history.session_id}
      `;
      await transaction`
        update session_refresh_tokens set status = 'revoked'
        where session_id = ${history.session_id}
      `;
    };
    if (existingTransaction === undefined) await this.sql.begin(operation);
    else await operation(existingTransaction);
  }

  public async logoutSession(
    sessionId: string,
    existingTransaction?: TransactionClient,
  ): Promise<void> {
    const operation = async (transaction: TransactionClient) => {
      await transaction`
        update sessions
        set revoked_at = coalesce(revoked_at, now()), token_version = token_version + 1, updated_at = now()
        where id = ${sessionId}
      `;
      await transaction`
        update session_refresh_tokens set status = 'revoked' where session_id = ${sessionId}
      `;
    };
    if (existingTransaction === undefined) await this.sql.begin(operation);
    else await operation(existingTransaction);
  }
}
