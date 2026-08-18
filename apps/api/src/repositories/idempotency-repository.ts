import { createHash } from "node:crypto";

import type { JSONValue } from "postgres";

import type { TransactionClient } from "../db/transaction.js";

export class IdempotencyConflictError extends Error {
  public readonly code = "IDEMPOTENCY_CONFLICT";

  public constructor() {
    super("idempotency key was already used with different input");
    this.name = "IdempotencyConflictError";
  }
}

function canonicalize(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("idempotency input contains a non-finite number");
    return value;
  }
  if (typeof value !== "object") {
    throw new Error(`idempotency input contains unsupported type: ${typeof value}`);
  }
  if (ancestors.has(value)) throw new Error("idempotency input contains a cycle");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item, ancestors));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("idempotency input must contain only plain objects");
    }

    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key], ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}

export function hashIdempotencyInput(input: unknown): string {
  const canonicalJson = JSON.stringify(canonicalize(input, new WeakSet()));
  return createHash("sha256").update(canonicalJson, "utf8").digest("base64url");
}

export interface IdempotencyClaimInput {
  actorPrincipalId: string;
  capabilityId: string;
  idempotencyKey: string;
  input: unknown;
  expiresAt?: Date;
}

export type IdempotencyClaim =
  | { kind: "claimed" }
  | { kind: "in_progress" }
  | { kind: "cached"; responseStatus: number; responseBody: unknown };

export class IdempotencyRepository {
  public async claim(
    transaction: TransactionClient,
    input: IdempotencyClaimInput,
  ): Promise<IdempotencyClaim> {
    const requestHash = hashIdempotencyInput(input.input);
    const inserted = await transaction<{ id: string }[]>`
      insert into idempotency_records (
        actor_principal_id, capability_id, idempotency_key, request_hash, expires_at
      ) values (
        ${input.actorPrincipalId}, ${input.capabilityId}, ${input.idempotencyKey},
        ${requestHash}, ${input.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000)}
      )
      on conflict (actor_principal_id, capability_id, idempotency_key) do nothing
      returning id
    `;
    if (inserted.length === 1) return { kind: "claimed" };

    const [existing] = await transaction<
      { request_hash: string; response_status: number | null; response_body: unknown }[]
    >`
      select request_hash, response_status, response_body
      from idempotency_records
      where actor_principal_id = ${input.actorPrincipalId}
        and capability_id = ${input.capabilityId}
        and idempotency_key = ${input.idempotencyKey}
    `;
    if (existing === undefined) throw new Error("idempotency record disappeared after conflict");
    if (existing.request_hash !== requestHash) throw new IdempotencyConflictError();
    if (existing.response_status === null) return { kind: "in_progress" };

    return {
      kind: "cached",
      responseStatus: existing.response_status,
      responseBody: existing.response_body,
    };
  }

  public async complete(
    transaction: TransactionClient,
    input: {
      actorPrincipalId: string;
      capabilityId: string;
      idempotencyKey: string;
      responseStatus: number;
      responseBody: unknown;
    },
  ): Promise<void> {
    const responseBody = canonicalize(input.responseBody, new WeakSet()) as JSONValue;
    const rows = await transaction<{ id: string }[]>`
      update idempotency_records
      set response_status = ${input.responseStatus}, response_body = ${transaction.json(responseBody)}
      where actor_principal_id = ${input.actorPrincipalId}
        and capability_id = ${input.capabilityId}
        and idempotency_key = ${input.idempotencyKey}
        and response_status is null
      returning id
    `;
    if (rows.length !== 1) throw new Error("idempotency record could not be completed");
  }
}
