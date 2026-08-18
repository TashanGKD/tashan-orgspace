import type { FastifyInstance, preHandlerHookHandler } from "fastify";

import {
  PhoneVerificationConfirmRequest,
  PhoneVerificationConfirmResponse,
  PhoneVerificationStartRequest,
  PhoneVerificationStartResponse,
} from "@tashan/contracts";

import type { MutationCoordinator } from "../http/idempotency.js";
import { requestContext } from "../http/request-context.js";
import type { PhoneVerificationService } from "../phone/phone-verification-service.js";

export async function registerPhoneRoutes(
  app: FastifyInstance,
  dependencies: {
    phones: PhoneVerificationService;
    mutations: MutationCoordinator;
    authenticate: preHandlerHookHandler;
  },
): Promise<void> {
  app.post(
    "/v1/phone-verifications",
    { config: { capabilityId: "auth.phone.start" }, preHandler: dependencies.authenticate },
    async (request, reply) => {
      const body = PhoneVerificationStartRequest.parse(request.body);
      const context = requestContext(request);
      const identity = context.identity;
      if (identity === undefined) throw new Error("authenticated identity is missing");
      const result = await dependencies.mutations.executeIdempotent({
        request,
        capabilityId: "auth.phone.start",
        actorPrincipalId: identity.principalId,
        idempotencyInput: body,
        work: async (transaction) => {
          const challenge = await dependencies.phones.start(
            identity.accountId,
            body.phone,
            context.clientIp,
            transaction,
          );
          return {
            statusCode: 202,
            body: PhoneVerificationStartResponse.parse({
              challengeId: challenge.challengeId,
              expiresAt: challenge.expiresAt.toISOString(),
            }),
          };
        },
      });
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/v1/phone-verifications/confirm",
    { config: { capabilityId: "auth.phone.confirm" }, preHandler: dependencies.authenticate },
    async (request, reply) => {
      const body = PhoneVerificationConfirmRequest.parse(request.body);
      const identity = requestContext(request).identity;
      if (identity === undefined) throw new Error("authenticated identity is missing");
      const result = await dependencies.mutations.executeIdempotent({
        request,
        capabilityId: "auth.phone.confirm",
        actorPrincipalId: identity.principalId,
        idempotencyInput: body,
        work: async (transaction) => {
          const verified = await dependencies.phones.confirm(
            identity.accountId,
            body.challengeId,
            body.code,
            transaction,
          );
          return {
            statusCode: 200,
            body: PhoneVerificationConfirmResponse.parse({
              phone: verified.phone,
              verifiedAt: verified.verifiedAt.toISOString(),
            }),
          };
        },
      });
      return reply.code(result.statusCode).send(result.body);
    },
  );
}
