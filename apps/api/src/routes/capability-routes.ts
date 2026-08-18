import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { Capability, phase0Capabilities, phase0Registry } from "@tashan/capabilities";
import { CapabilityIdPath, HealthResponse } from "@tashan/contracts";

import { AuthError } from "../auth/auth-errors.js";

const CapabilityListResponse = z.object({ items: z.array(Capability) }).strict();

export async function registerCapabilityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/health", { config: { capabilityId: "system.health.read" } }, async () =>
    HealthResponse.parse({
      status: "ok",
      version: "0.0.0",
      time: new Date().toISOString(),
    }),
  );

  app.get("/v1/capabilities", { config: { capabilityId: "capability.list" } }, async () =>
    CapabilityListResponse.parse({ items: phase0Capabilities }),
  );

  app.get(
    "/v1/capabilities/:capabilityId",
    { config: { capabilityId: "capability.describe" } },
    async (request) => {
      const { capabilityId } = CapabilityIdPath.parse(request.params);
      const capability = phase0Registry.get(capabilityId);
      if (capability === undefined) {
        throw new AuthError("CAPABILITY_NOT_FOUND", "capability was not found");
      }
      return Capability.parse(capability);
    },
  );
}
