import Fastify from "fastify";
import { describe, expect, test, vi } from "vitest";
import { registerPartnerRoutes } from "../../src/routes/partner-routes.js";

const expected = [
  ["GET", "/v1/organizations/:organizationId/partners", "partner.list"],
  ["GET", "/v1/organizations/:organizationId/partners/:partnerId", "partner.read"],
  ["POST", "/v1/organizations/:organizationId/partners", "partner.create"],
  ["POST", "/v1/organizations/:organizationId/partners/:partnerId/update", "partner.update"],
  ["POST", "/v1/organizations/:organizationId/partners/:partnerId/archive", "partner.archive"],
  ["POST", "/v1/organizations/:organizationId/partners/:partnerId/restore", "partner.restore"],
  ["POST", "/v1/organizations/:organizationId/partners/:partnerId/transfer", "partner.transfer"],
  ["POST", "/v1/organizations/:organizationId/partners/bulk-transfer", "partner.bulk.transfer"],
  [
    "GET",
    "/v1/organizations/:organizationId/partners/duplicate-candidates",
    "partner.duplicate.list",
  ],
  [
    "GET",
    "/v1/organizations/:organizationId/partners/awaiting-owner",
    "partner.awaiting.owner.list",
  ],
  ["GET", "/v1/organizations/:organizationId/partners/:partnerId/contact", "partner.contact.read"],
  [
    "GET",
    "/v1/organizations/:organizationId/partners/:partnerId/interactions",
    "partner.interaction.list",
  ],
  [
    "POST",
    "/v1/organizations/:organizationId/partners/:partnerId/interactions",
    "partner.interaction.add",
  ],
  [
    "POST",
    "/v1/organizations/:organizationId/partners/:partnerId/interactions/:interactionId/corrections",
    "partner.interaction.correct",
  ],
  ["POST", "/v1/organizations/:organizationId/partners/:partnerId/links", "partner.link.create"],
  [
    "DELETE",
    "/v1/organizations/:organizationId/partners/:partnerId/links/:linkId",
    "partner.link.unlink",
  ],
  ["POST", "/v1/organizations/:organizationId/partners/export", "partner.export"],
] as const;
describe("partner routes", () => {
  test("mounts the exact partner capabilities", async () => {
    const app = Fastify(),
      seen: string[][] = [];
    app.addHook("onRoute", (r) => {
      for (const m of Array.isArray(r.method) ? r.method : [r.method])
        if (m !== "HEAD") seen.push([m, r.url, r.config?.capabilityId ?? ""]);
    });
    await registerPartnerRoutes(app, {
      sql: {},
      partners: {},
      interactions: {},
      links: {},
      mutations: {},
      authenticate: vi.fn(),
    } as never);
    await app.ready();
    expect(seen.sort()).toEqual(expected.map((v) => [...v]).sort());
    await app.close();
  });
});
