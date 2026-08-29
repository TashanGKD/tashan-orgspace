# Phase 5 v1 Release Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every v1 parity, recovery, security and distribution gap and publish only the exact verified commit.

**Architecture:** Phase 5 adds no business features. Executable gates compare all contracts and consumers; production-shaped and real-user journeys prove recovery and distribution.

**Tech Stack:** Node scripts, Vitest, Docker Compose, Nginx, PostgreSQL, Redis, MinIO, GitHub Actions.

---

### Task 1: Full-product contract gate
**Files:** Create `scripts/check-v1-product-contract.mjs` and self-test; wire verifier.
- [x] Write RED fixture failures for API/SDK/CLI/Web/Skill/Audit/DomainEvent/module drift.
- [x] Run self-test; expect gate missing.
- [x] Implement read-only fail-closed gate and require same-named self-test.
- [x] Run gate discovery and verifier self-test.
- [x] Commit: `git commit -m "ci(v1): enforce full product contract"`.

### Task 2: Backup and restore drills
**Files:** Create runbooks/scripts/tests for PostgreSQL, MinIO and secrets manifests.
- [x] Write RED restore tests for mismatched DB/object checkpoint, missing key version and corrupt backup.
- [x] Run dry-run tests; expect restore tooling missing.
- [x] Implement explicit-target backup/restore with non-empty-target refusal and checksum manifests.
- [x] Run isolated restore and compare logical counts/object hashes.
- [x] Commit: `git commit -m "chore(recovery): add v1 restore drills"`.

### Task 3: Component restart and reconciliation matrix
**Files:** Extend production-stack tests and recovery verification doc.
- [ ] Write RED tests for API/Worker/Realtime/Postgres/Redis/MinIO/tunnel restart at active operations. (AUP tunnel restart requires deployment approval.)
- [x] Run tests; observe unsupported recovery cases.
- [x] Add only required reconciliation/health behavior to prior phase owners.
- [x] Run matrix proving no lost/duplicate side effects.
- [x] Commit: `git commit -m "test(recovery): verify component restarts"`.

### Task 4: Complete user, browser and CLI/Skill journeys
**Files:** Create v1 E2E journeys, browser checklist and fresh-user distribution tests.
- [x] Add RED journey covering every Phase 1–4 transition and cross-organization rejection.
- [x] Run journey; record actual page/command blockers.
- [x] For every observed blocker, add a failing regression test in its owning Phase 1–4 module, implement the minimum fix there, and keep the Phase 5 change limited to verification wiring.
- [ ] Rerun desktop/mobile browser, CLI JSON and fresh Skill install. (Production-login browser pass remains after approved AUP deploy.)
- [x] Commit: `git commit -m "test(v1): add complete user journey"`.

### Task 5: Production release and evidence
**Files:** Update release manifests, README, architecture status and `docs/verification/v1-full-product-acceptance.md`.
- [ ] Run format/lint/type/unit/integration/distribution/production/E2E/full gates on a clean commit.
- [ ] Deploy exact SHA using existing safe AUP workflow; verify deployed-commit and public HTTPS.
- [ ] Run approved real SMS smoke and public Skill/CLI fresh install.
- [ ] Record counts, SHA, migrations, images, recovery, browser and rollback target.
- [ ] Commit: `git commit -m "docs(release): record OrgSpace v1 acceptance"`.
