import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { CapabilityId } from "@tashan/capabilities";
import {
  KeyResultProgressResponse,
  ObjectiveCreateRequest,
  ObjectiveListQuery,
  ObjectiveListResponse,
  ObjectiveMutationResponse,
  ObjectiveStateResponse,
  OkrChangeApprovalRequest,
  OkrChangeRequest,
  OkrChangeRequestResponse,
  OkrProgressUpdateRequest,
} from "@tashan/contracts";
import type { DatabaseClient } from "../db/client.js";
import type { MutationCoordinator } from "../http/idempotency.js";
import { requestContext } from "../http/request-context.js";
import type { OkrService } from "../okr/okr-service.js";

const Org = z.object({ organizationId: z.uuid() }).strict();
const Objective = Org.extend({ objectiveId: z.uuid() }).strict();
const Kr = Org.extend({ keyResultId: z.uuid() }).strict();
const Change = Org.extend({ changeRequestId: z.uuid() }).strict();
function identity(request: FastifyRequest) {
  const value = requestContext(request).identity;
  if (value === undefined) throw new Error("authenticated identity is missing");
  return value;
}

export async function registerOkrRoutes(
  app: FastifyInstance,
  deps: {
    sql: DatabaseClient;
    okr: OkrService;
    mutations: MutationCoordinator;
    authenticate: preHandlerHookHandler;
  },
) {
  app.get(
    "/v1/organizations/:organizationId/objectives",
    { config: { capabilityId: "okr.objective.list" }, preHandler: deps.authenticate },
    async (request) => {
      const path = Org.parse(request.params);
      requestContext(request).organizationId = path.organizationId;
      const items = await deps.sql.begin((tx) =>
        deps.okr.list(
          tx,
          identity(request).accountId,
          path.organizationId,
          ObjectiveListQuery.parse(request.query),
        ),
      );
      return ObjectiveListResponse.parse({ items, nextCursor: null });
    },
  );
  app.get(
    "/v1/organizations/:organizationId/objectives/:objectiveId",
    { config: { capabilityId: "okr.objective.read" }, preHandler: deps.authenticate },
    async (request) => {
      const path = Objective.parse(request.params);
      requestContext(request).organizationId = path.organizationId;
      return deps.sql.begin(async (tx) =>
        ObjectiveStateResponse.parse(
          await deps.okr.read(
            tx,
            identity(request).accountId,
            path.organizationId,
            path.objectiveId,
          ),
        ),
      );
    },
  );
  const mutate = async (
    request: FastifyRequest,
    capabilityId: CapabilityId,
    input: unknown,
    work: Parameters<MutationCoordinator["executeIdempotent"]>[0]["work"],
  ) => {
    const actor = identity(request);
    return (
      await deps.mutations.executeIdempotent({
        request,
        capabilityId,
        actorPrincipalId: actor.principalId,
        idempotencyInput: input,
        work,
      })
    ).body;
  };
  app.post(
    "/v1/organizations/:organizationId/objectives",
    { config: { capabilityId: "okr.objective.create" }, preHandler: deps.authenticate },
    async (request, reply) => {
      const path = Org.parse(request.params);
      const body = ObjectiveCreateRequest.parse(request.body);
      requestContext(request).organizationId = path.organizationId;
      const result = await mutate(
        request,
        "okr.objective.create",
        { ...path, ...body },
        async (tx) => ({
          statusCode: 201,
          body: ObjectiveStateResponse.parse(
            await deps.okr.createObjective(
              tx,
              identity(request).accountId,
              path.organizationId,
              body,
            ),
          ),
        }),
      );
      return reply.code(201).send(result);
    },
  );
  app.post(
    "/v1/organizations/:organizationId/key-results/:keyResultId/progress",
    { config: { capabilityId: "okr.progress.update" }, preHandler: deps.authenticate },
    async (request) => {
      const path = Kr.parse(request.params);
      const body = OkrProgressUpdateRequest.parse(request.body);
      requestContext(request).organizationId = path.organizationId;
      return mutate(request, "okr.progress.update", { ...path, ...body }, async (tx) => ({
        statusCode: 200,
        body: KeyResultProgressResponse.parse(
          await deps.okr.updateProgress(tx, identity(request).accountId, path.keyResultId, body),
        ),
      }));
    },
  );
  app.post(
    "/v1/organizations/:organizationId/objectives/:objectiveId/change-requests",
    { config: { capabilityId: "okr.change.request" }, preHandler: deps.authenticate },
    async (request, reply) => {
      const path = Objective.parse(request.params);
      const body = OkrChangeRequest.parse(request.body);
      requestContext(request).organizationId = path.organizationId;
      const result = await mutate(
        request,
        "okr.change.request",
        { ...path, ...body },
        async (tx) => ({
          statusCode: 201,
          body: OkrChangeRequestResponse.parse(
            await deps.okr.requestChange(tx, identity(request).accountId, path.objectiveId, body),
          ),
        }),
      );
      return reply.code(201).send(result);
    },
  );
  app.post(
    "/v1/organizations/:organizationId/okr-change-requests/:changeRequestId/approve",
    { config: { capabilityId: "okr.change.approve" }, preHandler: deps.authenticate },
    async (request) => {
      const path = Change.parse(request.params);
      const body = OkrChangeApprovalRequest.parse(request.body);
      requestContext(request).organizationId = path.organizationId;
      return mutate(request, "okr.change.approve", { ...path, ...body }, async (tx) => ({
        statusCode: 200,
        body: ObjectiveMutationResponse.parse(
          await deps.okr.approveChange(tx, identity(request).accountId, path.changeRequestId, body),
        ),
      }));
    },
  );
  app.post(
    "/v1/organizations/:organizationId/objectives/:objectiveId/admin-edit",
    { config: { capabilityId: "okr.objective.edit.admin" }, preHandler: deps.authenticate },
    async (request) => {
      const path = Objective.parse(request.params);
      const body = OkrChangeRequest.parse(request.body);
      requestContext(request).organizationId = path.organizationId;
      return mutate(request, "okr.objective.edit.admin", { ...path, ...body }, async (tx) => ({
        statusCode: 200,
        body: ObjectiveMutationResponse.parse(
          await deps.okr.editObjectiveDirect(
            tx,
            identity(request).accountId,
            path.objectiveId,
            body,
          ),
        ),
      }));
    },
  );
}
