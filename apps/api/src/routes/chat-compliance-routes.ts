import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import {
  ChatComplianceReview,
  ChatComplianceReviewRequest,
  ChatComplianceReviewResponse,
} from "@tashan/contracts";
import type { ComplianceService } from "../chat/compliance-service.js";
import type { DatabaseClient } from "../db/client.js";
import type { MutationCoordinator } from "../http/idempotency.js";
import { requestContext } from "../http/request-context.js";

const OrganizationPath = z.object({ organizationId: z.uuid() }).strict();
const ReviewPath = OrganizationPath.extend({ reviewId: z.uuid() }).strict();
function identity(request: FastifyRequest) {
  const value = requestContext(request).identity;
  if (!value) throw new Error("authenticated identity is missing");
  return value;
}
export async function registerChatComplianceRoutes(
  app: FastifyInstance,
  dependencies: {
    sql: DatabaseClient;
    compliance: ComplianceService;
    mutations: MutationCoordinator;
    authenticate: preHandlerHookHandler;
  },
) {
  app.post(
    "/v1/organizations/:organizationId/chat-compliance-reviews",
    { config: { capabilityId: "chat.compliance.create" }, preHandler: dependencies.authenticate },
    async (request, reply) => {
      const path = OrganizationPath.parse(request.params),
        body = ChatComplianceReviewRequest.parse(request.body),
        actor = identity(request);
      requestContext(request).organizationId = path.organizationId;
      const result = await dependencies.mutations.executeIdempotent({
        request,
        capabilityId: "chat.compliance.create",
        actorPrincipalId: actor.principalId,
        idempotencyInput: { ...path, ...body },
        work: async (tx) => ({
          statusCode: 201,
          body: ChatComplianceReview.parse(
            await dependencies.compliance.createReview(
              tx,
              actor.accountId,
              path.organizationId,
              body,
            ),
          ),
        }),
      });
      return reply.code(201).send(result.body);
    },
  );
  app.get(
    "/v1/organizations/:organizationId/chat-compliance-reviews/:reviewId",
    { config: { capabilityId: "chat.compliance.read" }, preHandler: dependencies.authenticate },
    async (request) => {
      const path = ReviewPath.parse(request.params),
        actor = identity(request);
      requestContext(request).organizationId = path.organizationId;
      return dependencies.sql.begin(async (tx) =>
        ChatComplianceReviewResponse.parse(
          await dependencies.compliance.readReview(
            tx,
            actor.accountId,
            path.organizationId,
            path.reviewId,
          ),
        ),
      );
    },
  );
}
