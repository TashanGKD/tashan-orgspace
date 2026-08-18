import { describe, expect, test } from "vitest";

import { phase0Capabilities } from "./phase0.js";
import { buildRegistry } from "./registry.js";

const base = {
  version: 1,
  inputSchema: "Empty",
  outputSchema: "Empty",
  permissions: [],
  sideEffect: "none",
  idempotent: true,
  confirmation: "none",
  cli: "health",
  web: "deferred",
  auditAction: "system.health.read",
} as const;

describe("capability registry invariants", () => {
  test("rejects duplicate IDs", () => {
    expect(() =>
      buildRegistry([
        { ...base, id: "system.health.read" },
        { ...base, id: "system.health.read" },
      ]),
    ).toThrow(/duplicate capability ID/);
  });

  test.each([
    "device.revoke",
    "organization.create",
    "organization.member.add",
    "auth.phone.start",
  ])("rejects mutating capability %s marked side-effect free", (id) => {
    expect(() => buildRegistry([{ ...base, id }])).toThrow(/mutation metadata/);
  });

  test("rejects confirmation on a side-effect-free capability", () => {
    expect(() => buildRegistry([{ ...base, id: "audit.list", confirmation: "required" }])).toThrow(
      /confirmation metadata/,
    );
  });

  test.each(["System.health.read", "health", "system..read", "system.health.read!"])(
    "rejects malformed capability ID %s",
    (id) => {
      expect(() => buildRegistry([{ ...base, id }])).toThrow();
    },
  );
});

describe("Phase 0 capability source", () => {
  test("contains exactly the approved 17 unique IDs", () => {
    expect(phase0Capabilities.map(({ id }) => id).sort()).toEqual(
      [
        "system.health.read",
        "capability.list",
        "capability.describe",
        "auth.phone.start",
        "auth.phone.confirm",
        "auth.register",
        "auth.login",
        "auth.refresh",
        "auth.logout",
        "auth.whoami",
        "device.list",
        "device.revoke",
        "organization.list",
        "organization.create",
        "organization.member.list",
        "organization.member.add",
        "audit.list",
      ].sort(),
    );
    expect(new Set(phase0Capabilities.map(({ id }) => id)).size).toBe(17);
  });

  test("keeps revocation and organization writes explicitly guarded", () => {
    const byId = new Map(phase0Capabilities.map((capability) => [capability.id, capability]));

    expect(byId.get("device.revoke")).toMatchObject({
      sideEffect: "revoke",
      confirmation: "required",
    });
    expect(byId.get("organization.create")).toMatchObject({
      sideEffect: "write",
      idempotent: true,
      confirmation: "required",
    });
    expect(byId.get("organization.member.add")).toMatchObject({
      sideEffect: "write",
      idempotent: true,
      confirmation: "required",
    });
  });
});
