import { describe, expect, test } from "vitest";

import { parseResourceSurfaces, type ResourceSurfaceInput } from "./resource-surfaces.js";

const surfaces = [
  {
    resourceType: "organization",
    context: "global",
    listRoute: "/organizations",
    detailRoute: "/org/:organizationId/home",
    listCapability: "organization.list",
    readCapability: "organization.list",
    actions: [{ capabilityId: "organization.create", confirmation: "required" }],
  },
  {
    resourceType: "device",
    context: "global",
    listRoute: "/account",
    detailRoute: "/account/devices/:deviceId",
    listCapability: "device.list",
    readCapability: "device.list",
    actions: [{ capabilityId: "device.revoke", confirmation: "required" }],
  },
  {
    resourceType: "organization-member",
    context: "organization",
    listRoute: "/org/:organizationId/admin/members",
    detailRoute: "/org/:organizationId/admin/members/:accountId",
    listCapability: "organization.member.list",
    readCapability: "organization.member.list",
    actions: [{ capabilityId: "organization.member.add", confirmation: "required" }],
  },
  {
    resourceType: "audit-event",
    context: "organization",
    listRoute: "/org/:organizationId/admin/audit",
    detailRoute: "/org/:organizationId/admin/audit/:eventId",
    listCapability: "audit.list",
    readCapability: "audit.list",
    actions: [],
  },
] as const satisfies readonly ResourceSurfaceInput[];

function clone(): ResourceSurfaceInput[] {
  return JSON.parse(JSON.stringify(surfaces)) as ResourceSurfaceInput[];
}

describe("resource surface registry", () => {
  test("parses active Phase 0 list, detail, and action surfaces", () => {
    expect(parseResourceSurfaces(surfaces)).toHaveLength(4);
  });

  test("rejects duplicate resource types and routes", () => {
    expect(() => parseResourceSurfaces([...surfaces, surfaces[0]])).toThrow(
      /duplicate resource type: organization/,
    );
    const duplicateRoute = clone();
    duplicateRoute[1] = { ...duplicateRoute[1]!, listRoute: duplicateRoute[0]!.listRoute };
    expect(() => parseResourceSurfaces(duplicateRoute)).toThrow(
      /duplicate list route: \/organizations/,
    );
  });

  test("rejects organization surfaces without organization context in both routes", () => {
    const invalid = clone();
    invalid[2] = { ...invalid[2]!, detailRoute: "/members/:accountId" };
    expect(() => parseResourceSurfaces(invalid)).toThrow(
      /organization surface routes must contain :organizationId/,
    );
  });

  test("rejects list routes reused as details and details without object parameters", () => {
    const same = clone();
    same[1] = { ...same[1]!, detailRoute: same[1]!.listRoute };
    expect(() => parseResourceSurfaces(same)).toThrow(/detail route must differ from list route/);

    const noObject = clone();
    noObject[3] = {
      ...noObject[3]!,
      detailRoute: "/org/:organizationId/admin/audit/detail",
    };
    expect(() => parseResourceSurfaces(noObject)).toThrow(
      /detail route must contain an object parameter/,
    );
  });

  test("rejects unknown capabilities and weaker action confirmations", () => {
    const unknown = clone();
    unknown[0] = { ...unknown[0]!, readCapability: "organization.read" as "organization.list" };
    expect(() => parseResourceSurfaces(unknown)).toThrow();

    const weak = clone();
    weak[1] = {
      ...weak[1]!,
      actions: [{ capabilityId: "device.revoke", confirmation: "none" }],
    };
    expect(() => parseResourceSurfaces(weak)).toThrow(
      /action confirmation is weaker than capability: device.revoke/,
    );
  });
});
