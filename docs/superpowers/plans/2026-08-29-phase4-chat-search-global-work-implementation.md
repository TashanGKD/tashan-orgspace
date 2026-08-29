# Phase 4 Chat, Search and Global Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver organization chat, realtime delivery, authorized global search, My Work and administration projections.

**Architecture:** PostgreSQL HTTP history is truth; WebSocket distributes events. Search and My Work aggregate authorized references without copying business state.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, Redis, WebSocket, React, Commander, Vitest.

---

### Task 1: Conversation/message schema and authorization
**Files:** Create `apps/api/migrations/016_chat.sql`, `packages/contracts/src/chat.ts`, `apps/api/src/chat/chat-authorization.ts`, `apps/api/src/chat/chat-service.ts`, `apps/api/test/chat/chat-service.integration.test.ts`.
- [ ] Write RED tests for common-org direct chat, group membership, duplicate client ID, server sequence and nonmember access.
- [ ] Run integration tests; expect schema missing.
- [ ] Implement Conversation, membership, Message and append-only edit/retract/reaction events.
- [ ] Run concurrency/order tests.
- [ ] Commit: `git commit -m "feat(chat): add organization conversations"`.

### Task 2: HTTP history and realtime delivery
**Files:** Create `apps/api/src/routes/chat-routes.ts`, `apps/realtime/package.json`, `apps/realtime/src/main.ts`, `apps/realtime/src/cursor.ts`, `apps/realtime/src/realtime.integration.test.ts`.
- [ ] Write RED tests for missed WebSocket event, cursor gap, duplicate delivery and revoked Membership.
- [ ] Run tests; expect realtime service missing.
- [ ] Implement HTTP history truth, Redis fan-out and WebSocket cursor resume.
- [ ] Run restart and gap-repair tests.
- [ ] Commit: `git commit -m "feat(realtime): stream durable chat events"`.

### Task 3: Resource links, withdrawal and compliance
**Files:** Modify `apps/api/src/chat/chat-service.ts`; create `apps/api/src/chat/compliance-service.ts`, `apps/api/src/routes/chat-compliance-routes.ts`, `apps/api/test/chat/compliance.integration.test.ts`.
- [ ] Write RED tests for cross-permission attachment, message-to-task idempotency, withdrawn search and unauthorized compliance read.
- [ ] Run tests; expect missing actions.
- [ ] Implement file links, task/meeting/approval conversion, retract projection and reason/time-bounded owner compliance workflow.
- [ ] Run audit/notification assertions.
- [ ] Commit: `git commit -m "security(chat): enforce resource and compliance bounds"`.

### Task 4: Authorized search providers
**Files:** Create `apps/api/migrations/017_search.sql`, `packages/contracts/src/search.ts`, `apps/api/src/search/search-service.ts`, `apps/api/src/search/providers/`, `apps/api/test/search/search-inference.integration.test.ts`.
- [ ] Write RED tests for file/work/OKR/Partner/member/message providers, restricted counts and stale Membership cache.
- [ ] Run tests; expect search service missing.
- [ ] Implement provider interface returning ResourceRefs after domain authorization; index projections consume DomainEvent.
- [ ] Run inference and membership-revocation tests.
- [ ] Commit: `git commit -m "feat(search): aggregate authorized resources"`.

### Task 5: My Work and administration projections
**Files:** Create `apps/api/src/work/my-work-service.ts`, `apps/api/src/routes/my-work-routes.ts`, `apps/web/src/features/my-work/`, `apps/cli/src/commands/search.ts`; modify admin pages.
- [ ] Write RED tests for cross-org tasks/approvals/meetings/reminders/@mentions and lost membership.
- [ ] Run tests; expect projections missing.
- [ ] Implement reference-only projection, deep-link organization switching and Partner waiting-owner admin view.
- [ ] Run API/Web/CLI parity tests.
- [ ] Commit: `git commit -m "feat(workspace): add global work projections"`.

### Task 6: Chat Web/CLI/Skill and Phase 4 acceptance
**Files:** Create `apps/web/src/features/chat/`, `apps/cli/src/commands/chat.ts`, `skill/tashan-orgspace/references/chat.md`, `tests/e2e/chat-search.test.ts`, `docs/verification/phase4-chat-search.md`.
- [ ] Write RED conversation/message/mobile/reconnect/search tests and CLI streaming tests.
- [ ] Run tests; expect coming-soon routes.
- [ ] Implement list/detail composer, attachments, conversion, search and Skill mappings.
- [ ] Run multi-user E2E and production-shaped realtime restart smoke.
- [ ] Commit: `git commit -m "docs(verification): record Phase 4 acceptance"`.
