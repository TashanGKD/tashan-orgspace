import Fastify from "fastify";
import { describe, expect, test, vi } from "vitest";

import { registerWorkRoutes } from "../../src/routes/work-routes.js";

const expected = [
  ["GET", "/v1/organizations/:organizationId/work-items", "work.item.list"],
  ["GET", "/v1/organizations/:organizationId/work-items/:workItemId", "work.item.read"],
  ["POST", "/v1/organizations/:organizationId/work-items", "work.item.create"],
  ["POST", "/v1/organizations/:organizationId/tasks", "task.create"],
  ["POST", "/v1/organizations/:organizationId/meetings", "meeting.create"],
  ["POST", "/v1/organizations/:organizationId/approvals", "approval.create"],
  ["POST", "/v1/organizations/:organizationId/work-items/:workItemId/assign", "work.item.assign"],
  [
    "POST",
    "/v1/organizations/:organizationId/work-items/:workItemId/assignments/:assignmentId/dispute",
    "work.assignment.dispute",
  ],
  [
    "POST",
    "/v1/organizations/:organizationId/work-items/:workItemId/assignments/:assignmentId/transfer-request",
    "work.assignment.transfer.request",
  ],
  [
    "POST",
    "/v1/organizations/:organizationId/work-items/:workItemId/assignments/:assignmentId/transfer-approve",
    "work.assignment.transfer.approve",
  ],
  [
    "POST",
    "/v1/organizations/:organizationId/work-items/:workItemId/complete",
    "work.item.complete",
  ],
  ["POST", "/v1/organizations/:organizationId/work-items/:workItemId/reopen", "work.item.reopen"],
  ["POST", "/v1/organizations/:organizationId/work-items/:workItemId/cancel", "work.item.cancel"],
  ["POST", "/v1/organizations/:organizationId/process-definitions", "process.definition.create"],
  [
    "POST",
    "/v1/organizations/:organizationId/process-definitions/:definitionId/versions",
    "process.version.create",
  ],
  [
    "POST",
    "/v1/organizations/:organizationId/process-versions/:versionId/publish",
    "process.version.publish",
  ],
  [
    "POST",
    "/v1/organizations/:organizationId/process-versions/:versionId/instances",
    "process.instance.start",
  ],
  [
    "GET",
    "/v1/organizations/:organizationId/process-instances/:instanceId",
    "process.instance.read",
  ],
  [
    "POST",
    "/v1/organizations/:organizationId/process-instances/:instanceId/decisions",
    "process.instance.decide",
  ],
] as const;

describe("work HTTP capability routes", () => {
  test("mounts the exact work and process routes", async () => {
    const app = Fastify();
    const observed: string[][] = [];
    app.addHook("onRoute", (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        if (method !== "HEAD") observed.push([method, route.url, route.config?.capabilityId ?? ""]);
      }
    });
    await registerWorkRoutes(app, {
      authenticate: vi.fn(),
      mutations: {},
      work: {},
      processes: {},
    } as never);
    await app.ready();
    expect(observed.sort()).toEqual(expected.map((item) => [...item]).sort());
    await app.close();
  });
});
