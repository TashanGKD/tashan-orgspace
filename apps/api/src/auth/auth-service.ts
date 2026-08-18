import { LoginRequest, RegisterRequest } from "@tashan/contracts";

import type { DatabaseClient } from "../db/client.js";
import type { TransactionClient } from "../db/transaction.js";
import { AuthError, invalidCredentials } from "./auth-errors.js";
import { type AccessTokenInput, AccessTokenService } from "./access-token.js";
import { hashPassword, verifyPassword } from "./password.js";
import { generateRefreshToken, hashRefreshToken } from "./refresh-token.js";

export interface LoginRateLimiter {
  consume(key: string): Promise<boolean>;
}

export interface AuthServiceOptions {
  sql: DatabaseClient;
  tokenService: AccessTokenService;
  rateLimiter: LoginRateLimiter;
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

  public constructor(options: AuthServiceOptions) {
    this.sql = options.sql;
    this.tokenService = options.tokenService;
    this.rateLimiter = options.rateLimiter;
  }

  public async register(
    rawInput: unknown,
    existingTransaction?: TransactionClient,
  ): Promise<{ accountId: string; principalId: string }> {
    const parsed = RegisterRequest.safeParse(rawInput);
    if (!parsed.success) throw validationError();

    const username = parsed.data.username.toLowerCase();
    const passwordHash = await hashPassword(parsed.data.password);
    try {
      const operation = async (transaction: TransactionClient) => {
        const [account] = await transaction<{ id: string }[]>`
          insert into accounts (username, password_hash)
          values (${username}, ${passwordHash})
          returning id
        `;
        if (account === undefined) throw new Error("account registration returned no row");
        const [principal] = await transaction<{ id: string }[]>`
          insert into principals (account_id, type)
          values (${account.id}, 'human')
          returning id
        `;
        if (principal === undefined) throw new Error("Principal registration returned no row");
        return { accountId: account.id, principalId: principal.id };
      };
      return existingTransaction === undefined
        ? ((await this.sql.begin(operation)) as { accountId: string; principalId: string })
        : await operation(existingTransaction);
    } catch (error) {
      if (isUniqueViolation(error, "accounts_username_key")) {
        throw new AuthError("USERNAME_TAKEN", "username is already registered");
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
    const normalizedUsername = input.username.toLowerCase();
    const allowed = await Promise.all([
      this.rateLimiter.consume(`login:username:${normalizedUsername}`),
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
      where a.username = ${normalizedUsername}
    `;
    if (identity === undefined) {
      await hashPassword(input.password);
      throw invalidCredentials();
    }
    const passwordMatches = await verifyPassword(identity.password_hash, input.password);
    if (!passwordMatches || identity.account_status !== "active") throw invalidCredentials();

    const operation = async (transaction: TransactionClient): Promise<SessionResult> => {
      const devices = await transaction<{ id: string }[]>`
        insert into devices (id, account_id, name, os, architecture, client_version)
        values (
          ${input.device.id}, ${identity.account_id}, ${input.device.name}, ${input.device.os},
          ${input.device.architecture}, ${input.device.clientVersion}
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
          ${identity.account_id}, ${identity.principal_id}, ${input.device.id}, ${refreshTokenHash},
          1, ${input.device.channel}, now() + interval '30 days'
        )
        returning id, token_version
      `;
      if (session === undefined) throw new Error("session creation returned no row");
      await transaction`
        insert into session_refresh_tokens (token_hash, session_id, token_version)
        values (${refreshTokenHash}, ${session.id}, ${session.token_version})
      `;

      const accessToken = await this.tokenService.sign({
        subject: identity.account_id,
        principalId: identity.principal_id,
        sessionId: session.id,
        deviceId: input.device.id,
        tokenVersion: session.token_version,
        actorSource: input.device.channel,
      });
      return {
        accountId: identity.account_id,
        principalId: identity.principal_id,
        sessionId: session.id,
        deviceId: input.device.id,
        tokenVersion: session.token_version,
        accessToken,
        refreshToken,
      };
    };
    return existingTransaction === undefined
      ? ((await this.sql.begin(operation)) as SessionResult)
      : operation(existingTransaction);
  }

  public async authenticate(accessToken: string) {
    const claims = await this.tokenService.verify(accessToken);
    const [session] = await this.sql<
      {
        account_id: string;
        principal_id: string;
        device_id: string;
        token_version: number;
        session_expires_at: Date;
        session_revoked_at: Date | null;
        device_revoked_at: Date | null;
        account_status: string;
        client_channel: "web" | "cli";
        device_name: string;
        device_os: string;
        device_architecture: string;
        device_client_version: string;
      }[]
    >`
      select
        s.account_id, s.principal_id, s.device_id, s.token_version,
        s.expires_at as session_expires_at, s.revoked_at as session_revoked_at,
        d.revoked_at as device_revoked_at, a.status as account_status,
        d.name as device_name, d.os as device_os, d.architecture as device_architecture,
        d.client_version as device_client_version,
        s.client_channel
      from sessions s
      join devices d on d.id = s.device_id
      join accounts a on a.id = s.account_id
      where s.id = ${claims.sessionId}
    `;
    if (session === undefined || session.session_revoked_at !== null) {
      throw new AuthError("AUTH_TOKEN_REVOKED", "session is revoked");
    }
    if (session.device_revoked_at !== null) {
      throw new AuthError("DEVICE_REVOKED", "device is revoked");
    }
    if (session.session_expires_at.getTime() <= Date.now()) {
      throw new AuthError("AUTH_TOKEN_EXPIRED", "session has expired");
    }
    if (
      session.account_status !== "active" ||
      session.account_id !== claims.sub ||
      session.principal_id !== claims.principalId ||
      session.device_id !== claims.deviceId ||
      session.token_version !== claims.tokenVersion ||
      session.client_channel !== claims.actorSource
    ) {
      throw new AuthError("AUTH_TOKEN_REVOKED", "access token no longer matches its session");
    }

    return {
      accountId: session.account_id,
      principalId: session.principal_id,
      sessionId: claims.sessionId,
      deviceId: session.device_id,
      tokenVersion: session.token_version,
      actorSource: session.client_channel,
      deviceMetadata: {
        name: session.device_name,
        os: session.device_os,
        architecture: session.device_architecture,
        clientVersion: session.device_client_version,
      },
    };
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
