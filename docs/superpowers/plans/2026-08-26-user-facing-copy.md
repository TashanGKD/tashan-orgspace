# OrgSpace User-facing Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace architecture-oriented Web copy with short, task-oriented language and keep human-readable audit labels complete as the capability registry evolves.

**Architecture:** Add one Web copy module for core page descriptions, source audit labels from a validated JSON registry, and consume those values from the existing pages. A repository gate scans production UI sources for prohibited internal phrases and checks that every Phase 0 capability has a human-readable audit label.

**Tech Stack:** React 19, TypeScript 6, Zod 4, Vitest, Testing Library, Node.js gate scripts, existing Phase 0 verifier.

---

## File structure

- Create `apps/web/src/content/audit-action-labels.json`: capability ID to human action name.
- Create `apps/web/src/content/user-facing-copy.ts`: validated audit lookup, actor-source lookup and core page copy.
- Create `apps/web/src/content/user-facing-copy.test.ts`: exact copy and registry-coverage tests.
- Modify page components only where text or list metadata changes; API, SDK, CLI and Skill contracts remain unchanged.
- Create `scripts/check-user-facing-copy.mjs` and `scripts/check-user-facing-copy.self-test.mjs`: drift gate and real negative cases.
- Create `docs/verification/user-facing-copy.md`: automated and browser evidence.

### Task 1: Establish the user-facing copy source of truth

**Files:**
- Create: `apps/web/src/content/audit-action-labels.json`
- Create: `apps/web/src/content/user-facing-copy.ts`
- Create: `apps/web/src/content/user-facing-copy.test.ts`

- [x] **Step 1: Write the failing copy-contract test**

Create `apps/web/src/content/user-facing-copy.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { phase0Capabilities } from "@tashan/capabilities";

import {
  auditActionLabel,
  auditActorSourceLabel,
  pageCopy,
} from "./user-facing-copy.js";

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
```

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @tashan/web test -- user-facing-copy.test.ts
```

Expected: FAIL because `user-facing-copy.ts` does not exist.

- [x] **Step 3: Add the complete audit label registry**

Create `apps/web/src/content/audit-action-labels.json` with all 17 existing IDs:

```json
{
  "system.health.read": "系统健康检查",
  "capability.list": "查看可用功能",
  "capability.describe": "查看功能说明",
  "auth.verification.send": "发送验证码",
  "auth.password.reset": "重置密码",
  "auth.register": "创建账号",
  "auth.login": "登录",
  "auth.refresh": "更新登录状态",
  "auth.logout": "退出登录",
  "auth.whoami": "查看当前账号",
  "device.list": "查看登录设备",
  "device.revoke": "撤销设备",
  "organization.list": "查看组织",
  "organization.create": "创建组织",
  "organization.member.list": "查看组织成员",
  "organization.member.add": "添加组织成员",
  "audit.list": "查看操作记录"
}
```

- [x] **Step 4: Implement the copy module**

Create `apps/web/src/content/user-facing-copy.ts`:

```ts
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
```

- [x] **Step 5: Run GREEN and commit**

Run:

```bash
pnpm --filter @tashan/web test -- user-facing-copy.test.ts
pnpm --filter @tashan/web typecheck
```

Expected: the copy tests and typecheck pass.

Commit:

```bash
git add apps/web/src/content
git commit -m "feat(web): add user-facing copy registry"
```

### Task 2: Rewrite login and unavailable-feature copy

**Files:**
- Modify: `apps/web/src/auth/access-panel.tsx`
- Modify: `apps/web/src/auth/access-panel.test.tsx`
- Modify: `apps/web/src/features/roadmap/coming-soon-page.tsx`
- Modify: `apps/web/src/platform/shell/app-shell.test.tsx`
- Modify: `apps/web/src/product-modules.json`

- [x] **Step 1: Write RED assertions for direct login and roadmap text**

Add to `access-panel.test.tsx`:

```ts
expect(screen.getByRole("heading", { name: "他山组织空间" })).toBeVisible();
expect(screen.getByText("登录后查看你加入的组织")).toBeVisible();
expect(screen.getByText("手机号登录")).toBeVisible();
expect(screen.queryByText(/真实人员|组织边界/)).not.toBeInTheDocument();
```

Update the coming-soon assertion in `app-shell.test.tsx`:

```ts
expect(screen.getByText("此功能暂未开放")).toBeVisible();
expect(screen.queryByText(/产品边界|服务器操作/)).not.toBeInTheDocument();
```

- [x] **Step 2: Run targeted tests and verify RED**

Run:

```bash
pnpm --filter @tashan/web test -- access-panel.test.tsx app-shell.test.tsx
```

Expected: FAIL on the old architecture-oriented strings.

- [x] **Step 3: Replace login copy from the approved source**

Import `pageCopy` in `access-panel.tsx`. Set the main heading and description from `pageCopy.login`; render the three principle rows from `pageCopy.login.principles`. Change mode notes to:

```ts
const modeCopy = {
  login: { title: "登录", note: "使用手机号和密码登录" },
  register: { title: "创建账号", note: "使用手机号创建账号" },
  password_reset: { title: "重置密码", note: "重置后，其他设备需要重新登录" },
} as const;
```

Remove `TASHAN · ORGANIZATION OS`, `成员入口 / MEMBER ACCESS`, and the architecture manifesto from visible content.

- [x] **Step 4: Replace roadmap copy and simplify module descriptions**

In `coming-soon-page.tsx`, remove `PRODUCT ROADMAP` and the system explanation. Render only the module name, `即将上线`, its direct description, `pageCopy.comingSoon`, and the return link.

Rewrite the non-direct entries in `product-modules.json`:

```json
{
  "global.my-work": "查看分配给你的任务、审批、会议和消息",
  "personal.overview": "查看个人文件、运行资源、服务和用量",
  "organization.home": "查看组织成员和各项工作",
  "organization.policies": "设置组织额度、通知、短信和审批流程"
}
```

Keep the existing IDs, routes, roles and capability arrays unchanged.

- [x] **Step 5: Run GREEN and commit**

Run the two targeted test files, then commit:

```bash
git add apps/web/src/auth apps/web/src/features/roadmap apps/web/src/platform/shell/app-shell.test.tsx apps/web/src/product-modules.json
git commit -m "feat(web): simplify access and roadmap copy"
```

### Task 3: Rewrite organization, member and device surfaces

**Files:**
- Modify: `apps/web/src/features/organization/home-page.tsx`
- Modify: `apps/web/src/features/organization/home-page.test.tsx`
- Modify: `apps/web/src/features/organization/members-page.tsx`
- Modify: `apps/web/src/features/organization/members-page.test.tsx`
- Modify: `apps/web/src/features/account/account-page.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/platform/shell/app-shell.tsx`
- Modify: `apps/web/src/platform/context/organization-context.tsx`

- [x] **Step 1: Write RED tests for direct descriptions and list density**

Add assertions:

```ts
expect(screen.getByText("查看和创建组织")).toBeVisible();
expect(screen.queryByText(organizationId)).not.toBeInTheDocument();

expect(screen.getByText("查看和添加组织成员")).toBeVisible();
expect(screen.queryByText(accountId)).not.toBeInTheDocument();

expect(screen.getByText("查看和管理登录设备")).toBeVisible();
expect(screen.queryByText("0.1.0-alpha.3")).not.toBeInTheDocument();
```

The member and organization detail tests must continue to assert that IDs remain available after opening details.

- [x] **Step 2: Run targeted tests and verify RED**

Run:

```bash
pnpm --filter @tashan/web test -- home-page.test.tsx members-page.test.tsx app.test.tsx
```

Expected: FAIL on old descriptions and UUID metadata.

- [x] **Step 3: Use direct page copy and remove technical list metadata**

Import `pageCopy` in the three pages. Apply:

```tsx
description={pageCopy.organization.description}
description={pageCopy.members.description}
description={pageCopy.devices.description}
```

Change ordinary row metadata to:

```tsx
// Organization row: no metadata.
metadata={[]}

// Member row: role only.
metadata={[roleLabels[membership.role]]}

// Device row: operating system and last active time.
metadata={[device.os, device.lastSeenAt]}
```

Keep account ID, architecture and client version in their existing detail pages.

- [x] **Step 4: Simplify permission and revoke messages**

Use `pageCopy.forbiddenOrganization` in `app-shell.tsx`, `pageCopy.forbiddenPage` in `organization-context.tsx`, and `pageCopy.devices.revokeConsequence` in the revoke dialog. Keep the dialog title and actions unchanged.

- [x] **Step 5: Run GREEN and commit**

Run the targeted tests plus Web typecheck, then commit:

```bash
git add apps/web/src/features/organization apps/web/src/features/account apps/web/src/platform/shell/app-shell.tsx apps/web/src/platform/context/organization-context.tsx apps/web/src/app.test.tsx
git commit -m "feat(web): simplify organization and device copy"
```

### Task 4: Present audit events in user language

**Files:**
- Modify: `apps/web/src/features/audit/audit-page.tsx`
- Modify: `apps/web/src/features/audit/audit-page.test.tsx`

- [ ] **Step 1: Write RED audit-language tests**

For an event with `capabilityId: "organization.member.add"` and `actorSource: "web"`, assert:

```ts
expect(await screen.findByRole("link", { name: /添加组织成员.*成功/ })).toBeVisible();
expect(screen.getByText("网页")).toBeVisible();
expect(screen.queryByText(requestId)).not.toBeInTheDocument();
```

After opening the detail route, assert:

```ts
expect(await screen.findByRole("heading", { name: "添加组织成员" })).toBeVisible();
expect(screen.getByText("organization.member.add")).toBeVisible();
expect(screen.getByText(requestId)).toBeVisible();
```

- [ ] **Step 2: Run the audit test and verify RED**

Run:

```bash
pnpm --filter @tashan/web test -- audit-page.test.tsx
```

Expected: FAIL because the capability ID and actor source are still displayed raw.

- [ ] **Step 3: Apply audit action and source labels**

Import `auditActionLabel`, `auditActorSourceLabel`, and `pageCopy`. Use the human action for list-row and detail titles. Use the translated actor source in list metadata and details. Keep the raw capability ID in detail under `操作 ID`.

Set list metadata to:

```tsx
metadata={[auditActorSourceLabel(event.actorSource), event.occurredAt]}
```

Update search filtering so a query matches the human action label as well as the raw capability ID and request ID.

- [ ] **Step 4: Remove explanatory audit prose**

Use `pageCopy.audit.description`. Change the detail eyebrow to `操作详情`. Replace the redaction paragraph with `部分敏感信息已隐藏` and keep request ID, object ID, IP and device fields in details.

- [ ] **Step 5: Run GREEN and commit**

Run the audit tests and Web typecheck, then commit:

```bash
git add apps/web/src/features/audit
git commit -m "feat(web): humanize audit event labels"
```

### Task 5: Add the user-copy drift gate

**Files:**
- Create: `scripts/check-user-facing-copy.mjs`
- Create: `scripts/check-user-facing-copy.self-test.mjs`
- Modify: `scripts/verify-phase0.sh`

- [ ] **Step 1: Write the gate with explicit prohibited phrases**

Export `checkUserFacingCopy({ capabilities, auditLabels, sources })`. It must reject:

```js
const prohibited = [
  "资源视图",
  "产品边界",
  "Phase 0",
  "执行任何服务器操作",
  "真实人员，唯一身份",
  "组织边界，默认私密",
  "以你的真实身份",
];
```

It must also compare the sorted capability IDs with the sorted keys of `audit-action-labels.json`, reject a label equal to its capability ID, and return `{ capabilities: 17, violations: 0 }` on the repository.

Repository source discovery must scan production `.tsx` files and `product-modules.json`, exclude `*.test.*`, and refuse symlinked source files.

- [ ] **Step 2: Write three real negative self-tests**

Create `check-user-facing-copy.self-test.mjs` with:

```js
assert.throws(
  () => checkUserFacingCopy({ ...valid, sources: [{ path: "page.tsx", text: "统一资源视图" }] }),
  /prohibited user-facing phrase: 资源视图/,
);

const missing = structuredClone(valid);
delete missing.auditLabels["organization.member.add"];
assert.throws(() => checkUserFacingCopy(missing), /missing audit label/);

const raw = structuredClone(valid);
raw.auditLabels["organization.member.add"] = "organization.member.add";
assert.throws(() => checkUserFacingCopy(raw), /audit label must be human-readable/);
```

- [ ] **Step 3: Run the gate and self-test**

Run:

```bash
node scripts/check-user-facing-copy.self-test.mjs
node scripts/check-user-facing-copy.mjs
node scripts/check-gate-self-tests.mjs
```

Expected: the negative self-test passes and gate count increases from 14 to 15.

- [ ] **Step 4: Wire the gate into the full verifier**

Add before `check-production-contract` in `verify-phase0.sh`:

```bash
run_step "node scripts/check-user-facing-copy.mjs" node scripts/check-user-facing-copy.mjs
run_step "node scripts/check-user-facing-copy.self-test.mjs" node scripts/check-user-facing-copy.self-test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add scripts/check-user-facing-copy* scripts/verify-phase0.sh
git commit -m "ci(web): enforce user-facing copy"
```

### Task 6: Full verification and browser acceptance

**Files:**
- Create: `docs/verification/user-facing-copy.md`
- Modify: `docs/superpowers/plans/2026-08-26-user-facing-copy.md`

- [ ] **Step 1: Run all automated verification**

Run:

```bash
pnpm --filter @tashan/web test
pnpm --filter @tashan/web typecheck
pnpm --filter @tashan/web build
ORGSPACE_TEST_CLEANUP_VOLUMES=1 bash scripts/verify-phase0.sh
```

Record Web test counts, 15-gate coverage, production-stack and E2E results separately.

- [ ] **Step 2: Run real browser journeys**

Using the isolated local production stack, verify at 1440px and 390px:

- login shows `他山组织空间` and no architecture manifesto;
- organization, member, device and audit pages show the approved descriptions;
- ordinary list rows do not display UUIDs or request IDs;
- member and audit details retain required technical evidence;
- audit search finds `添加组织成员`;
- revoke dialog explains that the device must log in again;
- coming-soon page says only `此功能暂未开放` in addition to its direct module description.

- [ ] **Step 3: Scan rendered and source text**

Run the copy gate, then use browser DOM snapshots to confirm none of the prohibited phrases appear in rendered pages. Do not treat source scanning alone as visual or browser acceptance.

- [ ] **Step 4: Capture and inspect screenshots**

Capture organization home, member list, audit list and mobile organization home. Inspect line wrapping, empty metadata gaps, heading hierarchy and whether shorter copy leaves awkward blank space.

- [ ] **Step 5: Write evidence and commit**

Write `docs/verification/user-facing-copy.md` with the exact commit, automated commands, browser journeys, screenshot paths and any remaining wording debt. Mark all completed plan checkboxes and commit:

```bash
git add docs/verification/user-facing-copy.md docs/superpowers/plans/2026-08-26-user-facing-copy.md
git commit -m "docs(verification): record user-copy acceptance"
```
