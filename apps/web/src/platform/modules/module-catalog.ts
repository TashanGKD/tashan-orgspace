import { z } from "zod";

import { CapabilityId } from "@tashan/capabilities";

import rawDeferredScope from "../../deferred-product-scope.json" with { type: "json" };
import rawModules from "../../product-modules.json" with { type: "json" };

export const ProductModuleContext = z.enum(["global", "personal", "organization"]);
export const ProductModuleStatus = z.enum(["available", "coming_soon"]);
export const ProductModule = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/),
    label: z.string().trim().min(1).max(64),
    description: z.string().trim().min(1).max(240),
    context: ProductModuleContext,
    status: ProductModuleStatus,
    route: z
      .string()
      .startsWith("/")
      .refine((route) => !route.endsWith("/"), {
        message: "module route must not end with a slash",
      }),
    roles: z.array(z.enum(["org_owner", "org_admin", "member"])),
    capabilities: z.array(CapabilityId),
  })
  .strict();

export type ProductModule = z.infer<typeof ProductModule>;

const DeferredProductScope = z
  .object({
    decisionId: z.literal("defer-compute-and-user-web-deployment-2026-08-28"),
    status: z.literal("deferred_visible"),
    moduleIds: z.array(z.string()).length(4),
    requiredModuleStatus: z.literal("coming_soon"),
    forbiddenCapabilityPrefixes: z.array(z.string().min(1)),
    requiredDocumentMarker: z.string().min(1),
  })
  .strict();

export const deferredProductScope = DeferredProductScope.parse(rawDeferredScope);
export const deferredModuleIds = new Set(deferredProductScope.moduleIds);

export function parseProductModules(input: unknown): readonly ProductModule[] {
  const modules = z.array(ProductModule).parse(input);
  const ids = new Set<string>();
  const routes = new Set<string>();

  for (const module of modules) {
    if (ids.has(module.id)) throw new Error(`duplicate module ID: ${module.id}`);
    if (routes.has(module.route)) throw new Error(`duplicate module route: ${module.route}`);
    ids.add(module.id);
    routes.add(module.route);

    if (module.status === "coming_soon" && module.capabilities.length > 0) {
      throw new Error(`coming-soon modules cannot bind capabilities: ${module.id}`);
    }
    if (module.context === "organization" && !module.route.includes(":organizationId")) {
      throw new Error(`organization route must contain :organizationId: ${module.id}`);
    }
    if (module.context !== "organization" && module.route.includes(":organizationId")) {
      throw new Error(`non-organization route cannot contain :organizationId: ${module.id}`);
    }
    if (module.context === "organization" && module.roles.length === 0) {
      throw new Error(`organization module must declare roles: ${module.id}`);
    }
    if (module.context !== "organization" && module.roles.length > 0) {
      throw new Error(`non-organization module cannot declare roles: ${module.id}`);
    }
  }

  return Object.freeze(modules.map((module) => Object.freeze(module)));
}

export const productModules = parseProductModules(rawModules);

for (const moduleId of deferredModuleIds) {
  const module = productModules.find((candidate) => candidate.id === moduleId);
  if (module === undefined) throw new Error(`missing deferred product module: ${moduleId}`);
  if (module.status !== deferredProductScope.requiredModuleStatus) {
    throw new Error(`deferred product module must remain coming_soon: ${moduleId}`);
  }
  if (module.capabilities.length !== 0) {
    throw new Error(`deferred product module cannot bind capabilities: ${moduleId}`);
  }
}
