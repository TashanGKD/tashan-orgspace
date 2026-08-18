import type { FastifyRequest } from "fastify";

import type { CapabilityId } from "@tashan/capabilities";

import { deriveAuditActorContext } from "../audit/audit-context.js";
import type { AppendAuditEventInput } from "../audit/audit-service.js";
import { requestContext, singleHeader } from "./request-context.js";

export function auditInputForRequest(
  request: FastifyRequest,
  capabilityId: CapabilityId,
  result: "success" | "rejected" | "failure",
  errorCode?: string,
  afterState?: Record<string, unknown>,
): AppendAuditEventInput {
  const context = requestContext(request);
  const reportedActorSource = singleHeader(request, "x-torg-invocation-source");
  const actor =
    context.identity === undefined
      ? { actorSource: "web" as const, reportedActorSource: reportedActorSource ?? null }
      : deriveAuditActorContext(context.identity.actorSource, reportedActorSource);
  const userAgent = singleHeader(request, "user-agent");
  const skillVersion = singleHeader(request, "x-skill-version");
  const idempotencyKey = singleHeader(request, "idempotency-key");
  const deviceMetadata =
    context.identity === undefined
      ? undefined
      : {
          ...context.identity.deviceMetadata,
          ...(userAgent === undefined ? {} : { userAgent }),
          ...(skillVersion === undefined ? {} : { skillVersion }),
        };

  return {
    ...(context.organizationId === undefined ? {} : { organizationId: context.organizationId }),
    ...(context.identity === undefined
      ? {
          ...(context.accountId === undefined ? {} : { accountId: context.accountId }),
          ...(context.principalId === undefined ? {} : { principalId: context.principalId }),
        }
      : {
          accountId: context.identity.accountId,
          principalId: context.identity.principalId,
          sessionId: context.identity.sessionId,
          deviceId: context.identity.deviceId,
        }),
    serverIp: context.clientIp,
    proxyChain: context.proxyChain,
    ...(deviceMetadata === undefined ? {} : { deviceMetadata }),
    actorSource: actor.actorSource,
    ...(actor.reportedActorSource === null
      ? {}
      : { reportedActorSource: actor.reportedActorSource }),
    capabilityId,
    action: capabilityId,
    result,
    ...(errorCode === undefined ? {} : { errorCode }),
    requestId: request.id,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(afterState === undefined ? {} : { afterState }),
  };
}
