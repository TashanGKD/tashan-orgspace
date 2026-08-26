import { CapabilityBindings } from "@tashan/capabilities";

import rawAuditLabels from "./audit-action-labels.json" with { type: "json" };

const auditLabels = CapabilityBindings.parse(rawAuditLabels);

export const pageCopy = Object.freeze({
  login: {
    heading: "他山组织空间",
    description: "登录后查看你加入的组织",
    principles: ["手机号登录", "管理登录设备", "加入多个组织"],
  },
  organization: { description: "查看和创建组织" },
  members: { description: "查看和添加组织成员" },
  devices: {
    description: "查看和管理登录设备",
    revokeConsequence: "撤销后，这台设备需要重新登录。",
  },
  audit: { description: "查看组织操作记录" },
  comingSoon: "此功能暂未开放",
  forbiddenOrganization: "你没有权限查看此组织",
  forbiddenPage: "你没有权限查看此页面",
} as const);

const actorSourceLabels: Readonly<Record<string, string>> = Object.freeze({
  web: "网页",
  cli: "CLI",
  ai_via_cli: "AI（通过 CLI）",
  system: "系统",
});

export function auditActionLabel(capabilityId: string): string {
  return auditLabels[capabilityId as keyof typeof auditLabels] ?? capabilityId;
}

export function auditActorSourceLabel(source: string): string {
  return actorSourceLabels[source] ?? source;
}
