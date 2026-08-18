import { z } from "zod";

import { DeviceId, IsoDateTime, OrganizationId } from "./common.js";

export const Empty = z.object({}).strict();
export type Empty = z.infer<typeof Empty>;

export const HealthResponse = z
  .object({
    status: z.literal("ok"),
    version: z.string().min(1),
    time: IsoDateTime,
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponse>;

export const CapabilityIdPath = z
  .object({ capabilityId: z.string().regex(/^[a-z]+(?:\.[a-z]+)+$/) })
  .strict();
export type CapabilityIdPath = z.infer<typeof CapabilityIdPath>;

export const DeviceIdPath = z.object({ deviceId: DeviceId }).strict();
export type DeviceIdPath = z.infer<typeof DeviceIdPath>;

export const OrganizationIdPath = z.object({ organizationId: OrganizationId }).strict();
export type OrganizationIdPath = z.infer<typeof OrganizationIdPath>;
