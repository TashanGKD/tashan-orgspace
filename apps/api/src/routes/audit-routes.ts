import type { FastifyInstance, preHandlerHookHandler } from "fastify";

import { AuditListQuery, AuditListResponse } from "@tashan/contracts";

import type { DatabaseClient } from "../db/client.js";
import { AuthError } from "../auth/auth-errors.js";
import { requestContext } from "../http/request-context.js";
import { requireOrganizationMembership } from "../organizations/authorization.js";

interface AuditListRow {
  id: string;
  organization_id: string | null;
  account_id: string | null;
  principal_id: string | null;
  session_id: string | null;
  device_id: string | null;
  server_ip: string;
  proxy_chain: unknown;
  device_metadata: unknown | null;
  actor_source: "web" | "cli" | "ai_via_cli" | "system";
  reported_actor_source: string | null;
  capability_id: string;
  action: string;
  object_type: string | null;
  object_id: string | null;
  result: "success" | "rejected" | "failure";
  error_code: string | null;
  request_id: string;
  idempotency_key: string | null;
  before_state: unknown | null;
  after_state: unknown | null;
  chain_position: string | number;
  created_at: Date;
}

function cursorPosition(cursor?: string): number | undefined {
  if (cursor === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(cursor)) {
    throw new AuthError("VALIDATION_FAILED", "audit cursor is invalid");
  }
  const parsed = Number(cursor);
  if (!Number.isSafeInteger(parsed)) {
    throw new AuthError("VALIDATION_FAILED", "audit cursor is invalid");
  }
  return parsed;
}

export async function registerAuditRoutes(
  app: FastifyInstance,
  dependencies: { sql: DatabaseClient; authenticate: preHandlerHookHandler },
): Promise<void> {
  app.get(
    "/v1/audit-events",
    { config: { capabilityId: "audit.list" }, preHandler: dependencies.authenticate },
    async (request) => {
      const query = AuditListQuery.parse(request.query);
      const identity = requestContext(request).identity;
      if (identity === undefined) throw new Error("authenticated identity is missing");
      const cursor = cursorPosition(query.cursor);
      const requestedLimit = query.limit + 1;

      let rows: AuditListRow[];
      if (query.organizationId === undefined) {
        rows = await dependencies.sql<AuditListRow[]>`
            select * from audit_events
            where account_id = ${identity.accountId}
              and organization_id is null
              and (${cursor ?? null}::bigint is null or chain_position < ${cursor ?? null})
            order by chain_position desc
            limit ${requestedLimit}
          `;
      } else {
        const organizationId = query.organizationId;
        requestContext(request).organizationId = organizationId;
        rows = (await dependencies.sql.begin(async (transaction) => {
          await requireOrganizationMembership(transaction, identity.accountId, organizationId);
          return transaction<AuditListRow[]>`
              select * from audit_events
              where organization_id = ${organizationId}
                and (${cursor ?? null}::bigint is null or chain_position < ${cursor ?? null})
              order by chain_position desc
              limit ${requestedLimit}
            `;
        })) as AuditListRow[];
      }

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      return AuditListResponse.parse({
        items: page.map((row) => ({
          id: row.id,
          organizationId: row.organization_id,
          accountId: row.account_id,
          principalId: row.principal_id,
          sessionId: row.session_id,
          deviceId: row.device_id,
          serverIp: row.server_ip,
          proxyChain: row.proxy_chain,
          device: row.device_metadata,
          actorSource: row.actor_source,
          reportedActorSource: row.reported_actor_source,
          capabilityId: row.capability_id,
          action: row.action,
          objectType: row.object_type,
          objectId: row.object_id,
          result: row.result,
          errorCode: row.error_code,
          requestId: row.request_id,
          idempotencyKey: row.idempotency_key,
          before: row.before_state,
          after: row.after_state,
          occurredAt: row.created_at.toISOString(),
        })),
        nextCursor: hasMore ? String(page.at(-1)?.chain_position) : null,
      });
    },
  );
}
