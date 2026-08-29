import Fastify from "fastify";
import { describe, expect, test, vi } from "vitest";

import { registerFileRoutes } from "../../src/routes/file-routes.js";
import { registerSpaceRoutes } from "../../src/routes/space-routes.js";

const expected = [
  ["GET", "/v1/spaces", "space.list"],
  ["GET", "/v1/spaces/:spaceId", "space.read"],
  ["GET", "/v1/spaces/:spaceId/usage", "space.usage.read"],
  [
    "POST",
    "/v1/organizations/:organizationId/members/:accountId/personal-space-quota",
    "space.quota.set",
  ],
  ["GET", "/v1/spaces/:spaceId/entries", "file.list"],
  ["GET", "/v1/spaces/:spaceId/entries/:entryId", "file.read"],
  ["GET", "/v1/spaces/:spaceId/search", "file.search"],
  ["POST", "/v1/spaces/:spaceId/folders", "file.folder.create"],
  ["POST", "/v1/spaces/:spaceId/entries/:entryId/move", "file.move"],
  ["POST", "/v1/spaces/:spaceId/entries/:entryId/trash", "file.trash"],
  ["POST", "/v1/spaces/:spaceId/entries/:entryId/restore", "file.restore"],
  ["DELETE", "/v1/spaces/:spaceId/entries/:entryId", "file.delete"],
  ["POST", "/v1/spaces/:spaceId/entries/:entryId/download", "file.download.create"],
  ["GET", "/v1/spaces/:spaceId/entries/:entryId/versions", "file.version.list"],
  [
    "POST",
    "/v1/spaces/:spaceId/entries/:entryId/versions/:versionId/restore",
    "file.version.restore",
  ],
  ["GET", "/v1/spaces/:spaceId/uploads", "file.upload.list"],
  ["POST", "/v1/spaces/:spaceId/uploads", "file.upload.create"],
  ["GET", "/v1/spaces/:spaceId/uploads/:uploadSessionId", "file.upload.read"],
  ["POST", "/v1/spaces/:spaceId/uploads/:uploadSessionId/parts", "file.upload.parts.create"],
  ["POST", "/v1/spaces/:spaceId/uploads/:uploadSessionId/complete", "file.upload.complete"],
  ["POST", "/v1/spaces/:spaceId/uploads/:uploadSessionId/cancel", "file.upload.cancel"],
  ["GET", "/v1/spaces/:spaceId/folders/:folderId/access", "folder.access.read"],
  ["POST", "/v1/spaces/:spaceId/folders/:folderId/access", "folder.access.set"],
  ["POST", "/v1/spaces/:spaceId/folders/:folderId/grants", "folder.grant.set"],
  ["DELETE", "/v1/spaces/:spaceId/folders/:folderId/grants/:accountId", "folder.grant.revoke"],
  ["POST", "/v1/spaces/:spaceId/folders/:folderId/manager-recovery", "folder.manager.recover"],
] as const;

describe("file HTTP capability routes", () => {
  test("mounts the exact 26 methods, paths and capability IDs", async () => {
    const app = Fastify();
    const observed: string[][] = [];
    app.addHook("onRoute", (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        if (method !== "HEAD") observed.push([method, route.url, route.config?.capabilityId ?? ""]);
      }
    });
    const dependencies = {
      authenticate: vi.fn(),
      spaces: {},
      files: {},
      uploads: {},
      mutations: {},
    } as never;
    await registerSpaceRoutes(app, dependencies);
    await registerFileRoutes(app, dependencies);
    await app.ready();
    expect(observed.sort()).toEqual(expected.map((item) => [...item]).sort());
    await app.close();
  });
});
