import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import type { CapabilityId } from "@tashan/capabilities";
import {
  ProcessDecisionRequest,
  ProcessDefinitionCreateRequest,
  ProcessDefinitionStateResponse,
  ProcessInstanceStateResponse,
  ProcessStartRequest,
  ProcessVersionCreateRequest,
  WorkItemCreateRequest,
  WorkItemListQuery,
  WorkItemListResponse,
  WorkItemStateResponse,
  WorkItemTransitionRequest,
} from "@tashan/contracts";

import type { MutationCoordinator } from "../http/idempotency.js";
import type { DatabaseClient } from "../db/client.js";
import { requestContext } from "../http/request-context.js";
import type { ProcessService } from "../process/process-service.js";
import type { WorkService } from "../work/work-service.js";

const OrgPath = z.object({ organizationId: z.uuid() }).strict();
const WorkPath = OrgPath.extend({ workItemId: z.uuid() }).strict();
const AssignmentPath = WorkPath.extend({ assignmentId: z.uuid() }).strict();
const DefinitionPath = OrgPath.extend({ definitionId: z.uuid() }).strict();
const VersionPath = OrgPath.extend({ versionId: z.uuid() }).strict();
const InstancePath = OrgPath.extend({ instanceId: z.uuid() }).strict();

function identity(request: FastifyRequest) {
  const value = requestContext(request).identity;
  if (value === undefined) throw new Error("authenticated identity is missing");
  return value;
}

export async function registerWorkRoutes(
  app: FastifyInstance,
  dependencies: {
    work: WorkService;
    processes: ProcessService;
    sql: DatabaseClient;
    mutations: MutationCoordinator;
    authenticate: preHandlerHookHandler;
  },
): Promise<void> {
  app.get(
    "/v1/organizations/:organizationId/work-items",
    { config: { capabilityId: "work.item.list" }, preHandler: dependencies.authenticate },
    async (request) => {
      const path = OrgPath.parse(request.params);
      requestContext(request).organizationId = path.organizationId;
      const items = await dependencies.sql.begin((tx) =>
        dependencies.work.list(
          tx,
          identity(request).accountId,
          path.organizationId,
          WorkItemListQuery.parse(request.query),
        ),
      );
      return WorkItemListResponse.parse({ items, nextCursor: null });
    },
  );
  app.get(
    "/v1/organizations/:organizationId/work-items/:workItemId",
    { config: { capabilityId: "work.item.read" }, preHandler: dependencies.authenticate },
    async (request) => {
      const path = WorkPath.parse(request.params);
      requestContext(request).organizationId = path.organizationId;
      return dependencies.sql.begin(async (tx) =>
        WorkItemStateResponse.parse(
          await dependencies.work.read(
            tx,
            identity(request).accountId,
            path.organizationId,
            path.workItemId,
          ),
        ),
      );
    },
  );

  const mutate = async <T>(
    request: FastifyRequest,
    capabilityId: CapabilityId,
    input: unknown,
    work: Parameters<MutationCoordinator["executeIdempotent"]>[0]["work"],
  ): Promise<T> => {
    const actor = identity(request);
    const result = await dependencies.mutations.executeIdempotent({
      request,
      capabilityId,
      actorPrincipalId: actor.principalId,
      idempotencyInput: input,
      work,
    });
    return result.body as T;
  };

  app.post(
    "/v1/organizations/:organizationId/work-items",
    { config: { capabilityId: "work.item.create" }, preHandler: dependencies.authenticate },
    async (request, reply) => {
      const path = OrgPath.parse(request.params);
      const body = WorkItemCreateRequest.parse(request.body);
      requestContext(request).organizationId = path.organizationId;
      const result = await mutate<unknown>(
        request,
        "work.item.create",
        { ...path, ...body },
        async (tx) => ({
          statusCode: 201,
          body: WorkItemStateResponse.parse(
            await dependencies.work.create(
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

  for (const [segment, type, capabilityId] of [
    ["tasks", "task", "task.create"],
    ["meetings", "meeting", "meeting.create"],
    ["approvals", "approval", "approval.create"],
  ] as const) {
    app.post(
      `/v1/organizations/:organizationId/${segment}`,
      { config: { capabilityId }, preHandler: dependencies.authenticate },
      async (request, reply) => {
        const path = OrgPath.parse(request.params);
        const raw = z.record(z.string(), z.unknown()).parse(request.body ?? {});
        const body = WorkItemCreateRequest.parse({ ...raw, type });
        requestContext(request).organizationId = path.organizationId;
        const result = await mutate(request, capabilityId, { ...path, ...body }, async (tx) => ({
          statusCode: 201,
          body: WorkItemStateResponse.parse(
            await dependencies.work.create(
              tx,
              identity(request).accountId,
              path.organizationId,
              body,
            ),
          ),
        }));
        return reply.code(201).send(result);
      },
    );
  }

  const workAction = (
    url: string,
    capabilityId: CapabilityId,
    action: string,
    assignment: boolean,
  ) => {
    app.post(
      url,
      { config: { capabilityId }, preHandler: dependencies.authenticate },
      async (request) => {
        const path = (assignment ? AssignmentPath : WorkPath).parse(request.params);
        requestContext(request).organizationId = path.organizationId;
        const body = z.record(z.string(), z.unknown()).parse(request.body ?? {});
        const transition = WorkItemTransitionRequest.parse({
          ...body,
          action,
          ...(assignment
            ? { assignmentId: (path as z.infer<typeof AssignmentPath>).assignmentId }
            : {}),
        });
        return mutate(request, capabilityId, { ...path, ...transition }, async (tx) => ({
          statusCode: 200,
          body: WorkItemStateResponse.parse(
            await dependencies.work.transition(
              tx,
              identity(request).accountId,
              path.workItemId,
              transition,
            ),
          ),
        }));
      },
    );
  };
  workAction(
    "/v1/organizations/:organizationId/work-items/:workItemId/assign",
    "work.item.assign",
    "assign",
    false,
  );
  workAction(
    "/v1/organizations/:organizationId/work-items/:workItemId/assignments/:assignmentId/dispute",
    "work.assignment.dispute",
    "dispute",
    true,
  );
  workAction(
    "/v1/organizations/:organizationId/work-items/:workItemId/assignments/:assignmentId/transfer-request",
    "work.assignment.transfer.request",
    "request_transfer",
    true,
  );
  workAction(
    "/v1/organizations/:organizationId/work-items/:workItemId/assignments/:assignmentId/transfer-approve",
    "work.assignment.transfer.approve",
    "approve_transfer",
    true,
  );
  workAction(
    "/v1/organizations/:organizationId/work-items/:workItemId/complete",
    "work.item.complete",
    "complete",
    false,
  );
  workAction(
    "/v1/organizations/:organizationId/work-items/:workItemId/reopen",
    "work.item.reopen",
    "reopen",
    false,
  );
  workAction(
    "/v1/organizations/:organizationId/work-items/:workItemId/cancel",
    "work.item.cancel",
    "cancel",
    false,
  );

  app.post(
    "/v1/organizations/:organizationId/process-definitions",
    {
      config: { capabilityId: "process.definition.create" },
      preHandler: dependencies.authenticate,
    },
    async (request, reply) => {
      const path = OrgPath.parse(request.params);
      const body = ProcessDefinitionCreateRequest.parse(request.body);
      requestContext(request).organizationId = path.organizationId;
      const result = await mutate(
        request,
        "process.definition.create",
        { ...path, ...body },
        async (tx) => ({
          statusCode: 201,
          body: ProcessDefinitionStateResponse.parse(
            await dependencies.processes.createDefinition(
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
    "/v1/organizations/:organizationId/process-definitions/:definitionId/versions",
    { config: { capabilityId: "process.version.create" }, preHandler: dependencies.authenticate },
    async (request, reply) => {
      const path = DefinitionPath.parse(request.params);
      const body = ProcessVersionCreateRequest.parse(request.body);
      requestContext(request).organizationId = path.organizationId;
      const result = await mutate(
        request,
        "process.version.create",
        { ...path, ...body },
        async (tx) => ({
          statusCode: 201,
          body: ProcessDefinitionStateResponse.parse(
            await dependencies.processes.createVersion(
              tx,
              identity(request).accountId,
              path.definitionId,
              body,
            ),
          ),
        }),
      );
      return reply.code(201).send(result);
    },
  );
  app.post(
    "/v1/organizations/:organizationId/process-versions/:versionId/publish",
    { config: { capabilityId: "process.version.publish" }, preHandler: dependencies.authenticate },
    async (request) => {
      const path = VersionPath.parse(request.params);
      requestContext(request).organizationId = path.organizationId;
      return mutate(request, "process.version.publish", path, async (tx) => ({
        statusCode: 200,
        body: ProcessDefinitionStateResponse.parse(
          await dependencies.processes.publishVersion(
            tx,
            identity(request).accountId,
            path.versionId,
          ),
        ),
      }));
    },
  );
  app.post(
    "/v1/organizations/:organizationId/process-versions/:versionId/instances",
    { config: { capabilityId: "process.instance.start" }, preHandler: dependencies.authenticate },
    async (request, reply) => {
      const path = VersionPath.parse(request.params);
      const body = ProcessStartRequest.parse(request.body);
      requestContext(request).organizationId = path.organizationId;
      const result = await mutate(
        request,
        "process.instance.start",
        { ...path, ...body },
        async (tx) => ({
          statusCode: 201,
          body: ProcessInstanceStateResponse.parse(
            await dependencies.processes.start(
              tx,
              identity(request).accountId,
              path.versionId,
              body,
            ),
          ),
        }),
      );
      return reply.code(201).send(result);
    },
  );
  app.get(
    "/v1/organizations/:organizationId/process-instances/:instanceId",
    { config: { capabilityId: "process.instance.read" }, preHandler: dependencies.authenticate },
    async (request) => {
      const path = InstancePath.parse(request.params);
      requestContext(request).organizationId = path.organizationId;
      return dependencies.sql.begin(async (tx) =>
        ProcessInstanceStateResponse.parse(
          await dependencies.processes.read(
            tx,
            identity(request).accountId,
            path.organizationId,
            path.instanceId,
          ),
        ),
      );
    },
  );
  app.post(
    "/v1/organizations/:organizationId/process-instances/:instanceId/decisions",
    { config: { capabilityId: "process.instance.decide" }, preHandler: dependencies.authenticate },
    async (request) => {
      const path = InstancePath.parse(request.params);
      const body = ProcessDecisionRequest.parse(request.body);
      requestContext(request).organizationId = path.organizationId;
      return mutate(request, "process.instance.decide", { ...path, ...body }, async (tx) => ({
        statusCode: 200,
        body: ProcessInstanceStateResponse.parse(
          await dependencies.processes.decide(
            tx,
            identity(request).accountId,
            path.instanceId,
            body,
          ),
        ),
      }));
    },
  );
}
