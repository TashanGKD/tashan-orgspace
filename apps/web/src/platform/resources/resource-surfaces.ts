import { parseResourceSurfaces } from "@tashan/capabilities";

import rawSurfaces from "../../resource-surfaces.json" with { type: "json" };

export const resourceSurfaces = parseResourceSurfaces(rawSurfaces);

export function resourceSurface(resourceType: string) {
  const surface = resourceSurfaces.find((candidate) => candidate.resourceType === resourceType);
  if (surface === undefined) throw new Error(`unknown resource surface: ${resourceType}`);
  return surface;
}
