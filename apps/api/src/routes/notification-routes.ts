import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { CapabilityId } from "@tashan/capabilities";
import {
  NotificationListQuery,
  NotificationListResponse,
  NotificationMarkReadResponse,
  NotificationPolicyPublishRequest,
  NotificationPolicyResponse,
  NotificationPreferenceResponse,
  NotificationPreferenceUpdateRequest,
  NotificationReadResponse,
} from "@tashan/contracts";
import type { DatabaseClient } from "../db/client.js";
import type { MutationCoordinator } from "../http/idempotency.js";
import { requestContext } from "../http/request-context.js";
import type { NotificationPolicyService } from "../notifications/notification-policy-service.js";
import type { NotificationService } from "../notifications/notification-service.js";

const OrganizationPath = z.object({ organizationId: z.uuid() }).strict();
const NotificationPath = OrganizationPath.extend({ notificationId: z.uuid() }).strict();

function identity(request: FastifyRequest) {
  const value = requestContext(request).identity;
  if (!value) throw new Error("authenticated identity is missing");
  return value;
}

export async function registerNotificationRoutes(
  app: FastifyInstance,
  dependencies: {
    sql: DatabaseClient;
    notifications: NotificationService;
    policies: NotificationPolicyService;
    mutations: MutationCoordinator;
    authenticate: preHandlerHookHandler;
  },
) {
  const mutate = async (
    request: FastifyRequest,
    capabilityId: CapabilityId,
    input: unknown,
    work: Parameters<MutationCoordinator["executeIdempotent"]>[0]["work"],
  ) =>
    (
      await dependencies.mutations.executeIdempotent({
        request,
        capabilityId,
        actorPrincipalId: identity(request).principalId,
        idempotencyInput: input,
        work,
      })
    ).body;

  app.get(
    "/v1/organizations/:organizationId/notifications",
    { config: { capabilityId: "notification.list" }, preHandler: dependencies.authenticate },
    async (request) => {
      const path = OrganizationPath.parse(request.params);
      requestContext(request).organizationId = path.organizationId;
      return dependencies.sql.begin(async (tx) =>
        NotificationListResponse.parse(
          await dependencies.notifications.list(
            tx,
            identity(request).accountId,
            path.organizationId,
            NotificationListQuery.parse(request.query),
          ),
        ),
      );
    },
  );
  app.get(
    "/v1/organizations/:organizationId/notifications/:notificationId",
    { config: { capabilityId: "notification.read" }, preHandler: dependencies.authenticate },
    async (request) => {
      const path = NotificationPath.parse(request.params);
      requestContext(request).organizationId = path.organizationId;
      return dependencies.sql.begin(async (tx) =>
        NotificationReadResponse.parse(
          await dependencies.notifications.read(
            tx,
            identity(request).accountId,
            path.organizationId,
            path.notificationId,
          ),
        ),
      );
    },
  );
  app.post(
    "/v1/organizations/:organizationId/notifications/:notificationId/read",
    {
      config: { capabilityId: "notification.mark.read" },
      preHandler: dependencies.authenticate,
    },
    async (request) => {
      const path = NotificationPath.parse(request.params);
      requestContext(request).organizationId = path.organizationId;
      return mutate(request, "notification.mark.read", path, async (tx) => ({
        statusCode: 200,
        body: NotificationMarkReadResponse.parse(
          await dependencies.notifications.markRead(
            tx,
            identity(request).accountId,
            path.organizationId,
            path.notificationId,
          ),
        ),
      }));
    },
  );
  app.get(
    "/v1/organizations/:organizationId/notification-preference",
    {
      config: { capabilityId: "notification.preference.read" },
      preHandler: dependencies.authenticate,
    },
    async (request) => {
      const path = OrganizationPath.parse(request.params);
      requestContext(request).organizationId = path.organizationId;
      return dependencies.sql.begin(async (tx) =>
        NotificationPreferenceResponse.parse(
          await dependencies.policies.getPreference(
            tx,
            identity(request).accountId,
            path.organizationId,
          ),
        ),
      );
    },
  );
  app.post(
    "/v1/organizations/:organizationId/notification-preference",
    {
      config: { capabilityId: "notification.preference.update" },
      preHandler: dependencies.authenticate,
    },
    async (request) => {
      const path = OrganizationPath.parse(request.params);
      const body = NotificationPreferenceUpdateRequest.parse(request.body);
      requestContext(request).organizationId = path.organizationId;
      return mutate(
        request,
        "notification.preference.update",
        { ...path, ...body },
        async (tx) => ({
          statusCode: 200,
          body: NotificationPreferenceResponse.parse(
            await dependencies.policies.setPreference(
              tx,
              identity(request).accountId,
              path.organizationId,
              body,
            ),
          ),
        }),
      );
    },
  );
  app.get(
    "/v1/organizations/:organizationId/notification-policy",
    {
      config: { capabilityId: "notification.policy.read" },
      preHandler: dependencies.authenticate,
    },
    async (request) => {
      const path = OrganizationPath.parse(request.params);
      requestContext(request).organizationId = path.organizationId;
      return dependencies.sql.begin(async (tx) =>
        NotificationPolicyResponse.parse(
          await dependencies.policies.getPolicy(
            tx,
            identity(request).accountId,
            path.organizationId,
          ),
        ),
      );
    },
  );
  app.post(
    "/v1/organizations/:organizationId/notification-policy",
    {
      config: { capabilityId: "notification.policy.publish" },
      preHandler: dependencies.authenticate,
    },
    async (request) => {
      const path = OrganizationPath.parse(request.params);
      const body = NotificationPolicyPublishRequest.parse(request.body);
      requestContext(request).organizationId = path.organizationId;
      return mutate(request, "notification.policy.publish", { ...path, ...body }, async (tx) => ({
        statusCode: 200,
        body: NotificationPolicyResponse.parse(
          await dependencies.policies.publish(
            tx,
            identity(request).accountId,
            path.organizationId,
            body,
          ),
        ),
      }));
    },
  );
}
