import type { FastifyInstance, preHandlerHookHandler } from "fastify";

import {
  OrganizationCreateRequest,
  OrganizationCreateResponse,
  OrganizationIdPath,
  OrganizationListResponse,
  OrganizationMemberAddRequest,
  OrganizationMemberAddResponse,
  OrganizationMemberListResponse,
} from "@tashan/contracts";

import type { DatabaseClient } from "../db/client.js";
import type { MutationCoordinator } from "../http/idempotency.js";
import { requestContext } from "../http/request-context.js";
import type { OrganizationService } from "../organizations/organization-service.js";
import { membershipSummary, organizationSummary } from "./route-helpers.js";

export async function registerOrganizationRoutes(
  app: FastifyInstance,
  dependencies: {
    sql: DatabaseClient;
    organizations: OrganizationService;
    mutations: MutationCoordinator;
    authenticate: preHandlerHookHandler;
  },
): Promise<void> {
  app.get(
    "/v1/organizations",
    { config: { capabilityId: "organization.list" }, preHandler: dependencies.authenticate },
    async (request) => {
      const identity = requestContext(request).identity;
      if (identity === undefined) throw new Error("authenticated identity is missing");
      const rows = await dependencies.sql<
        {
          id: string;
          name: string;
          status: "active" | "suspended" | "closed";
          storage_quota_bytes: string | number;
          created_at: Date;
        }[]
      >`
        select o.id, o.name, o.status, o.storage_quota_bytes, o.created_at
        from organizations o
        join memberships m on m.organization_id = o.id
        where m.account_id = ${identity.accountId} and m.status = 'active'
        order by o.created_at, o.id
      `;
      return OrganizationListResponse.parse({
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          storageQuotaBytes: Number(row.storage_quota_bytes),
          createdAt: row.created_at.toISOString(),
        })),
      });
    },
  );

  app.post(
    "/v1/organizations",
    { config: { capabilityId: "organization.create" }, preHandler: dependencies.authenticate },
    async (request, reply) => {
      const body = OrganizationCreateRequest.parse(request.body);
      const context = requestContext(request);
      const identity = context.identity;
      if (identity === undefined) throw new Error("authenticated identity is missing");
      const result = await dependencies.mutations.executeIdempotent({
        request,
        capabilityId: "organization.create",
        actorPrincipalId: identity.principalId,
        idempotencyInput: body,
        work: async (transaction) => {
          const created = await dependencies.organizations.createOrganization(
            identity.accountId,
            body.name,
            transaction,
          );
          context.organizationId = created.id;
          return {
            statusCode: 201,
            body: OrganizationCreateResponse.parse({
              organization: await organizationSummary(transaction, created.id),
              membership: await membershipSummary(transaction, created.membershipId),
            }),
          };
        },
      });
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.get(
    "/v1/organizations/:organizationId/members",
    {
      config: { capabilityId: "organization.member.list" },
      preHandler: dependencies.authenticate,
    },
    async (request) => {
      const { organizationId } = OrganizationIdPath.parse(request.params);
      const context = requestContext(request);
      const identity = context.identity;
      if (identity === undefined) throw new Error("authenticated identity is missing");
      context.organizationId = organizationId;
      const rows = await dependencies.organizations.listMembers(identity.accountId, organizationId);
      return OrganizationMemberListResponse.parse({
        items: rows.map((row) => ({
          id: row.id,
          organizationId: row.organization_id,
          accountId: row.account_id,
          username: row.username,
          role: row.role,
          status: row.status,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        })),
      });
    },
  );

  app.post(
    "/v1/organizations/:organizationId/members",
    {
      config: { capabilityId: "organization.member.add" },
      preHandler: dependencies.authenticate,
    },
    async (request, reply) => {
      const { organizationId } = OrganizationIdPath.parse(request.params);
      const body = OrganizationMemberAddRequest.parse(request.body);
      const context = requestContext(request);
      const identity = context.identity;
      if (identity === undefined) throw new Error("authenticated identity is missing");
      context.organizationId = organizationId;
      const result = await dependencies.mutations.executeIdempotent({
        request,
        capabilityId: "organization.member.add",
        actorPrincipalId: identity.principalId,
        idempotencyInput: { organizationId, ...body },
        work: async (transaction) => {
          const membership = await dependencies.organizations.addMember(
            identity.accountId,
            organizationId,
            body.accountId,
            body.role,
            transaction,
          );
          return {
            statusCode: 201,
            body: OrganizationMemberAddResponse.parse({
              membership: await membershipSummary(transaction, membership.id),
            }),
          };
        },
      });
      return reply.code(result.statusCode).send(result.body);
    },
  );
}
