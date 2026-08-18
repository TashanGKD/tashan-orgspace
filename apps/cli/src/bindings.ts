import { CapabilityBindings } from "@tashan/capabilities";

import rawBindings from "./capability-bindings.json" with { type: "json" };

export const capabilityBindings = CapabilityBindings.parse(rawBindings);
