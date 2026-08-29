# Phase 2 Work, Process and OKR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the shared collaboration kernel, tasks, meetings, approvals and OKR with one organization-scoped event and permission model.

**Architecture:** Domain tables remain separate but reuse ResourceLink, Comment, ActivityEvent and DomainEvent/Outbox. All transitions are optimistic-versioned, idempotent and audited; Web/CLI/Skill bind the same capabilities.

**Tech Stack:** TypeScript 6, Fastify 5, Zod 4, PostgreSQL 17, React 19, Commander 15, Vitest.

---

### Task 1: Shared event, relation and activity kernel

**Files:** Create `apps/api/migrations/009_collaboration_kernel.sql`, `packages/contracts/src/collaboration.ts`, `apps/api/src/collaboration/`, `apps/api/test/collaboration/kernel.integration.test.ts`; modify contract exports.

- [x] Write RED tests for cross-organization links, duplicate links, immutable DomainEvent, comment authorization and same-transaction Outbox.
- [x] Run `pnpm --filter @tashan/api test:integration`; expect missing tables/types.
- [x] Implement `ResourceRef`, `ResourceLink`, `Comment`, `ActivityEvent`, `DomainEvent` and repositories; require organization equality and stable schema versions.
- [x] Run contracts/API tests and `pnpm typecheck`; expect green.
- [x] Commit: `git commit -m "feat(collaboration): add shared event kernel"`.

### Task 2: WorkItem and Assignment state machines

**Files:** Create `apps/api/migrations/010_work_items.sql`, `packages/contracts/src/work.ts`, `apps/api/src/work/work-service.ts`, `apps/api/src/work/work-state.ts`, `apps/api/test/work/work-service.integration.test.ts`.

- [x] Write RED transition tables covering create/assign/dispute/transfer/complete/reopen/cancel, stale expectedVersion and removed Membership.
- [x] Run the targeted integration test; expect WorkService missing.
- [x] Implement WorkItem/Assignment/Event tables and one `transitionWorkItem` function; immediate assignment retains responsibility during dispute.
- [x] Run targeted and full API tests; assert one DomainEvent/Outbox event per accepted transition.
- [x] Commit: `git commit -m "feat(work): add assignments and transitions"`.

### Task 3: Versioned process engine and approvals

**Files:** Create `apps/api/migrations/011_processes.sql`, `packages/contracts/src/process.ts`, `apps/api/src/process/`, `apps/api/test/process/process-service.integration.test.ts`.

- [x] Write RED tests for immutable published versions, single/sequence/any/all approval, return, withdraw, transfer and concurrent decisions.
- [x] Run targeted tests; expect ProcessDefinition/Instance missing.
- [x] Implement definitions, versions, instances, steps and decision events; pin each instance to one published version.
- [x] Run tests and prove duplicate approval changes state once.
- [x] Commit: `git commit -m "feat(process): add versioned approval engine"`.

### Task 4: Task, meeting and approval API/SDK/CLI

**Files:** Create `apps/api/src/routes/work-routes.ts`, `packages/sdk/src/work.ts`, `apps/cli/src/commands/work.ts`; modify app mount, capability registry and CLI bindings.

- [x] Write RED route/SDK/CLI tests for list/get/create/action, stable errors, explicit `--org`, confirmation and JSON output.
- [x] Run API/SDK/CLI tests; expect missing capabilities and commands.
- [x] Register and implement capabilities for task, meeting, approval, assignment dispute/transfer and process decisions.
- [x] Run parity gates and targeted tests; remove any server capability without CLI binding.
- [x] Commit: `git commit -m "feat(cli): expose organization work commands"`.

### Task 5: OKR formulas and change approval

**Files:** Create `apps/api/migrations/012_okr.sql`, `packages/contracts/src/okr.ts`, `apps/api/src/okr/`, `apps/api/src/routes/okr-routes.ts`, tests under `apps/api/test/okr/`.

- [x] Write RED tests for numeric/linked_tasks/manual, invalid weights, cross-org task link, historical snapshots, immediate progress and forbidden direct substantive edit.
- [x] Run targeted tests; expect OKR service missing.
- [x] Implement Objective/KR/formula snapshots; route substantive edits through `okr_change_request` WorkItem and approval.
- [x] Run integration tests including stale approval and administrator direct-edit audit equivalence.
- [x] Commit: `git commit -m "feat(okr): add approved objective changes"`.

### Task 6: Phase 2 Web, Skill and acceptance

**Files:** Create `apps/web/src/features/work/`, `apps/web/src/features/okr/`, `skill/tashan-orgspace/references/work.md`, `skill/tashan-orgspace/references/okr.md`, `tests/e2e/work-okr.test.ts`; modify module/resource/capability surfaces.

- [x] Write RED Web tests for organization/personal projections, list/detail, roles, conflicts and action visibility; add E2E creator/assignee/admin/uninvolved journeys.
- [x] Run Web/E2E tests; expect coming-soon routes.
- [x] Implement shared surfaces, Skill references and capability mappings; flip tasks/OKR/approvals/meetings only after complete parity.
- [x] Run `pnpm --filter @tashan/web test`, full gates and `pnpm test:e2e`.
- [x] Commit: `git commit -m "docs(verification): record Phase 2 acceptance"`.
