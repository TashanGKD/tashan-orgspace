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
    "auth.verification.send",
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
  test("contains exactly the approved 86 unique IDs", () => {
    expect(phase0Capabilities.map(({ id }) => id).sort()).toEqual(
      [
        "system.health.read",
        "capability.list",
        "capability.describe",
        "auth.verification.send",
        "auth.password.reset",
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
        "space.list",
        "space.read",
        "space.usage.read",
        "space.quota.set",
        "file.list",
        "file.read",
        "file.search",
        "file.folder.create",
        "file.move",
        "file.trash",
        "file.restore",
        "file.delete",
        "file.download.create",
        "file.version.list",
        "file.version.restore",
        "file.upload.list",
        "file.upload.read",
        "file.upload.create",
        "file.upload.parts.create",
        "file.upload.complete",
        "file.upload.cancel",
        "folder.access.read",
        "folder.access.set",
        "folder.grant.set",
        "folder.grant.revoke",
        "folder.manager.recover",
        "work.item.list",
        "work.item.read",
        "work.item.create",
        "task.create",
        "meeting.create",
        "approval.create",
        "work.item.assign",
        "work.assignment.dispute",
        "work.assignment.transfer.request",
        "work.assignment.transfer.approve",
        "work.item.complete",
        "work.item.reopen",
        "work.item.cancel",
        "process.definition.create",
        "process.version.create",
        "process.version.publish",
        "process.instance.start",
        "process.instance.read",
        "process.instance.decide",
        "okr.objective.list",
        "okr.objective.read",
        "okr.objective.create",
        "okr.progress.update",
        "okr.change.request",
        "okr.change.approve",
        "okr.objective.edit.admin",
        "partner.list",
        "partner.read",
        "partner.create",
        "partner.update",
        "partner.archive",
        "partner.restore",
        "partner.transfer",
        "partner.bulk.transfer",
        "partner.duplicate.list",
        "partner.awaiting.owner.list",
        "partner.contact.read",
        "partner.interaction.list",
        "partner.interaction.add",
        "partner.interaction.correct",
        "partner.link.create",
        "partner.link.unlink",
        "partner.export",
      ].sort(),
    );
    expect(new Set(phase0Capabilities.map(({ id }) => id)).size).toBe(86);
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
