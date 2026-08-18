import type { FastifyInstance, preHandlerHookHandler } from "fastify";

import {
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  LogoutResponse,
  RefreshRequest,
  RefreshResponse,
  RegisterRequest,
  RegisterResponse,
  WhoAmIResponse,
} from "@tashan/contracts";

import type { AuthService } from "../auth/auth-service.js";
import type { DatabaseClient } from "../db/client.js";
import type { TransactionClient } from "../db/transaction.js";
import type { MutationCoordinator } from "../http/idempotency.js";
import { requestContext } from "../http/request-context.js";
import { accountAndPrincipalSummary } from "./route-helpers.js";

interface AuthRouteDependencies {
  sql: DatabaseClient;
  auth: AuthService;
  mutations: MutationCoordinator;
  authenticate: preHandlerHookHandler;
}

function tokenTimes() {
  const now = Date.now();
  return {
    accessTokenExpiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

async function authenticatedDevice(transaction: TransactionClient, sessionId: string) {
  const [row] = await transaction<
    {
      account_id: string;
      principal_id: string;
      device_id: string;
      client_channel: "web" | "cli";
      name: string;
      os: string;
      architecture: string;
      client_version: string;
    }[]
  >`
    select
      s.account_id, s.principal_id, s.device_id, s.client_channel,
      d.name, d.os, d.architecture, d.client_version
    from sessions s join devices d on d.id = s.device_id
    where s.id = ${sessionId}
  `;
  if (row === undefined) throw new Error("session identity disappeared");
  return {
    accountId: row.account_id,
    principalId: row.principal_id,
    sessionId,
    deviceId: row.device_id,
    actorSource: row.client_channel,
    deviceMetadata: {
      name: row.name,
      os: row.os,
      architecture: row.architecture,
      clientVersion: row.client_version,
    },
  };
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  dependencies: AuthRouteDependencies,
): Promise<void> {
  app.post(
    "/v1/auth/register",
    { config: { capabilityId: "auth.register" } },
    async (request, reply) => {
      const body = RegisterRequest.parse(request.body);
      const context = requestContext(request);
      const result = await dependencies.mutations.executeIdempotent({
        request,
        capabilityId: "auth.register",
        actorKey: `registration:${context.clientIp}:${body.username.toLowerCase()}`,
        idempotencyInput: body,
        work: async (transaction) => {
          const identity = await dependencies.auth.register(body, transaction);
          context.accountId = identity.accountId;
          context.principalId = identity.principalId;
          const summaries = await accountAndPrincipalSummary(
            transaction,
            identity.accountId,
            identity.principalId,
          );
          return { statusCode: 201, body: RegisterResponse.parse(summaries) };
        },
      });
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.post("/v1/auth/login", { config: { capabilityId: "auth.login" } }, async (request, reply) => {
    const body = LoginRequest.parse(request.body);
    const result = await dependencies.mutations.executeSessionMutation(
      request,
      "auth.login",
      async (transaction) => {
        const session = await dependencies.auth.login(
          body,
          { serverIp: requestContext(request).clientIp },
          transaction,
        );
        requestContext(request).identity = {
          accountId: session.accountId,
          principalId: session.principalId,
          sessionId: session.sessionId,
          deviceId: session.deviceId,
          actorSource: body.device.channel,
          deviceMetadata: {
            name: body.device.name,
            os: body.device.os,
            architecture: body.device.architecture,
            clientVersion: body.device.clientVersion,
          },
        };
        const summaries = await accountAndPrincipalSummary(
          transaction,
          session.accountId,
          session.principalId,
        );
        const times = tokenTimes();
        return {
          statusCode: 200,
          body: LoginResponse.parse({
            ...summaries,
            sessionId: session.sessionId,
            deviceId: session.deviceId,
            tokens: {
              tokenType: "Bearer",
              accessToken: session.accessToken,
              accessTokenExpiresAt: times.accessTokenExpiresAt,
              refreshToken: session.refreshToken,
              refreshTokenExpiresAt: times.refreshTokenExpiresAt,
            },
          }),
        };
      },
    );
    return reply.code(result.statusCode).send(result.body);
  });

  app.post(
    "/v1/auth/refresh",
    { config: { capabilityId: "auth.refresh" } },
    async (request, reply) => {
      const body = RefreshRequest.parse(request.body);
      const result = await dependencies.mutations.executeSessionMutation(
        request,
        "auth.refresh",
        async (transaction) => {
          const session = await dependencies.auth.refresh(body.refreshToken, transaction);
          requestContext(request).identity = await authenticatedDevice(
            transaction,
            session.sessionId,
          );
          const times = tokenTimes();
          return {
            statusCode: 200,
            body: RefreshResponse.parse({
              sessionId: session.sessionId,
              deviceId: session.deviceId,
              tokens: {
                tokenType: "Bearer",
                accessToken: session.accessToken,
                accessTokenExpiresAt: times.accessTokenExpiresAt,
                refreshToken: session.refreshToken,
                refreshTokenExpiresAt: times.refreshTokenExpiresAt,
              },
            }),
          };
        },
      );
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/v1/auth/logout",
    { config: { capabilityId: "auth.logout" }, preHandler: dependencies.authenticate },
    async (request, reply) => {
      const body = LogoutRequest.parse(request.body ?? {});
      const identity = requestContext(request).identity;
      if (identity === undefined) throw new Error("authenticated identity is missing");
      const result = await dependencies.mutations.executeSessionMutation(
        request,
        "auth.logout",
        async (transaction) => {
          if (body.refreshToken === undefined) {
            await dependencies.auth.logoutSession(identity.sessionId, transaction);
          } else {
            await dependencies.auth.logout(body.refreshToken, transaction, identity.sessionId);
          }
          return { statusCode: 200, body: LogoutResponse.parse({ loggedOut: true }) };
        },
      );
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.get(
    "/v1/auth/whoami",
    { config: { capabilityId: "auth.whoami" }, preHandler: dependencies.authenticate },
    async (request) => {
      const identity = requestContext(request).identity;
      if (identity === undefined) throw new Error("authenticated identity is missing");
      const summaries = await dependencies.sql.begin((transaction) =>
        accountAndPrincipalSummary(transaction, identity.accountId, identity.principalId),
      );
      return WhoAmIResponse.parse({
        ...summaries,
        sessionId: identity.sessionId,
        deviceId: identity.deviceId,
      });
    },
  );
}
