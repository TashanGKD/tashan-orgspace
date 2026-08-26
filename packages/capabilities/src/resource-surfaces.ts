import { z } from "zod";

import { CapabilityId, phase0Registry } from "./phase0.js";

const AbsoluteRoute = z
  .string()
  .startsWith("/")
  .superRefine((route, context) => {
    const segments = route.split("/");
    if (
      route.includes("\\") ||
      route.includes("//") ||
      route.includes("?") ||
      route.includes("#") ||
      segments.includes(".") ||
      segments.includes("..") ||
      (route !== "/" && route.endsWith("/"))
    ) {
      context.addIssue({ code: "custom", message: `invalid absolute route: ${route}` });
    }
  });

const ResourceAction = z
  .object({
    capabilityId: CapabilityId,
    confirmation: z.enum(["none", "required", "high-risk"]),
  })
  .strict();

const ResourceSurface = z
  .object({
    resourceType: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    context: z.enum(["global", "personal", "organization"]),
    listRoute: AbsoluteRoute,
    detailRoute: AbsoluteRoute,
    listCapability: CapabilityId,
    readCapability: CapabilityId,
    actions: z.array(ResourceAction),
  })
  .strict();

export type ResourceSurfaceInput = z.input<typeof ResourceSurface>;
type ParsedResourceSurface = z.output<typeof ResourceSurface>;
export type ResourceSurface = Readonly<
  Omit<ParsedResourceSurface, "actions"> & {
    actions: readonly Readonly<ParsedResourceSurface["actions"][number]>[];
  }
>;

function requireUnique(label: string, values: readonly string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function routeParameters(route: string): readonly string[] {
  return [...route.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1] as string);
}

const confirmationStrength = { none: 0, required: 1, "high-risk": 2 } as const;

export function parseResourceSurfaces(input: unknown): readonly ResourceSurface[] {
  const surfaces = z.array(ResourceSurface).parse(input);
  requireUnique(
    "resource type",
    surfaces.map(({ resourceType }) => resourceType),
  );
  requireUnique(
    "list route",
    surfaces.map(({ listRoute }) => listRoute),
  );
  requireUnique(
    "detail route",
    surfaces.map(({ detailRoute }) => detailRoute),
  );

  for (const surface of surfaces) {
    if (surface.listRoute === surface.detailRoute) {
      throw new Error(`detail route must differ from list route: ${surface.resourceType}`);
    }
    const listParameters = routeParameters(surface.listRoute);
    const detailParameters = routeParameters(surface.detailRoute);
    if (
      surface.context === "organization" &&
      (!listParameters.includes("organizationId") || !detailParameters.includes("organizationId"))
    ) {
      throw new Error(
        `organization surface routes must contain :organizationId: ${surface.resourceType}`,
      );
    }
    if (
      surface.context === "personal" &&
      (listParameters.includes("organizationId") || detailParameters.includes("organizationId"))
    ) {
      throw new Error(`personal surface cannot contain :organizationId: ${surface.resourceType}`);
    }
    const hasObjectParameter =
      surface.context === "organization"
        ? detailParameters.some((parameter) => parameter !== "organizationId")
        : detailParameters.length > 0;
    if (!hasObjectParameter) {
      throw new Error(`detail route must contain an object parameter: ${surface.resourceType}`);
    }

    for (const capabilityId of [surface.listCapability, surface.readCapability]) {
      const capability = phase0Registry.get(capabilityId);
      if (capability === undefined || capability.sideEffect !== "none") {
        throw new Error(`resource read capability must be side-effect free: ${capabilityId}`);
      }
    }

    requireUnique(
      `action capability for ${surface.resourceType}`,
      surface.actions.map(({ capabilityId }) => capabilityId),
    );
    for (const action of surface.actions) {
      const capability = phase0Registry.get(action.capabilityId);
      if (capability === undefined || capability.sideEffect === "none") {
        throw new Error(`resource action must be mutating: ${action.capabilityId}`);
      }
      if (
        confirmationStrength[action.confirmation] < confirmationStrength[capability.confirmation]
      ) {
        throw new Error(`action confirmation is weaker than capability: ${action.capabilityId}`);
      }
    }
  }

  return Object.freeze(
    surfaces.map((surface) =>
      Object.freeze({
        ...surface,
        actions: Object.freeze(surface.actions.map((action) => Object.freeze(action))),
      }),
    ),
  );
}
