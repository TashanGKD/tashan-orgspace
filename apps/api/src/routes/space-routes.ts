import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import {
  AccountId,
  OrganizationIdPath,
  PersonalQuotaSetRequest,
  PersonalQuotaSetResponse,
  SpaceIdPath,
  SpaceListResponse,
  SpaceReadResponse,
  SpaceUsageResponse,
} from "@tashan/contracts";

import type { MutationCoordinator } from "../http/idempotency.js";
import { requestContext } from "../http/request-context.js";
import type { SpaceService } from "../spaces/space-service.js";

const QuotaPath = OrganizationIdPath.extend({ accountId: AccountId }).strict();

function identity(request: FastifyRequest) {
  const value = requestContext(request).identity;
  if (value === undefined) throw new Error("authenticated identity is missing");
  return value;
}

export async function registerSpaceRoutes(
  app: FastifyInstance,
  dependencies: {
    spaces: SpaceService;
    mutations: MutationCoordinator;
    authenticate: preHandlerHookHandler;
  },
): Promise<void> {
  app.get(
    "/v1/spaces",
    { config: { capabilityId: "space.list" }, preHandler: dependencies.authenticate },
    async (request) =>
      SpaceListResponse.parse({
        items: await dependencies.spaces.list(identity(request).accountId),
      }),
  );
  app.get(
    "/v1/spaces/:spaceId",
    { config: { capabilityId: "space.read" }, preHandler: dependencies.authenticate },
    async (request) => {
      const { spaceId } = SpaceIdPath.parse(request.params);
      return SpaceReadResponse.parse({
        space: await dependencies.spaces.read(identity(request).accountId, spaceId),
      });
    },
  );
  app.get(
    "/v1/spaces/:spaceId/usage",
    { config: { capabilityId: "space.usage.read" }, preHandler: dependencies.authenticate },
    async (request) => {
      const { spaceId } = SpaceIdPath.parse(request.params);
      return SpaceUsageResponse.parse(
        await dependencies.spaces.usage(identity(request).accountId, spaceId),
      );
    },
  );
  app.post(
    "/v1/organizations/:organizationId/members/:accountId/personal-space-quota",
    { config: { capabilityId: "space.quota.set" }, preHandler: dependencies.authenticate },
    async (request, reply) => {
      const path = QuotaPath.parse(request.params);
      const body = PersonalQuotaSetRequest.parse(request.body);
      const actor = identity(request);
      const result = await dependencies.mutations.executeIdempotent({
        request,
        capabilityId: "space.quota.set",
        actorPrincipalId: actor.principalId,
        idempotencyInput: { ...path, ...body },
        work: async () => ({
          statusCode: 200,
          body: PersonalQuotaSetResponse.parse(
            await dependencies.spaces.setPersonalQuota(
              actor.accountId,
              path.organizationId,
              path.accountId,
              body.quotaBytes,
            ),
          ),
        }),
      });
      return reply.code(result.statusCode).send(result.body);
    },
  );
}
