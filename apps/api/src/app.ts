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
import { OkrService } from "./okr/okr-service.js";
import { PartnerService } from "./partners/partner-service.js";
import { InteractionService } from "./partners/interaction-service.js";
import { PartnerLinkService } from "./partners/partner-link-service.js";
import { SensitiveFieldCipher } from "./security/sensitive-field-cipher.js";
import { BlindIndex } from "./security/blind-index.js";
import { ProcessService } from "./process/process-service.js";
import { FileService, type FileDownloadSigner } from "./files/file-service.js";
import { UploadService, type MultipartObjectStore } from "./files/upload-service.js";
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
import { registerOkrRoutes } from "./routes/okr-routes.js";
import { registerNotificationRoutes } from "./routes/notification-routes.js";
import { registerChatRoutes } from "./routes/chat-routes.js";
import { registerChatComplianceRoutes } from "./routes/chat-compliance-routes.js";
import { registerPartnerRoutes } from "./routes/partner-routes.js";
import { registerPhoneRoutes } from "./routes/phone-routes.js";
import { registerFileRoutes } from "./routes/file-routes.js";
import { registerSpaceRoutes } from "./routes/space-routes.js";
import { registerWorkRoutes } from "./routes/work-routes.js";
import { SpaceService } from "./spaces/space-service.js";
import { WorkService } from "./work/work-service.js";
import { NotificationService } from "./notifications/notification-service.js";
import { NotificationPolicyService } from "./notifications/notification-policy-service.js";
import { ChatService } from "./chat/chat-service.js";
import { ComplianceService } from "./chat/compliance-service.js";

export interface BuildAppOptions {
  sql: DatabaseClient;
  tokenService: AccessTokenService;
  serviceVersion: string;
  phoneSender: VerificationCodeSender;
  loginRateLimiter: LoginRateLimiter;
  phoneRateLimiter: PhoneRateLimiter;
  phoneCodePepper: string;
  trustedProxyCidrs: readonly string[];
  corsOrigins: readonly string[];
  fileDataStore: MultipartObjectStore & FileDownloadSigner;
  partnerSecurity?: {
    activeKeyVersion: number;
    fieldKeys: ReadonlyMap<number, Uint8Array>;
    blindIndexKey: Uint8Array;
  };
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
  app.addHook("onRequest", async (request, reply) => {
    initializeRequestContext(request, { clientIp: "127.0.0.1", proxyChain: [] });
    const forwarded = request.headers["x-forwarded-for"];
    const resolved = resolveClientIp({
      peer: request.socket.remoteAddress ?? "127.0.0.1",
      ...(typeof forwarded === "string" ? { forwardedFor: forwarded } : {}),
      trustedProxies: options.trustedProxyCidrs,
    });
    initializeRequestContext(request, resolved);
    reply.header("x-request-id", request.id);
  });
  await app.register(cookie);
  await app.register(cors, { origin: [...options.corsOrigins], credentials: true });

  const audit = new AuditService(options.sql);
  const phones = new PhoneVerificationService({
    sql: options.sql,
    sender: options.phoneSender,
    rateLimiter: options.phoneRateLimiter,
    codePepper: options.phoneCodePepper,
  });
  const auth: AuthService = new ConcreteAuthService({
    sql: options.sql,
    tokenService: options.tokenService,
    rateLimiter: options.loginRateLimiter,
    phones,
  });
  const organizations = new OrganizationService(options.sql);
  const spaces = new SpaceService(options.sql);
  const files = new FileService(options.sql, options.fileDataStore);
  const uploads = new UploadService({ sql: options.sql, objectStore: options.fileDataStore });
  const mutations = new MutationCoordinator(options.sql, audit, options.phoneCodePepper);
  const work = new WorkService();
  const processes = new ProcessService();
  const okr = new OkrService();
  const authenticate = authenticateWith(auth);

  installErrorHandler(app);

  await registerCapabilityRoutes(app, { serviceVersion: options.serviceVersion });
  await registerAuthRoutes(app, { sql: options.sql, auth, mutations, authenticate });
  await registerPhoneRoutes(app, { phones, mutations });
  await registerDeviceRoutes(app, { sql: options.sql, mutations, authenticate });
  await registerOrganizationRoutes(app, {
    sql: options.sql,
    organizations,
    mutations,
    authenticate,
  });
  await registerAuditRoutes(app, { sql: options.sql, authenticate });
  await registerSpaceRoutes(app, { spaces, mutations, authenticate });
  await registerFileRoutes(app, { files, uploads, mutations, authenticate });
  await registerWorkRoutes(app, {
    sql: options.sql,
    work,
    processes,
    mutations,
    authenticate,
  });
  await registerOkrRoutes(app, { sql: options.sql, okr, mutations, authenticate });
  await registerNotificationRoutes(app, {
    sql: options.sql,
    notifications: new NotificationService(),
    policies: new NotificationPolicyService(),
    mutations,
    authenticate,
  });
  await registerChatRoutes(app, {
    sql: options.sql,
    chat: new ChatService(),
    mutations,
    authenticate,
  });
  await registerChatComplianceRoutes(app, {
    sql: options.sql,
    compliance: new ComplianceService(),
    mutations,
    authenticate,
  });
  if (options.partnerSecurity !== undefined) {
    const partners = new PartnerService({
      cipher: new SensitiveFieldCipher({
        activeVersion: options.partnerSecurity.activeKeyVersion,
        keys: options.partnerSecurity.fieldKeys,
      }),
      blindIndex: new BlindIndex(options.partnerSecurity.blindIndexKey),
    });
    await registerPartnerRoutes(app, {
      sql: options.sql,
      partners,
      interactions: new InteractionService(partners),
      links: new PartnerLinkService(partners),
      mutations,
      authenticate,
    });
  }

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
