import { describe, expect, test } from "vitest";

import deferredScope from "../../deferred-product-scope.json" with { type: "json" };
import modules from "../../product-modules.json" with { type: "json" };

import { parseProductModules } from "./module-catalog.js";

const base = {
  id: "organization.home",
  label: "组织首页",
  description: "查看当前组织的工作入口。",
  context: "organization",
  status: "available",
  route: "/org/:organizationId/home",
  roles: ["org_owner", "org_admin", "member"],
  capabilities: ["organization.list"],
};

describe("product module catalog", () => {
  test("rejects duplicate module IDs", () => {
    expect(() =>
      parseProductModules([base, { ...base, route: "/org/:organizationId/copy" }]),
    ).toThrow(/duplicate module ID: organization.home/);
  });

  test("rejects duplicate normalized routes", () => {
    expect(() => parseProductModules([base, { ...base, id: "organization.copy" }])).toThrow(
      /duplicate module route: \/org\/:organizationId\/home/,
    );
  });

  test("rejects a coming-soon module with executable capabilities", () => {
    expect(() => parseProductModules([{ ...base, status: "coming_soon" }])).toThrow(
      /coming-soon modules cannot bind capabilities: organization.home/,
    );
  });

  test("rejects an organization route without an organization segment", () => {
    expect(() => parseProductModules([{ ...base, route: "/tasks" }])).toThrow(
      /organization route must contain :organizationId: organization.home/,
    );
  });

  test("rejects an organization segment outside organization context", () => {
    expect(() => parseProductModules([{ ...base, context: "global" }])).toThrow(
      /non-organization route cannot contain :organizationId: organization.home/,
    );
  });

  test("accepts distinct available and inert coming-soon modules", () => {
    const modules = parseProductModules([
      base,
      {
        id: "organization.tasks",
        label: "任务",
        description: "组织任务与指派。",
        context: "organization",
        status: "coming_soon",
        route: "/org/:organizationId/tasks",
        roles: ["org_owner", "org_admin", "member"],
        capabilities: [],
      },
    ]);
    expect(modules).toHaveLength(2);
  });

  test("keeps every deferred direction visible but inert", () => {
    const catalog = parseProductModules(modules);
    for (const moduleId of deferredScope.moduleIds) {
      const module = catalog.find((candidate) => candidate.id === moduleId);
      expect(module?.status).toBe("coming_soon");
      expect(module?.capabilities).toEqual([]);
    }
  });
});
