# Tashan OrgSpace Full Product Delivery Implementation Plan

<!-- DEFERRED_PRODUCT_SCOPE: general-compute,user-web-hosting -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete v1 OrgSpace product as a sequence of production-ready vertical slices, with every capability implemented consistently in backend, Web, CLI, Skill, audit, tests, and AUP deployment.

> 2026-08-29 program update: the executable source of truth is `2026-08-29-v1-program-execution-map.md` plus the Phase 1–5 plans. Phase 2 now includes the independent Phase 2D organization-partner directory.

**Architecture:** The control plane uses the common sequence `space → module → resource list → resource detail → action`. Specialized data planes remain separate for files and chat. Each phase ships one usable end-to-end slice and cannot be marked complete until API/Web/CLI/Skill capability coverage and isolation tests all pass.

**Tech Stack:** Node.js 24, TypeScript 6, Fastify, React 19, TanStack Query, PostgreSQL 17, Redis 8, S3-compatible object storage, Nginx, WebSocket, Alibaba Cloud SMS, pnpm, Vitest, Docker Compose, GitHub Actions.

---

## 1. Program rules

1. A phase is complete only when a real user can perform the capability through Web and CLI, and an AI can safely perform it by following the Skill.
2. Every mutation has an idempotency contract, confirmation level, audit action and negative authorization test.
3. Every module first exposes a list, then a stable deep-linked detail, then actions allowed by capability and current state.
4. Frontend components never decide final authorization; the server enforces account, device, space, organization and object state.
5. New modules extend shared contracts and surface registries; they do not copy identity, audit, notification or confirmation logic.
6. Each task below begins with an approved subsystem specification and a detailed TDD implementation plan. This master plan fixes order and cross-phase gates; it does not replace threat-specific subsystem designs.

## 2. Current baseline

The following are complete and form the starting point:

- Account registration/login, phone verification, password reset and device sessions.
- Organization creation, membership, roles and cross-organization rejection.
- Append-only audit and Outbox Worker.
- Web shell for login, organization, members, devices and audit.
- 17 Phase 0 capabilities with CLI/Web/Skill coverage gates.
- AUP alpha.3 production deployment and reliable public Skill/CLI distribution.
- Simulated-verification E2E for registration, organizations, device revocation, password reset and audit redaction.

### Task 1: Universal resource surface and workspace shell

**Files:**
- Create: `packages/capabilities/src/resource-surfaces.ts`
- Create: `apps/web/src/platform/resources/resource-list-page.tsx`
- Create: `apps/web/src/platform/resources/resource-detail-page.tsx`
- Create: `apps/web/src/platform/resources/resource-detail-drawer.tsx`
- Create: `apps/web/src/platform/resources/resource-action-bar.tsx`
- Create: `apps/web/src/platform/resources/resource-states.tsx`
- Create: `apps/web/src/platform/resources/resource-surfaces.test.tsx`
- Create: `apps/web/src/design-system/tokens.css`
- Create: `apps/web/src/design-system/primitives/`
- Create: `scripts/check-resource-surface-coverage.mjs`
- Create: `scripts/check-resource-surface-coverage.self-test.mjs`
- Modify: `apps/web/src/platform/shell/app-shell.tsx`
- Modify: `apps/web/src/product-modules.json`
- Modify: `scripts/verify-phase0.sh`

- [ ] **Step 1: Approve the resource surface contract**

Use this exact conceptual interface in the subsystem specification:

```ts
interface ResourceSurface {
  resourceType: string;
  context: "global" | "personal" | "organization";
  listRoute: string;
  detailRoute: string;
  listCapability: string;
  readCapability: string;
  actions: readonly { capabilityId: string; confirmation: "none" | "required" | "high-risk" }[];
}
```

- [ ] **Step 2: Write RED coverage and component-state tests**

Tests must reject duplicate routes, list-without-detail modules, actions lacking capabilities, organization routes without organization IDs, and missing loading/empty/error/forbidden/readonly/conflict states.

- [ ] **Step 3: Implement the shared shell and resource components**

Deliver T1 Calm Organization UI with a 216/64px explicit collapsible sidebar, mobile bottom navigation plus More sheet, space switching, desktop list/detail split, mobile nested navigation, global command entry, capability-driven actions and stable deep links without changing existing Phase 0 authorization. Use CSS tokens and independently authored primitives; do not copy the internal-license `dance-os` code or homepage-v2 legacy gradients.

- [ ] **Step 4: Wire the executable parity gate**

`check-resource-surface-coverage` compares server capabilities, Web surfaces, CLI bindings and Skill references. Its negative self-test removes a detail route and an action binding and must fail.

- [ ] **Step 5: Verify and release the foundation**

Run `bash scripts/verify-phase0.sh`, Web keyboard/accessibility tests and production-shaped smoke. Deploy only after the existing Phase 0 journeys remain green.

### Task 2: Personal and organization spaces, files and quotas

**Files:**
- Create: `apps/api/migrations/007_spaces_files.sql`
- Create: `packages/contracts/src/spaces.ts`
- Create: `packages/contracts/src/files.ts`
- Create: `apps/api/src/spaces/`
- Create: `apps/api/src/files/`
- Create: `apps/api/src/routes/space-routes.ts`
- Create: `apps/api/src/routes/file-routes.ts`
- Create: `apps/cli/src/commands/space.ts`
- Create: `apps/cli/src/commands/file.ts`
- Create: `apps/web/src/features/files/`
- Create: `skill/tashan-orgspace/references/files.md`
- Modify: `packages/capabilities/src/phase0-capabilities.json`
- Modify: `apps/web/src/product-modules.json`

- [x] **Step 1: Approve the space/file threat model**

Lock personal 50 GB default, personal 500 GB maximum entitlement, organization 500 GB quota, trash accounting, version behavior and storage reservation cleanup.

- [x] **Step 2: Write RED adversarial tests**

Cover `../`, absolute/encoded/Unicode traversal, symlink and prefix collision, cross-space object IDs, concurrent quota oversell, interrupted multipart upload, checksum mismatch, duplicate finalize and failed cleanup.

- [x] **Step 3: Implement backend and object-storage lifecycle**

Deliver `Space`, `FileEntry`, `FileVersion`, `UploadSession`, `StorageReservation` and `TrashEntry`, with server-generated object keys and transactions around reservation/finalization.

- [x] **Step 4: Implement Web list/detail and CLI/Skill parity**

Web delivers tree/list, file detail, preview, versions, upload, download and trash. CLI delivers `space list/get/usage` and `file list/get/upload/download/versions/trash/restore/delete` with JSON output and explicit destructive confirmation.

- [x] **Step 5: Run full simulated-user acceptance**

Create two users and two organizations; prove personal privacy, organization access, quota read-only transition, upload recovery, file version recovery and cross-organization rejection.

### Task 3: WorkItem, Assignment and process kernel

**Files:**
- Create: `apps/api/migrations/009_collaboration_kernel.sql`
- Create: `apps/api/migrations/010_work_items.sql`
- Create: `apps/api/migrations/011_processes.sql`
- Create: `packages/contracts/src/work.ts`
- Create: `apps/api/src/work/`
- Create: `apps/api/src/routes/work-routes.ts`
- Create: `apps/cli/src/commands/work.ts`
- Create: `apps/web/src/features/work/`
- Create: `skill/tashan-orgspace/references/work.md`

- [ ] **Step 1: Approve WorkItem and ProcessDefinition state machines**

Fix task, meeting, approval and change-request types; assignment, dispute, transfer, completion, reopen, withdraw, approve, reject and return transitions; published process versions are immutable.

- [ ] **Step 2: Write RED permission and concurrency tests**

Prove organization-wide task visibility, self/admin edit rules, immediate assignment, dispute without removing responsibility, transfer approval, stale-version conflict and restricted-item visibility.

- [ ] **Step 3: Implement backend state/event model**

Use immutable transition events and optimistic versions. Personal inbox, organization list, approval inbox and calendar remain projections of the same facts.

- [ ] **Step 4: Implement unified Work Web and CLI**

Web uses tabs backed by shared list/detail components. CLI delivers `task`, `meeting`, `approval` and generic `process` list/get/create/action commands. Skill documents state-sensitive actions and confirmations.

- [ ] **Step 5: Verify complete organization-work journeys**

Simulate creator, assignee, administrator and uninvolved member across create, assign, dispute, transfer, complete, approve, reject and audit history.

### Task 4: OKR on the work kernel

**Files:**
- Create: `apps/api/migrations/012_okr.sql`
- Create: `packages/contracts/src/okr.ts`
- Create: `apps/api/src/okr/`
- Create: `apps/api/src/routes/okr-routes.ts`
- Create: `apps/cli/src/commands/okr.ts`
- Create: `apps/web/src/features/okr/`
- Create: `skill/tashan-orgspace/references/okr.md`

- [ ] **Step 1: Approve Objective/KR/version semantics**

Fix organization and member ownership, numeric/linked-task/manual formulas, cycle and weight constraints, immediate progress updates and administrator-approved substantive changes.

- [ ] **Step 2: Write RED formula, history and authorization tests**

Reject invalid weights, cross-organization links, historical recomputation, member direct substantive edit and stale change approval.

- [ ] **Step 3: Implement OKR backend and change requests**

Store formula version and input snapshot for every calculated progress event. Substantive edits create WorkItem change requests; administrator direct edits create equivalent audit events.

- [ ] **Step 4: Implement OKR lists/details across surfaces**

Web delivers organization/member views and Objective/KR detail. CLI delivers `okr list/get/create/progress/change-request/approve`. Skill explains which updates are immediate and which require approval.

- [ ] **Step 5: Verify organization-wide visibility and edit boundaries**

Simulate three members and one administrator; prove everyone can read, only self/admin can propose, and only authorized approval changes substantive fields.

### Task 5: Notification, reminders and Alibaba Cloud SMS

**Files:**
- Create: `apps/api/migrations/014_notifications.sql`
- Create: `packages/contracts/src/notifications.ts`
- Create: `apps/api/src/notifications/`
- Create: `apps/worker/src/handlers/notification-handler.ts`
- Create: `apps/cli/src/commands/notification.ts`
- Create: `apps/web/src/features/notifications/`
- Create: `skill/tashan-orgspace/references/notifications.md`

- [ ] **Step 1: Approve the event-to-channel matrix**

Fix immediate approval/emergency SMS, optional ordinary-task SMS, mandatory one-hour DDL/meeting reminders and cancellable-only daily summary.

- [ ] **Step 2: Write RED idempotency, time and privacy tests**

Cover timezone/DST, duplicate scheduler ticks, accepted-versus-delivered status, timeout query-before-retry, rate limits, phone masking and forbidden preference changes.

- [ ] **Step 3: Implement notification ledger and worker**

Business transactions write Outbox events. Worker resolves verified phones, approved templates and idempotency keys, then records RequestId/BizId and delivery polling states.

- [ ] **Step 4: Implement inbox, preferences and CLI/Skill**

Web provides notification list/detail and daily-summary toggle. CLI provides `notification list/get/preferences` and explicit ordinary-task send action. Skill forbids inventing delivery success from gateway acceptance.

- [ ] **Step 5: Verify with simulated SMS before one real carrier smoke**

All flows use the deterministic sender. One separately confirmed real SMS proves gateway/carrier behavior; no full regression depends on real phones.

### Deferred directions: compute execution and user web deployment

The navigation retains four inert `coming_soon` modules. This plan does not create runtime, build, service, database, daemon, domain or public-access contracts, migrations, APIs, CLI commands, Skill references or acceptance journeys. Re-entry requires a newly approved design and plan.

### Task 6: Organization chat and resource references

**Files:**
- Create: `apps/api/migrations/015_chat.sql`
- Create: `packages/contracts/src/chat.ts`
- Create: `apps/api/src/chat/`
- Create: `apps/api/src/routes/chat-routes.ts`
- Create: `apps/cli/src/commands/chat.ts`
- Create: `apps/web/src/features/chat/`
- Create: `skill/tashan-orgspace/references/chat.md`

- [ ] **Step 1: Approve conversation, retention and compliance rules**

Fix organization groups, direct-chat common-organization gate, membership, server sequence, edit/retract events, read state, search, resource references and high-risk compliance reads.

- [ ] **Step 2: Write RED ordering and authorization tests**

Cover duplicate client IDs, missing WebSocket events, cursor gap repair, cross-organization direct chat, nonmember group access, withdrawn-message search and unauthorized resource reference.

- [ ] **Step 3: Implement HTTP history plus WebSocket delivery**

HTTP is history truth; WebSocket distributes events. Server assigns conversation sequence and preserves edit/retract events.

- [ ] **Step 4: Implement conversation list/detail and CLI/Skill**

Web uses conversation list and message detail timeline. CLI provides `chat conversation list/get/create`, `chat message list/send/reply/retract`, with streaming as an optional output mode.

- [ ] **Step 5: Verify message-to-work conversion**

Convert messages into tasks, approvals, meetings and file entries; preserve bidirectional links and original permission boundaries after message withdrawal.

### Task 7: Global work, search, administration and command palette

**Files:**
- Create: `packages/contracts/src/search.ts`
- Create: `apps/api/src/search/`
- Create: `apps/api/src/routes/search-routes.ts`
- Create: `apps/cli/src/commands/search.ts`
- Create: `apps/web/src/features/my-work/`
- Create: `apps/web/src/features/search/`
- Create: `apps/web/src/features/admin/`
- Create: `apps/web/src/platform/commands/command-palette.tsx`

- [ ] **Step 1: Approve projection and search authorization**

Global views may aggregate authorized objects but never copy them or cache results beyond membership changes. Search indexes preserve space and restricted-object ACLs.

- [ ] **Step 2: Write RED stale-membership and inference tests**

Prove removed users cannot retrieve cached search hits, counts do not reveal restricted objects, command actions require current capability and personal files never enter organization administration.

- [ ] **Step 3: Implement global projections and typed search**

Deliver my-work, notifications, search groups and command suggestions using stable object IDs and deep links.

- [ ] **Step 4: Implement member/quota/policy administration**

Web and CLI cover roles, quotas, notification policy, process templates and audit views with organization owner/admin restrictions.

- [ ] **Step 5: Verify global-to-space navigation**

Open aggregated items, switch organization context, handle lost membership and return to the exact list view without leaking object content.

### Task 8: AI-ready actor model, parity closure and v1 release

**Files:**
- Modify: `packages/contracts/src/`
- Modify: `packages/capabilities/src/`
- Modify: `apps/web/src/product-modules.json`
- Modify: `apps/cli/src/capability-bindings.json`
- Modify: `skill/tashan-orgspace/capability-references.json`
- Create: `scripts/check-full-product-coverage.mjs`
- Create: `scripts/check-full-product-coverage.self-test.mjs`
- Create: `docs/verification/v1-full-product-acceptance.md`

- [ ] **Step 1: Verify actor-type extensibility without enabling AI employees**

Human/system actors remain active. Contracts, member chips, assignments, messages and audit accept future `ai_employee` schema evolution without granting it permissions or rendering fake employees.

- [ ] **Step 2: Close all API/Web/CLI/Skill coverage gaps**

The full-product gate compares every capability, list/detail route, CLI binding, Skill reference, permission test, audit action and deferred declaration. Negative self-test removes one surface at a time and must fail.

- [ ] **Step 3: Run complete synthetic organization acceptance**

Create multiple test users and organizations with simulated verification codes. Exercise files, work, OKR, notifications, chat, device/session revocation and cross-organization rejection.

- [ ] **Step 4: Run production recovery, security and real-channel smokes**

Verify AUP backups, restore drill, tunnel recovery, storage integrity and one real SMS. Record gateway acceptance and end delivery separately.

- [ ] **Step 5: Publish v1 only after every gate is current**

Tag the exact deployed commit, publish Skill/CLI assets, run fresh no-source users on supported platforms and record the final capability count. No task is closed based only on unit tests or documentation.

## 3. Release train

```text
Phase 0  已上线：身份 / 组织 / 设备 / 审计 / 公网安装
Phase 1  通用工作台 + 空间/文件
Phase 2  WorkItem / 审批 / 会议 / OKR / 合作方
Phase 3  通知 / 短信 / 定时提醒
Phase 4  对话 / 搜索 / 全局工作 / 管理
Phase 5  全面一致性 / 恢复 / 安全 / v1 验收

Deferred  计算 / 构建 / 用户网站 / 服务 / 数据库 / daemon / 用户域名
```

每个 Phase 必须形成独立 PR、部署和验收证据。后续 Phase 可以复用前一阶段公共组件，但不能在前一阶段安全边界未通过时并行上线。
