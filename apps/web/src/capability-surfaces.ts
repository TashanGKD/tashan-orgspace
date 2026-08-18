import { CapabilitySurfaceList } from "@tashan/capabilities";

import rawSurfaces from "./capability-surfaces.json" with { type: "json" };

export const capabilitySurfaces = CapabilitySurfaceList.parse(rawSurfaces);
