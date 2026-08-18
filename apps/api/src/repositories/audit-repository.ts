import type { JSONValue } from "postgres";

import type { TransactionClient } from "../db/transaction.js";

export interface AppendAuditInput {
  organizationId?: string;
  accountId?: string;
  principalId?: string;
  sessionId?: string;
  deviceId?: string;
  serverIp: string;
  proxyChain?: string[];
  deviceMetadata?: Record<string, JSONValue | undefined>;
  actorSource: "web" | "cli" | "ai_via_cli" | "system";
  capabilityId: string;
  action: string;
  objectType?: string;
  objectId?: string;
  result: "success" | "rejected" | "failure";
  errorCode?: string;
  requestId: string;
  idempotencyKey?: string;
  beforeState?: Record<string, JSONValue | undefined>;
  afterState?: Record<string, JSONValue | undefined>;
  prevHash?: string;
  eventHash: string;
}

export class AuditRepository {
  public async append(transaction: TransactionClient, input: AppendAuditInput) {
    const [event] = await transaction<{ id: string }[]>`
      insert into audit_events (
        organization_id, account_id, principal_id, session_id, device_id,
        server_ip, proxy_chain, device_metadata, actor_source,
        capability_id, action, object_type, object_id, result, error_code,
        request_id, idempotency_key, before_state, after_state, prev_hash, event_hash
      ) values (
        ${input.organizationId ?? null}, ${input.accountId ?? null}, ${input.principalId ?? null},
        ${input.sessionId ?? null}, ${input.deviceId ?? null}, ${input.serverIp},
        ${transaction.json(input.proxyChain ?? [])},
        ${input.deviceMetadata === undefined ? null : transaction.json(input.deviceMetadata)},
        ${input.actorSource}, ${input.capabilityId}, ${input.action},
        ${input.objectType ?? null}, ${input.objectId ?? null}, ${input.result},
        ${input.errorCode ?? null}, ${input.requestId}, ${input.idempotencyKey ?? null},
        ${input.beforeState === undefined ? null : transaction.json(input.beforeState)},
        ${input.afterState === undefined ? null : transaction.json(input.afterState)},
        ${input.prevHash ?? null}, ${input.eventHash}
      )
      returning id
    `;
    if (event === undefined) throw new Error("audit insert returned no row");
    return event;
  }
}
