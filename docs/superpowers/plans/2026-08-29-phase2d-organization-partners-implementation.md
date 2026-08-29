# Phase 2D Organization Partners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add organization partner contacts with private ownership, administrator oversight, encrypted contact data and immutable follow-up history.

**Architecture:** Partner and PartnerInteraction are independent domain tables using OwnedOrganizationRecordPolicy, SensitiveFieldCipher, blind indexes, ResourceLink and WorkItem. Other members receive non-inferable not-found behavior.

**Tech Stack:** TypeScript 6, Node crypto, Fastify, PostgreSQL, React, Commander, Vitest.

---

### Task 1: Shared ownership and sensitive-field primitives

**Files:** Create `apps/api/src/authorization/owned-record-policy.ts`, `apps/api/src/security/sensitive-field-cipher.ts`, `apps/api/src/security/blind-index.ts` and corresponding tests; modify API config.

- [x] Write RED tests for owner/admin/other-member, key versions, random nonces, tamper rejection, exact blind index and no plaintext serialization.
- [x] Run API unit tests; expect missing primitives.
- [x] Implement AES-256-GCM field envelopes and HMAC-SHA256 blind indexes using separate required secrets.
- [x] Run tests and production config negative tests for missing/placeholder keys.
- [x] Commit: `git commit -m "security(partners): add owned sensitive records"`.

### Task 2: Partner schema and service

**Files:** Create `apps/api/migrations/013_partners.sql`, `packages/contracts/src/partners.ts`, `apps/api/src/partners/partner-service.ts`, `apps/api/test/partners/partner-service.integration.test.ts`.

- [ ] Write RED tests for required name, stages/states, owner scope, admin all, other-member 404, awaiting_owner and cross-org transfer.
- [ ] Run integration tests; expect tables/service missing.
- [ ] Implement encrypted fields, masked summaries, optimistic updates, archive/restore and owner transfer.
- [ ] Run tests and inspect DB fixtures to prove no contact plaintext.
- [ ] Commit: `git commit -m "feat(partners): add organization contacts"`.

### Task 3: Follow-up history and work links

**Files:** Create `apps/api/src/partners/interaction-service.ts`, tests; modify ResourceLink registry.

- [ ] Write RED tests for append-only interaction, correction chain, file/task/meeting permission, duplicate follow-up task and removed member.
- [ ] Run tests; expect missing interaction service.
- [ ] Implement interaction events and idempotent WorkItem creation with bidirectional links.
- [ ] Run targeted tests and audit assertions.
- [ ] Commit: `git commit -m "feat(partners): add follow-up history"`.

### Task 4: API, SDK, CLI and Skill

**Files:** Create partner routes/SDK/CLI commands and `skill/tashan-orgspace/references/partners.md`; modify capability registries.

- [ ] Write RED parity tests for list/get/create/update/archive/restore/transfer/interactions/link/export and explicit admin `--owner all`.
- [ ] Run API/SDK/CLI/gate tests; expect missing bindings.
- [ ] Implement capabilities; require confirmation for export/bulk transfer and create export files as `0600`.
- [ ] Run parity and sensitive-output tests.
- [ ] Commit: `git commit -m "feat(cli): add partner directory commands"`.

### Task 5: Web list/detail and acceptance

**Files:** Create `apps/web/src/features/partners/`, update product/resource/capability surfaces, create `tests/e2e/partners.test.ts` and verification doc.

- [ ] Write RED tests for member own list, admin all/owner/waiting filters, masked list, detail contacts, interactions and transfer.
- [ ] Run Web/E2E tests; expect missing route.
- [ ] Implement list/detail/dialogs with shared surfaces; flip Partner module to available only after parity.
- [ ] Run three-member/admin E2E including inference and plaintext scans.
- [ ] Commit: `git commit -m "docs(verification): record partner acceptance"`.
