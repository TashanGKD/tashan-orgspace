# Phase 3 Notifications, SMS and Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project DomainEvents into reliable in-app notifications, scheduled reminders and audited Alibaba Cloud SMS deliveries.

**Architecture:** Domain modules only write events/outbox. Notification projector, scheduler and delivery worker own policy, idempotency and provider reconciliation.

**Tech Stack:** TypeScript, PostgreSQL, Worker leases, Alibaba Cloud SMS SDK, React, Commander, Vitest.

---

### Task 1: Notification contracts and policy tables
**Files:** Create `apps/api/migrations/014_notifications.sql`, `packages/contracts/src/notifications.ts`, `apps/api/src/notifications/notification-policy-service.ts`, `apps/api/test/notifications/notification-policy.integration.test.ts`.
- [ ] Write RED tests for mandatory vs daily-summary-only opt-out, organization timezone and immutable policy versions.
- [ ] Run API integration tests; expect missing schema.
- [ ] Implement NotificationPolicy, Notification, ScheduledReminder and DeliveryAttempt tables/contracts.
- [ ] Run tests and schema checks.
- [ ] Commit: `git commit -m "feat(notifications): add policy and delivery model"`.

### Task 2: Event projector and deterministic reminders
**Files:** Create `apps/worker/src/notifications/notification-projector.ts`, `apps/worker/src/notifications/reminder-scheduler.ts`, `apps/worker/src/notifications/reminder-scheduler.integration.test.ts`.
- [ ] Write RED tests for duplicate event, DDL/meeting one-hour windows, partner follow-up and restart recovery.
- [ ] Run Worker tests; expect handlers missing.
- [ ] Implement deterministic keys and persisted reminder instances; do not scan entire business tables each minute.
- [ ] Run time-zone/DST/restart tests.
- [ ] Commit: `git commit -m "feat(worker): schedule organization reminders"`.

### Task 3: Alibaba SMS delivery reconciliation
**Files:** Create `apps/worker/src/notifications/aliyun-delivery.ts`, `apps/worker/src/notifications/aliyun-delivery.test.ts`; modify `apps/worker/src/config.ts` and `apps/worker/src/main.ts`.
- [ ] Write RED tests for accepted-not-delivered, BizId query, timeout query-before-retry, provider duplicate and redaction.
- [ ] Run tests; expect delivery handler missing.
- [ ] Implement send/query state machine and encrypted phone lookup; never call shell Skill in production.
- [ ] Run provider-fake tests and log secret scan.
- [ ] Commit: `git commit -m "feat(sms): reconcile Alibaba delivery status"`.

### Task 4: API/CLI/Web/Skill surfaces
**Files:** Create `apps/api/src/routes/notification-routes.ts`, `packages/sdk/src/notifications.ts`, `apps/cli/src/commands/notification.ts`, `apps/web/src/features/notifications/`, `skill/tashan-orgspace/references/notifications.md`; modify capability registries.
- [ ] Write RED list/detail/read/preference/admin-policy tests and reject attempts to disable mandatory notifications.
- [ ] Run surface tests; expect missing capabilities.
- [ ] Implement API, CLI commands and notification center; daily summary is the only persistent member opt-out.
- [ ] Run parity gates and accessibility tests.
- [ ] Commit: `git commit -m "feat(web): add notification center"`.

### Task 5: Phase 3 acceptance
**Files:** Create `tests/e2e/notifications.test.ts` and `docs/verification/phase3-notifications.md`.
- [ ] Add simulated journeys for approval, urgent, optional task, DDL, meeting, daily summary and Partner follow-up.
- [ ] Run E2E; verify idempotency and restart recovery.
- [ ] Run one separately approved real SMS smoke and query final carrier result.
- [ ] Run full verifier and record accepted vs delivered evidence separately.
- [ ] Commit: `git commit -m "docs(verification): record Phase 3 acceptance"`.
