import type { FastifyInstance } from "fastify";

import { VerificationSendRequest, VerificationSendResponse } from "@tashan/contracts";

import type { MutationCoordinator } from "../http/idempotency.js";
import { requestContext } from "../http/request-context.js";
import type { PhoneVerificationService } from "../phone/phone-verification-service.js";

export async function registerPhoneRoutes(
  app: FastifyInstance,
  dependencies: {
    phones: PhoneVerificationService;
    mutations: MutationCoordinator;
  },
): Promise<void> {
  app.post(
    "/v1/auth/verification/send",
    { config: { capabilityId: "auth.verification.send" } },
    async (request, reply) => {
      const body = VerificationSendRequest.parse(request.body);
      const context = requestContext(request);
      const result = await dependencies.mutations.executeIdempotent({
        request,
        capabilityId: "auth.verification.send",
        actorKey: `verification:${body.purpose}:${body.phone}:${context.clientIp}`,
        idempotencyInput: body,
        auditAfterState: { phone: body.phone, purpose: body.purpose },
        work: async (transaction) => {
          const challenge = await dependencies.phones.start(
            {
              phone: body.phone,
              purpose: body.purpose,
              serverIp: context.clientIp,
              requestId: request.id,
            },
            transaction,
          );
          return {
            statusCode: 202,
            body: VerificationSendResponse.parse({
              challengeId: challenge.challengeId,
              expiresAt: challenge.expiresAt.toISOString(),
            }),
          };
        },
      });
      return reply.code(result.statusCode).send(result.body);
    },
  );
}
