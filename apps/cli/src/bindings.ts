import { CapabilityBindings } from "@tashan/capabilities";

import rawBindings from "./capability-bindings.json" with { type: "json" };

const parsedBindings = CapabilityBindings.safeParse(rawBindings);
if (!parsedBindings.success) {
  const missingBinding = parsedBindings.error.issues.find(
    (issue) => issue.code === "invalid_type" && issue.path.length === 1,
  );
  if (missingBinding !== undefined) {
    throw new Error(`missing CLI binding: ${String(missingBinding.path[0])}`);
  }
  throw parsedBindings.error;
}

export const capabilityBindings = parsedBindings.data;
