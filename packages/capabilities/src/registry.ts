import { Capability } from "./schema.js";

const MUTATING_TERMINALS = new Set([
  "add",
  "confirm",
  "create",
  "login",
  "logout",
  "refresh",
  "register",
  "revoke",
  "start",
]);

export function buildRegistry(inputs: readonly unknown[]): ReadonlyMap<string, Capability> {
  const registry = new Map<string, Capability>();

  for (const input of inputs) {
    const capability = Capability.parse(input);
    if (registry.has(capability.id)) {
      throw new Error(`duplicate capability ID: ${capability.id}`);
    }

    const terminal = capability.id.split(".").at(-1);
    if (
      terminal !== undefined &&
      MUTATING_TERMINALS.has(terminal) &&
      capability.sideEffect === "none"
    ) {
      throw new Error(`invalid mutation metadata for ${capability.id}`);
    }
    if (capability.sideEffect === "none" && capability.confirmation !== "none") {
      throw new Error(`invalid confirmation metadata for ${capability.id}`);
    }
    if (capability.sideEffect === "revoke" && capability.confirmation !== "required") {
      throw new Error(`revocation capability requires confirmation: ${capability.id}`);
    }

    registry.set(capability.id, Object.freeze(capability));
  }

  return registry;
}
