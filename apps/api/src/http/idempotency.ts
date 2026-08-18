import type { FastifyRequest } from "fastify";

import type { CapabilityId } from "@tashan/capabilities";

import { AuditService } from "../audit/audit-service.js";
import type { DatabaseClient } from "../db/client.js";
import type { TransactionClient } from "../db/transaction.js";
import {
  IdempotencyConflictError,
  IdempotencyRepository,
} from "../repositories/idempotency-repository.js";
import { OutboxRepository } from "../repositories/outbox-repository.js";
import { AuthError } from "../auth/auth-errors.js";
import { auditInputForRequest } from "./request-audit.js";
import { requestContext, singleHeader } from "./request-context.js";

export interface MutationResult<T> {
  statusCode: number;
  body: T;
}

interface ExecuteMutationInput<T> {
  request: FastifyRequest;
  capabilityId: CapabilityId;
  actorPrincipalId?: string;
  actorKey?: string;
  idempotencyInput: unknown;
  work(transaction: TransactionClient): Promise<MutationResult<T>>;
}

export class MutationCoordinator {
  private readonly idempotency = new IdempotencyRepository();
  private readonly outbox = new OutboxRepository();

  public constructor(
    private readonly sql: DatabaseClient,
    private readonly audit: AuditService,
  ) {}

  public async executeIdempotent<T>(input: ExecuteMutationInput<T>): Promise<MutationResult<T>> {
    const idempotencyKey = requireIdempotencyKey(input.request);
    const actor =
      input.actorPrincipalId !== undefined
        ? { actorPrincipalId: input.actorPrincipalId }
        : input.actorKey !== undefined
          ? { actorKey: input.actorKey }
          : (() => {
              throw new Error("idempotent mutation requires an actor identity");
            })();
    return (await this.sql.begin(async (transaction) => {
      const claim = await this.idempotency.claim(transaction, {
        ...actor,
        capabilityId: input.capabilityId,
        idempotencyKey,
        input: input.idempotencyInput,
      });
      if (claim.kind === "in_progress") throw new IdempotencyConflictError();
      if (claim.kind === "cached") {
        await this.recordSuccess(transaction, input.request, input.capabilityId, true);
        return { statusCode: claim.responseStatus, body: claim.responseBody as T };
      }

      const result = await input.work(transaction);
      await this.recordSuccess(transaction, input.request, input.capabilityId, false);
      await this.idempotency.complete(transaction, {
        ...actor,
        capabilityId: input.capabilityId,
        idempotencyKey,
        responseStatus: result.statusCode,
        responseBody: result.body,
      });
      return result;
    })) as MutationResult<T>;
  }

  public async executeSessionMutation<T>(
    request: FastifyRequest,
    capabilityId: CapabilityId,
    work: (transaction: TransactionClient) => Promise<MutationResult<T>>,
  ): Promise<MutationResult<T>> {
    return (await this.sql.begin(async (transaction) => {
      const result = await work(transaction);
      await this.recordSuccess(transaction, request, capabilityId, false);
      return result;
    })) as MutationResult<T>;
  }

  private async recordSuccess(
    transaction: TransactionClient,
    request: FastifyRequest,
    capabilityId: CapabilityId,
    replayed: boolean,
  ): Promise<void> {
    await this.audit.append(
      auditInputForRequest(request, capabilityId, "success", undefined, { replayed }),
      transaction,
    );
    await this.outbox.append(transaction, {
      eventType: "capability.succeeded",
      payload: { capabilityId, requestId: request.id, replayed },
    });
    requestContext(request).auditWritten = true;
  }
}

export function requireIdempotencyKey(request: FastifyRequest): string {
  const key = singleHeader(request, "idempotency-key")?.trim();
  if (key === undefined || key.length === 0 || key.length > 200 || /[\r\n\0]/.test(key)) {
    throw new AuthError("VALIDATION_FAILED", "a valid Idempotency-Key header is required");
  }
  return key;
}
