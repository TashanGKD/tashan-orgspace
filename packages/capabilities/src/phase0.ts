import { z } from "zod";

import rawDefinitions from "./phase0-capabilities.json" with { type: "json" };
import { buildRegistry } from "./registry.js";
import { Capability } from "./schema.js";

const definitions = z.array(Capability).length(17).parse(rawDefinitions);

export const phase0Registry = buildRegistry(definitions);
export const phase0Capabilities = Object.freeze([...phase0Registry.values()]);

const capabilityIds = phase0Capabilities.map(({ id }) => id) as [string, ...string[]];

export const CapabilityId = z.enum(capabilityIds);
export type CapabilityId = z.infer<typeof CapabilityId>;

export const CapabilityBindings = z.record(CapabilityId, z.string().min(1));
export const CapabilitySurfaceList = z.array(CapabilityId).superRefine((values, context) => {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", message: "duplicate capability surface" });
  }
});
