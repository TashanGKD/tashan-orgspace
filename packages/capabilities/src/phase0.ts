import { z } from "zod";

import rawDefinitions from "./phase0-capabilities.json" with { type: "json" };
import { buildRegistry } from "./registry.js";
import { Capability } from "./schema.js";

const definitions = z.array(Capability).length(108).parse(rawDefinitions);

export const phase0Registry = buildRegistry(definitions);
export const phase0Capabilities = Object.freeze([...phase0Registry.values()]);

const capabilityIds = phase0Capabilities.map(({ id }) => id) as [string, ...string[]];

export const CapabilityId = z.enum(capabilityIds);
export type CapabilityId = z.infer<typeof CapabilityId>;

export const CapabilityBindings = z.record(CapabilityId, z.string().min(1));
export const CapabilitySurface = z
  .object({
    capabilityId: CapabilityId,
    route: z.string().startsWith("/"),
    action: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    test: z.string().regex(/^apps\/web\/src\/.+\.test\.tsx?$/),
  })
  .strict();
export const CapabilitySurfaceList = z.array(CapabilitySurface).superRefine((values, context) => {
  const capabilityIds = values.map(({ capabilityId }) => capabilityId);
  const actions = values.map(({ action }) => action);
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    context.addIssue({ code: "custom", message: "duplicate Web capability" });
  }
  if (new Set(actions).size !== actions.length) {
    context.addIssue({ code: "custom", message: "duplicate Web action" });
  }
});
