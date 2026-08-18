import { z } from "zod";

import {
  AccountId,
  ActorSource,
  AuditEventId,
  DeviceId,
  IsoDateTime,
  OrganizationId,
  PrincipalId,
  RequestId,
  SessionId,
} from "./common.js";
import { ErrorCode } from "./error.js";

export const AuditResult = z.enum(["success", "rejected", "failure"]);
export type AuditResult = z.infer<typeof AuditResult>;

export const AuditDeviceContext = z
  .object({
    name: z.string().min(1),
    os: z.string().min(1),
    architecture: z.string().min(1),
    clientVersion: z.string().min(1),
    userAgent: z.string().optional(),
    skillVersion: z.string().min(1).optional(),
  })
  .strict();
export type AuditDeviceContext = z.infer<typeof AuditDeviceContext>;

export const AuditEvent = z
  .object({
    id: AuditEventId,
    organizationId: OrganizationId.nullable(),
    accountId: AccountId.nullable(),
    principalId: PrincipalId.nullable(),
    sessionId: SessionId.nullable(),
    deviceId: DeviceId.nullable(),
    serverIp: z.string().min(1),
    proxyChain: z.array(z.string().min(1)),
    device: AuditDeviceContext.nullable(),
    actorSource: ActorSource,
    reportedActorSource: z.string().min(1).nullable(),
    capabilityId: z.string().min(1),
    action: z.string().min(1),
    objectType: z.string().min(1).nullable(),
    objectId: z.string().min(1).nullable(),
    result: AuditResult,
    errorCode: ErrorCode.nullable(),
    requestId: RequestId,
    idempotencyKey: z.string().min(1).nullable(),
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()).nullable(),
    occurredAt: IsoDateTime,
  })
  .strict();
export type AuditEvent = z.infer<typeof AuditEvent>;

export const AuditListQuery = z
  .object({
    organizationId: OrganizationId.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type AuditListQuery = z.infer<typeof AuditListQuery>;

export const AuditListResponse = z
  .object({
    items: z.array(AuditEvent),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();
export type AuditListResponse = z.infer<typeof AuditListResponse>;
