import type { DatabaseClient } from "../db/client.js";
import type { AccessTokenService } from "./access-token.js";
import { AuthError } from "./auth-errors.js";

export class SessionAuthenticator {
  public constructor(
    private readonly sql: DatabaseClient,
    private readonly tokenService: AccessTokenService,
  ) {}
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
        d.client_version as device_client_version, s.client_channel
      from sessions s join devices d on d.id=s.device_id join accounts a on a.id=s.account_id
      where s.id=${claims.sessionId}
    `;
    if (!session || session.session_revoked_at)
      throw new AuthError("AUTH_TOKEN_REVOKED", "session is revoked");
    if (session.device_revoked_at) throw new AuthError("DEVICE_REVOKED", "device is revoked");
    if (session.session_expires_at.getTime() <= Date.now())
      throw new AuthError("AUTH_TOKEN_EXPIRED", "session has expired");
    if (
      session.account_status !== "active" ||
      session.account_id !== claims.sub ||
      session.principal_id !== claims.principalId ||
      session.device_id !== claims.deviceId ||
      session.token_version !== claims.tokenVersion ||
      session.client_channel !== claims.actorSource
    )
      throw new AuthError("AUTH_TOKEN_REVOKED", "access token no longer matches its session");
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
}
