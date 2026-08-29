import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { CapabilityId } from "@tashan/capabilities";
import {
  PartnerBulkTransferRequest,
  PartnerBulkTransferResponse,
  PartnerCreateRequest,
  PartnerDuplicateListResponse,
  PartnerExportRequest,
  PartnerExportResponse,
  PartnerInteractionAddRequest,
  PartnerInteractionListResponse,
  PartnerInteractionReadResponse,
  PartnerLinkRequest,
  PartnerLinkResponse,
  PartnerListQuery,
  PartnerListResponse,
  PartnerReadResponse,
  PartnerTransferRequest,
  PartnerUnlinkResponse,
  PartnerUpdateRequest,
  PartnerVersionRequest,
} from "@tashan/contracts";
import type { DatabaseClient } from "../db/client.js";
import type { TransactionClient } from "../db/transaction.js";
import type { MutationCoordinator } from "../http/idempotency.js";
import { requestContext } from "../http/request-context.js";
import type { InteractionService } from "../partners/interaction-service.js";
import type { PartnerLinkService } from "../partners/partner-link-service.js";
import type { PartnerService } from "../partners/partner-service.js";
const Org = z.object({ organizationId: z.uuid() }).strict(),
  Partner = Org.extend({ partnerId: z.uuid() }).strict(),
  Interaction = Partner.extend({ interactionId: z.uuid() }).strict(),
  Link = Partner.extend({ linkId: z.uuid() }).strict();
function identity(r: FastifyRequest) {
  const v = requestContext(r).identity;
  if (!v) throw new Error("authenticated identity missing");
  return v;
}
export async function registerPartnerRoutes(
  app: FastifyInstance,
  d: {
    sql: DatabaseClient;
    partners: PartnerService;
    interactions: InteractionService;
    links: PartnerLinkService;
    mutations: MutationCoordinator;
    authenticate: preHandlerHookHandler;
  },
) {
  const mutate = async (
    r: FastifyRequest,
    c: CapabilityId,
    i: unknown,
    w: Parameters<MutationCoordinator["executeIdempotent"]>[0]["work"],
  ) => {
    const a = identity(r);
    return (
      await d.mutations.executeIdempotent({
        request: r,
        capabilityId: c,
        actorPrincipalId: a.principalId,
        idempotencyInput: i,
        work: w,
      })
    ).body;
  };
  app.get(
    "/v1/organizations/:organizationId/partners",
    { config: { capabilityId: "partner.list" }, preHandler: d.authenticate },
    async (r) => {
      const p = Org.parse(r.params);
      requestContext(r).organizationId = p.organizationId;
      const items = await d.sql.begin((tx) =>
        d.partners.list(
          tx,
          identity(r).accountId,
          p.organizationId,
          PartnerListQuery.parse(r.query),
        ),
      );
      return PartnerListResponse.parse({ items, nextCursor: null });
    },
  );
  app.get(
    "/v1/organizations/:organizationId/partners/duplicate-candidates",
    { config: { capabilityId: "partner.duplicate.list" }, preHandler: d.authenticate },
    async (r) => {
      const p = Org.parse(r.params);
      requestContext(r).organizationId = p.organizationId;
      return PartnerDuplicateListResponse.parse(
        await d.sql.begin((tx) =>
          d.partners.duplicateCandidates(tx, identity(r).accountId, p.organizationId),
        ),
      );
    },
  );
  app.get(
    "/v1/organizations/:organizationId/partners/awaiting-owner",
    { config: { capabilityId: "partner.awaiting.owner.list" }, preHandler: d.authenticate },
    async (r) => {
      const p = Org.parse(r.params);
      requestContext(r).organizationId = p.organizationId;
      const items = await d.sql.begin((tx) =>
        d.partners.list(tx, identity(r).accountId, p.organizationId, {
          owner: "all",
          recordState: "awaiting_owner",
        }),
      );
      return PartnerListResponse.parse({ items, nextCursor: null });
    },
  );
  app.get(
    "/v1/organizations/:organizationId/partners/:partnerId",
    { config: { capabilityId: "partner.read" }, preHandler: d.authenticate },
    async (r) => {
      const p = Partner.parse(r.params);
      requestContext(r).organizationId = p.organizationId;
      return PartnerReadResponse.parse({
        partner: await d.sql.begin((tx) =>
          d.partners.read(tx, identity(r).accountId, p.organizationId, p.partnerId),
        ),
      });
    },
  );
  app.get(
    "/v1/organizations/:organizationId/partners/:partnerId/contact",
    { config: { capabilityId: "partner.contact.read" }, preHandler: d.authenticate },
    async (r) => {
      const p = Partner.parse(r.params);
      requestContext(r).organizationId = p.organizationId;
      return PartnerReadResponse.parse({
        partner: await d.sql.begin((tx) =>
          d.partners.read(tx, identity(r).accountId, p.organizationId, p.partnerId),
        ),
      });
    },
  );
  app.post(
    "/v1/organizations/:organizationId/partners",
    { config: { capabilityId: "partner.create" }, preHandler: d.authenticate },
    async (r, reply) => {
      const p = Org.parse(r.params),
        b = PartnerCreateRequest.parse(r.body);
      requestContext(r).organizationId = p.organizationId;
      const out = await mutate(r, "partner.create", { ...p, ...b }, async (tx) => ({
        statusCode: 201,
        body: PartnerReadResponse.parse({
          partner: await d.partners.create(tx, identity(r).accountId, p.organizationId, b),
        }),
      }));
      return reply.code(201).send(out);
    },
  );
  const action = (
    url: string,
    c: CapabilityId,
    schema: { parse(v: unknown): unknown },
    fn: (
      tx: TransactionClient,
      a: string,
      p: z.infer<typeof Partner>,
      b: unknown,
    ) => Promise<unknown>,
  ) =>
    app.post(url, { config: { capabilityId: c }, preHandler: d.authenticate }, async (r) => {
      const p = Partner.parse(r.params),
        b = schema.parse(r.body);
      requestContext(r).organizationId = p.organizationId;
      return mutate(r, c, { ...p, ...(b as object) }, async (tx) => ({
        statusCode: 200,
        body: PartnerReadResponse.parse({ partner: await fn(tx, identity(r).accountId, p, b) }),
      }));
    });
  action(
    "/v1/organizations/:organizationId/partners/:partnerId/update",
    "partner.update",
    PartnerUpdateRequest,
    (tx, a, p, b) => d.partners.update(tx, a, p.organizationId, p.partnerId, b),
  );
  action(
    "/v1/organizations/:organizationId/partners/:partnerId/archive",
    "partner.archive",
    PartnerVersionRequest,
    (tx, a, p, b) => d.partners.archive(tx, a, p.organizationId, p.partnerId, b),
  );
  action(
    "/v1/organizations/:organizationId/partners/:partnerId/restore",
    "partner.restore",
    PartnerVersionRequest,
    (tx, a, p, b) => d.partners.restore(tx, a, p.organizationId, p.partnerId, b),
  );
  action(
    "/v1/organizations/:organizationId/partners/:partnerId/transfer",
    "partner.transfer",
    PartnerTransferRequest,
    (tx, a, p, b) => d.partners.transfer(tx, a, p.organizationId, p.partnerId, b),
  );
  app.post(
    "/v1/organizations/:organizationId/partners/bulk-transfer",
    { config: { capabilityId: "partner.bulk.transfer" }, preHandler: d.authenticate },
    async (r) => {
      const p = Org.parse(r.params),
        b = PartnerBulkTransferRequest.parse(r.body);
      return mutate(r, "partner.bulk.transfer", { ...p, ...b }, async (tx) => ({
        statusCode: 200,
        body: PartnerBulkTransferResponse.parse(
          await d.partners.bulkTransfer(tx, identity(r).accountId, p.organizationId, b),
        ),
      }));
    },
  );
  app.get(
    "/v1/organizations/:organizationId/partners/:partnerId/interactions",
    { config: { capabilityId: "partner.interaction.list" }, preHandler: d.authenticate },
    async (r) => {
      const p = Partner.parse(r.params);
      return PartnerInteractionListResponse.parse({
        items: await d.sql.begin((tx) =>
          d.interactions.list(tx, identity(r).accountId, p.organizationId, p.partnerId),
        ),
      });
    },
  );
  app.post(
    "/v1/organizations/:organizationId/partners/:partnerId/interactions",
    { config: { capabilityId: "partner.interaction.add" }, preHandler: d.authenticate },
    async (r, reply) => {
      const p = Partner.parse(r.params),
        b = PartnerInteractionAddRequest.parse(r.body);
      const out = await mutate(r, "partner.interaction.add", { ...p, ...b }, async (tx) => ({
        statusCode: 201,
        body: PartnerInteractionReadResponse.parse({
          interaction: await d.interactions.add(
            tx,
            identity(r).accountId,
            p.organizationId,
            p.partnerId,
            b,
            String(r.headers["idempotency-key"] ?? ""),
          ),
        }),
      }));
      return reply.code(201).send(out);
    },
  );
  app.post(
    "/v1/organizations/:organizationId/partners/:partnerId/interactions/:interactionId/corrections",
    { config: { capabilityId: "partner.interaction.correct" }, preHandler: d.authenticate },
    async (r, reply) => {
      const p = Interaction.parse(r.params),
        b = PartnerInteractionAddRequest.parse({
          ...z.record(z.string(), z.unknown()).parse(r.body ?? {}),
          correctsInteractionId: p.interactionId,
        });
      const out = await mutate(r, "partner.interaction.correct", { ...p, ...b }, async (tx) => ({
        statusCode: 201,
        body: PartnerInteractionReadResponse.parse({
          interaction: await d.interactions.add(
            tx,
            identity(r).accountId,
            p.organizationId,
            p.partnerId,
            b,
            String(r.headers["idempotency-key"] ?? ""),
          ),
        }),
      }));
      return reply.code(201).send(out);
    },
  );
  app.post(
    "/v1/organizations/:organizationId/partners/:partnerId/links",
    { config: { capabilityId: "partner.link.create" }, preHandler: d.authenticate },
    async (r) => {
      const p = Partner.parse(r.params),
        b = PartnerLinkRequest.parse(r.body);
      return mutate(r, "partner.link.create", { ...p, ...b }, async (tx) => ({
        statusCode: 200,
        body: PartnerLinkResponse.parse(
          await d.links.link(tx, identity(r).accountId, p.organizationId, p.partnerId, b),
        ),
      }));
    },
  );
  app.delete(
    "/v1/organizations/:organizationId/partners/:partnerId/links/:linkId",
    { config: { capabilityId: "partner.link.unlink" }, preHandler: d.authenticate },
    async (r) => {
      const p = Link.parse(r.params);
      return mutate(r, "partner.link.unlink", p, async (tx) => ({
        statusCode: 200,
        body: PartnerUnlinkResponse.parse(
          await d.links.unlink(tx, identity(r).accountId, p.organizationId, p.partnerId, p.linkId),
        ),
      }));
    },
  );
  app.post(
    "/v1/organizations/:organizationId/partners/export",
    { config: { capabilityId: "partner.export" }, preHandler: d.authenticate },
    async (r) => {
      const p = Org.parse(r.params),
        b = PartnerExportRequest.parse(r.body);
      return mutate(r, "partner.export", { ...p, ...b }, async (tx) => ({
        statusCode: 200,
        body: PartnerExportResponse.parse(
          await d.partners.exportAll(tx, identity(r).accountId, p.organizationId),
        ),
      }));
    },
  );
}
