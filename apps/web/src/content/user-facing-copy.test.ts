import { describe, expect, test } from "vitest";

import { phase0Capabilities } from "@tashan/capabilities";

import { auditActionLabel, auditActorSourceLabel, pageCopy } from "./user-facing-copy.js";

describe("user-facing copy", () => {
  test("uses the approved direct page descriptions", () => {
    expect(pageCopy.organization.description).toBe("查看和创建组织");
    expect(pageCopy.members.description).toBe("查看和添加组织成员");
    expect(pageCopy.devices.description).toBe("查看和管理登录设备");
    expect(pageCopy.audit.description).toBe("查看组织操作记录");
    expect(pageCopy.comingSoon).toBe("此功能暂未开放");
  });

  test("gives every Phase 0 capability a human-readable audit label", () => {
    for (const capability of phase0Capabilities) {
      expect(auditActionLabel(capability.id)).not.toBe(capability.id);
    }
    expect(auditActionLabel("future.unknown")).toBe("future.unknown");
  });

  test("translates known actor sources without hiding unknown evidence", () => {
    expect(auditActorSourceLabel("web")).toBe("网页");
    expect(auditActorSourceLabel("cli")).toBe("CLI");
    expect(auditActorSourceLabel("ai_via_cli")).toBe("AI（通过 CLI）");
    expect(auditActorSourceLabel("system")).toBe("系统");
    expect(auditActorSourceLabel("future-source")).toBe("future-source");
  });
});
