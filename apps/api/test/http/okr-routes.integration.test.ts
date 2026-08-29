import Fastify from "fastify";
import { describe, expect, test, vi } from "vitest";
import { registerOkrRoutes } from "../../src/routes/okr-routes.js";

const expected = [
  ["GET", "/v1/organizations/:organizationId/objectives", "okr.objective.list"],
  ["GET", "/v1/organizations/:organizationId/objectives/:objectiveId", "okr.objective.read"],
  ["POST", "/v1/organizations/:organizationId/objectives", "okr.objective.create"],
  [
    "POST",
    "/v1/organizations/:organizationId/key-results/:keyResultId/progress",
    "okr.progress.update",
  ],
  [
    "POST",
    "/v1/organizations/:organizationId/objectives/:objectiveId/change-requests",
    "okr.change.request",
  ],
  [
    "POST",
    "/v1/organizations/:organizationId/okr-change-requests/:changeRequestId/approve",
    "okr.change.approve",
  ],
  [
    "POST",
    "/v1/organizations/:organizationId/objectives/:objectiveId/admin-edit",
    "okr.objective.edit.admin",
  ],
] as const;

describe("OKR HTTP capability routes", () => {
  test("mounts the exact OKR routes", async () => {
    const app = Fastify();
    const observed: string[][] = [];
    app.addHook("onRoute", (route) => {
      for (const method of Array.isArray(route.method) ? route.method : [route.method])
        if (method !== "HEAD") observed.push([method, route.url, route.config?.capabilityId ?? ""]);
    });
    await registerOkrRoutes(app, {
      sql: {},
      okr: {},
      mutations: {},
      authenticate: vi.fn(),
    } as never);
    await app.ready();
    expect(observed.sort()).toEqual(expected.map((row) => [...row]).sort());
    await app.close();
  });
});
