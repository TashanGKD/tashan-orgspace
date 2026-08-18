import { createHash, randomUUID } from "node:crypto";

import type { JSONValue } from "postgres";

import type { DatabaseClient } from "../db/client.js";
import type { TransactionClient } from "../db/transaction.js";
import { normalizeIpAddress } from "../http/trusted-proxy.js";
import { AuditRepository } from "../repositories/audit-repository.js";
import { redact, type AuditJsonValue } from "./redaction.js";

const GENESIS_HASH = "GENESIS";

type AuditObject = Record<string, AuditJsonValue>;

export interface AppendAuditEventInput {
  organizationId?: string;
  accountId?: string;
  principalId?: string;
  sessionId?: string;
  deviceId?: string;
  serverIp: string;
  proxyChain?: string[];
  deviceMetadata?: Record<string, unknown>;
  actorSource: "web" | "cli" | "ai_via_cli" | "system";
  reportedActorSource?: string;
  capabilityId: string;
  action: string;
  objectType?: string;
  objectId?: string;
  result: "success" | "rejected" | "failure";
  errorCode?: string;
  requestId: string;
  idempotencyKey?: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
}

interface StoredAuditEvent {
  id: string;
  organization_id: string | null;
  account_id: string | null;
  principal_id: string | null;
  session_id: string | null;
  device_id: string | null;
  server_ip: string;
  proxy_chain: AuditJsonValue;
  device_metadata: AuditJsonValue | null;
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
  before_state: AuditJsonValue | null;
  after_state: AuditJsonValue | null;
  prev_hash: string | null;
  event_hash: string;
  chain_position: string | number;
  created_at: Date;
}

interface AuditHashPayload {
  id: string;
  organizationId: string | null;
  accountId: string | null;
  principalId: string | null;
  sessionId: string | null;
  deviceId: string | null;
  serverIp: string;
  proxyChain: AuditJsonValue;
  deviceMetadata: AuditJsonValue | null;
  actorSource: string;
  reportedActorSource: string | null;
  capabilityId: string;
  action: string;
  objectType: string | null;
  objectId: string | null;
  result: string;
  errorCode: string | null;
  requestId: string;
  idempotencyKey: string | null;
  beforeState: AuditJsonValue | null;
  afterState: AuditJsonValue | null;
  chainPosition: number;
  createdAt: string;
}

function normalizeForCanonicalJson(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("canonical JSON requires a finite JSON number");
    return value;
  }
  if (typeof value !== "object")
    throw new TypeError("canonical JSON requires JSON-compatible values");
  if (ancestors.has(value)) throw new TypeError("canonical JSON payload contains a cycle");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => normalizeForCanonicalJson(item, ancestors));
    }
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new TypeError("canonical JSON requires plain objects");
    }
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalizeForCanonicalJson(child, ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeForCanonicalJson(value, new WeakSet<object>()));
}

function eventHash(previousHash: string, payload: AuditHashPayload): string {
  return createHash("sha256")
    .update(`${previousHash}.${canonicalJson(payload)}`)
    .digest("hex");
}

function redactedObject(value: Record<string, unknown> | undefined): AuditObject | null {
  if (value === undefined) return null;
  const redacted = redact(value);
  if (redacted === null || Array.isArray(redacted) || typeof redacted !== "object") {
    throw new TypeError("audit object field must remain a JSON object after redaction");
  }
  return redacted;
}

function payloadFromStored(row: StoredAuditEvent): AuditHashPayload {
  return {
    id: row.id,
    organizationId: row.organization_id,
    accountId: row.account_id,
    principalId: row.principal_id,
    sessionId: row.session_id,
    deviceId: row.device_id,
    serverIp: row.server_ip,
    proxyChain: row.proxy_chain,
    deviceMetadata: row.device_metadata,
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
    beforeState: row.before_state,
    afterState: row.after_state,
    chainPosition: Number(row.chain_position),
    createdAt: row.created_at.toISOString(),
  };
}

function auditScope(organizationId?: string): string {
  return organizationId === undefined ? "audit:platform" : `audit:organization:${organizationId}`;
}

export class AuditService {
  private readonly repository = new AuditRepository();

  public constructor(
    private readonly sql: DatabaseClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async append(
    input: AppendAuditEventInput,
    existingTransaction?: TransactionClient,
  ): Promise<{ id: string; eventHash: string }> {
    const operation = async (transaction: TransactionClient) => {
      await transaction`select pg_advisory_xact_lock(hashtextextended(${auditScope(input.organizationId)}, 0))`;
      const [previous] = await transaction<
        { event_hash: string; chain_position: string | number }[]
      >`
        select event_hash, chain_position
        from audit_events
        where organization_id is not distinct from ${input.organizationId ?? null}
        order by chain_position desc
        limit 1
      `;

      const id = randomUUID();
      const createdAt = this.clock();
      if (Number.isNaN(createdAt.getTime()))
        throw new TypeError("audit clock returned an invalid date");
      const previousHash = previous?.event_hash ?? GENESIS_HASH;
      const chainPosition = previous === undefined ? 1 : Number(previous.chain_position) + 1;
      const deviceMetadata = redactedObject(input.deviceMetadata);
      const beforeState = redactedObject(input.beforeState);
      const afterState = redactedObject(input.afterState);
      const serverIp = normalizeIpAddress(input.serverIp);
      const proxyChain = (input.proxyChain ?? []).map(normalizeIpAddress);
      const payload: AuditHashPayload = {
        id,
        organizationId: input.organizationId ?? null,
        accountId: input.accountId ?? null,
        principalId: input.principalId ?? null,
        sessionId: input.sessionId ?? null,
        deviceId: input.deviceId ?? null,
        serverIp,
        proxyChain,
        deviceMetadata,
        actorSource: input.actorSource,
        reportedActorSource: input.reportedActorSource ?? null,
        capabilityId: input.capabilityId,
        action: input.action,
        objectType: input.objectType ?? null,
        objectId: input.objectId ?? null,
        result: input.result,
        errorCode: input.errorCode ?? null,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey ?? null,
        beforeState,
        afterState,
        chainPosition,
        createdAt: createdAt.toISOString(),
      };
      const hash = eventHash(previousHash, payload);

      await this.repository.append(transaction, {
        id,
        ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
        ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
        ...(input.principalId === undefined ? {} : { principalId: input.principalId }),
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
        serverIp,
        proxyChain,
        ...(deviceMetadata === null
          ? {}
          : { deviceMetadata: deviceMetadata as Record<string, JSONValue | undefined> }),
        actorSource: input.actorSource,
        ...(input.reportedActorSource === undefined
          ? {}
          : { reportedActorSource: input.reportedActorSource }),
        capabilityId: input.capabilityId,
        action: input.action,
        ...(input.objectType === undefined ? {} : { objectType: input.objectType }),
        ...(input.objectId === undefined ? {} : { objectId: input.objectId }),
        result: input.result,
        ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
        requestId: input.requestId,
        ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
        ...(beforeState === null
          ? {}
          : { beforeState: beforeState as Record<string, JSONValue | undefined> }),
        ...(afterState === null
          ? {}
          : { afterState: afterState as Record<string, JSONValue | undefined> }),
        ...(previous === undefined ? {} : { prevHash: previousHash }),
        eventHash: hash,
        chainPosition,
        createdAt,
      });

      return { id, eventHash: hash };
    };
    if (existingTransaction !== undefined) return operation(existingTransaction);
    return (await this.sql.begin(operation)) as { id: string; eventHash: string };
  }

  public async verifyChain(
    organizationId?: string,
  ): Promise<
    { valid: true; eventCount: number } | { valid: false; eventCount: number; brokenAt: number }
  > {
    return (await this.sql.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtextextended(${auditScope(organizationId)}, 0))`;
      const rows = await transaction<StoredAuditEvent[]>`
        select *
        from audit_events
        where organization_id is not distinct from ${organizationId ?? null}
        order by chain_position
      `;

      let previousHash = GENESIS_HASH;
      for (const [index, row] of rows.entries()) {
        const expectedPrevious = index === 0 ? null : previousHash;
        const expectedPosition = index + 1;
        const expectedHash = eventHash(previousHash, payloadFromStored(row));
        if (
          row.prev_hash !== expectedPrevious ||
          Number(row.chain_position) !== expectedPosition ||
          row.event_hash !== expectedHash
        ) {
          return { valid: false as const, eventCount: rows.length, brokenAt: expectedPosition };
        }
        previousHash = row.event_hash;
      }
      return { valid: true as const, eventCount: rows.length };
    })) as
      { valid: true; eventCount: number } | { valid: false; eventCount: number; brokenAt: number };
  }
}
