import type { FastifyInstance, preHandlerHookHandler } from "fastify";

import { DeviceIdPath, DeviceListResponse, DeviceRevokeResponse } from "@tashan/contracts";

import { AuthError } from "../auth/auth-errors.js";
import type { DatabaseClient } from "../db/client.js";
import type { MutationCoordinator } from "../http/idempotency.js";
import { requestContext } from "../http/request-context.js";

export async function registerDeviceRoutes(
  app: FastifyInstance,
  dependencies: {
    sql: DatabaseClient;
    mutations: MutationCoordinator;
    authenticate: preHandlerHookHandler;
  },
): Promise<void> {
  app.get(
    "/v1/devices",
    { config: { capabilityId: "device.list" }, preHandler: dependencies.authenticate },
    async (request) => {
      const identity = requestContext(request).identity;
      if (identity === undefined) throw new Error("authenticated identity is missing");
      const rows = await dependencies.sql<
        {
          id: string;
          name: string;
          os: string;
          architecture: string;
          client_version: string;
          first_seen_at: Date;
          last_seen_at: Date;
          revoked_at: Date | null;
        }[]
      >`
        select id, name, os, architecture, client_version, first_seen_at, last_seen_at, revoked_at
        from devices where account_id = ${identity.accountId}
        order by last_seen_at desc, id
      `;
      return DeviceListResponse.parse({
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          os: row.os,
          architecture: row.architecture,
          clientVersion: row.client_version,
          firstSeenAt: row.first_seen_at.toISOString(),
          lastSeenAt: row.last_seen_at.toISOString(),
          current: row.id === identity.deviceId,
          revokedAt: row.revoked_at?.toISOString() ?? null,
        })),
      });
    },
  );

  app.delete(
    "/v1/devices/:deviceId",
    { config: { capabilityId: "device.revoke" }, preHandler: dependencies.authenticate },
    async (request, reply) => {
      const { deviceId } = DeviceIdPath.parse(request.params);
      const identity = requestContext(request).identity;
      if (identity === undefined) throw new Error("authenticated identity is missing");
      const result = await dependencies.mutations.executeIdempotent({
        request,
        capabilityId: "device.revoke",
        actorPrincipalId: identity.principalId,
        idempotencyInput: { deviceId },
        work: async (transaction) => {
          const [device] = await transaction<{ revoked_at: Date }[]>`
            update devices
            set revoked_at = coalesce(revoked_at, now()), updated_at = now()
            where id = ${deviceId} and account_id = ${identity.accountId}
            returning revoked_at
          `;
          if (device === undefined) {
            throw new AuthError("DEVICE_REVOKED", "device is unavailable");
          }
          await transaction`
            update sessions
            set revoked_at = coalesce(revoked_at, now()), token_version = token_version + 1, updated_at = now()
            where device_id = ${deviceId} and account_id = ${identity.accountId} and revoked_at is null
          `;
          await transaction`
            update session_refresh_tokens
            set status = 'revoked'
            where session_id in (
              select id from sessions where device_id = ${deviceId} and account_id = ${identity.accountId}
            )
          `;
          return {
            statusCode: 200,
            body: DeviceRevokeResponse.parse({
              deviceId,
              revokedAt: device.revoked_at.toISOString(),
            }),
          };
        },
      });
      return reply.code(result.statusCode).send(result.body);
    },
  );
}
