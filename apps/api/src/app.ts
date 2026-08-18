import { randomUUID } from "node:crypto";

import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import type { CapabilityId } from "@tashan/capabilities";

import { AuditService } from "./audit/audit-service.js";
import type { AuthService, LoginRateLimiter } from "./auth/auth-service.js";
import { AuthService as ConcreteAuthService } from "./auth/auth-service.js";
import type { AccessTokenService } from "./auth/access-token.js";
import type { DatabaseClient } from "./db/client.js";
import { authenticateWith } from "./http/authenticate.js";
import { installErrorHandler } from "./http/error-handler.js";
import { MutationCoordinator } from "./http/idempotency.js";
import { auditInputForRequest } from "./http/request-audit.js";
import { initializeRequestContext, requestContext } from "./http/request-context.js";
import { resolveClientIp, validateTrustedProxyCidrs } from "./http/trusted-proxy.js";
import { OrganizationService } from "./organizations/organization-service.js";
import {
  PhoneVerificationService,
  type PhoneRateLimiter,
} from "./phone/phone-verification-service.js";
import type { VerificationCodeSender } from "./phone/verification-code-sender.js";
import { registerAuditRoutes } from "./routes/audit-routes.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerCapabilityRoutes } from "./routes/capability-routes.js";
import { registerDeviceRoutes } from "./routes/device-routes.js";
import { registerOrganizationRoutes } from "./routes/organization-routes.js";
import { registerPhoneRoutes } from "./routes/phone-routes.js";

export interface BuildAppOptions {
  sql: DatabaseClient;
  tokenService: AccessTokenService;
  phoneSender: VerificationCodeSender;
  loginRateLimiter: LoginRateLimiter;
  phoneRateLimiter: PhoneRateLimiter;
  phoneCodePepper: string;
  trustedProxyCidrs: readonly string[];
  corsOrigins: readonly string[];
}

function capabilityForRequest(request: FastifyRequest): CapabilityId | undefined {
  return request.routeOptions.config.capabilityId;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  validateTrustedProxyCidrs(options.trustedProxyCidrs);
  if (options.corsOrigins.length === 0 || options.corsOrigins.includes("*")) {
    throw new Error("CORS origins must be explicit and non-empty");
  }

  const app = Fastify({
    logger: false,
    genReqId: () => randomUUID(),
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(cors, { origin: [...options.corsOrigins], credentials: true });

  const audit = new AuditService(options.sql);
  const auth: AuthService = new ConcreteAuthService({
    sql: options.sql,
    tokenService: options.tokenService,
    rateLimiter: options.loginRateLimiter,
  });
  const phones = new PhoneVerificationService({
    sql: options.sql,
    sender: options.phoneSender,
    rateLimiter: options.phoneRateLimiter,
    codePepper: options.phoneCodePepper,
  });
  const organizations = new OrganizationService(options.sql);
  const mutations = new MutationCoordinator(options.sql, audit);
  const authenticate = authenticateWith(auth);

  app.addHook("onRequest", async (request, reply) => {
    const forwarded = request.headers["x-forwarded-for"];
    const resolved = resolveClientIp({
      peer: request.socket.remoteAddress ?? "127.0.0.1",
      ...(typeof forwarded === "string" ? { forwardedFor: forwarded } : {}),
      trustedProxies: options.trustedProxyCidrs,
    });
    initializeRequestContext(request, resolved);
    reply.header("x-request-id", request.id);
  });

  installErrorHandler(app);

  await registerCapabilityRoutes(app);
  await registerAuthRoutes(app, { sql: options.sql, auth, mutations, authenticate });
  await registerPhoneRoutes(app, { phones, mutations, authenticate });
  await registerDeviceRoutes(app, { sql: options.sql, mutations, authenticate });
  await registerOrganizationRoutes(app, {
    sql: options.sql,
    organizations,
    mutations,
    authenticate,
  });
  await registerAuditRoutes(app, { sql: options.sql, authenticate });

  app.addHook("onSend", async (request, reply, payload) => {
    const capabilityId = capabilityForRequest(request);
    const context = requestContext(request);
    if (capabilityId === undefined || context.auditWritten) return payload;
    const result =
      reply.statusCode >= 500 ? "failure" : reply.statusCode >= 400 ? "rejected" : "success";
    context.auditWritten = true;
    await audit.append(
      auditInputForRequest(request, capabilityId, result, context.errorCode, {
        statusCode: reply.statusCode,
      }),
    );
    return payload;
  });

  await app.ready();
  return app;
}
