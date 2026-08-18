import type { FastifyRequest } from "fastify";

import type { CapabilityId } from "@tashan/capabilities";

import type { AuthenticatedClientChannel } from "../audit/audit-context.js";

export interface AuthenticatedIdentity {
  accountId: string;
  principalId: string;
  sessionId: string;
  deviceId: string;
  actorSource: AuthenticatedClientChannel;
  deviceMetadata: {
    name: string;
    os: string;
    architecture: string;
    clientVersion: string;
  };
}

export interface RequestAuditContext {
  capabilityId?: CapabilityId;
  clientIp: string;
  proxyChain: string[];
  identity?: AuthenticatedIdentity;
  accountId?: string;
  principalId?: string;
  organizationId?: string;
  auditWritten: boolean;
  errorCode?: string;
}

declare module "fastify" {
  interface FastifyContextConfig {
    capabilityId?: CapabilityId;
  }
}

const contexts = new WeakMap<FastifyRequest, RequestAuditContext>();

export function initializeRequestContext(
  request: FastifyRequest,
  input: Pick<RequestAuditContext, "clientIp" | "proxyChain">,
): RequestAuditContext {
  const context: RequestAuditContext = { ...input, auditWritten: false };
  contexts.set(request, context);
  return context;
}

export function requestContext(request: FastifyRequest): RequestAuditContext {
  const context = contexts.get(request);
  if (context === undefined) throw new Error("request context was not initialized");
  return context;
}

export function singleHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}
