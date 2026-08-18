# Phase 0 Security Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the testable security foundation for Tashan OrgSpace: monorepo, capability contract, authentication, device sessions, verified-phone organization membership, append-only audit, API, SDK, CLI, minimal Web shell, PostgreSQL/Redis integration, and CI enforcement.

**Architecture:** TypeScript services share Zod contracts and a server-owned capability registry. Fastify handles the control-plane API, PostgreSQL is the transactional source of truth, Redis is used only for ephemeral rate limiting, and every mutation writes an audit/outbox record in the same transaction. The CLI and minimal Web shell consume the same SDK; CI fails if a server capability lacks a CLI binding or if any gate lacks a same-named negative self-test.

**Tech Stack:** Node.js 24, pnpm 10, TypeScript 6.0.3, Fastify 5, Zod 4, PostgreSQL 17, Redis 8, `postgres` 3, `node-pg-migrate` 9, Argon2id, JOSE 6, Commander 15, React 19, Vite 8, Vitest 4, Testing Library 16, Docker Compose.

---

### Dependency pins verified on 2026-08-18

| Package | Version |
|---|---:|
| `fastify` | `5.12.0` |
| `@fastify/cookie` | `11.1.2` |
| `@fastify/cors` | `11.3.0` |
| `@fastify/helmet` | `13.1.0` |
| `@fastify/rate-limit` | `11.2.0` |
| `zod` | `4.4.3` |
| `postgres` | `3.4.9` |
| `node-pg-migrate` | `9.0.0` |
| `ioredis` | `6.0.0` |
| `argon2` | `0.45.1` |
| `jose` | `6.2.9` |
| `commander` | `15.0.0` |
| `react` / `react-dom` | `19.2.8` |
| `vite` | `8.2.1` |
| `@vitejs/plugin-react` | `6.0.5` |
| `vitest` | `4.1.10` |
| `@testing-library/react` | `16.3.2` |
| `@testing-library/user-event` | `14.6.5` |
| `jsdom` | `30.0.1` |

## Scope and completion boundary

This plan implements only Phase 0 from the approved design. It does not implement file storage, OKR/work items, production SMS, chat, user workloads, dynamic service domains, AUP deployment, or ECS ingress.

Phase 0 is complete only when:

- A user with a verified phone can log in from two devices, list/revoke one device, and continue using the other.
- A user without a verified phone cannot receive an active organization membership.
- Organization role checks reject a valid user from another organization.
- Audit records contain the trusted server-observed network/device context and reject update/delete.
- `torg` has safe no-argument behavior, stable JSON output, secure token storage, and all Phase 0 capability bindings.
- The minimal Web shell supports login, organization selection, and device revocation.
- Removing a CLI binding makes the capability coverage self-test and CI fail.
- Removing a gate self-test makes the gate inventory check and CI fail.

## File map

### Root and automation

- `package.json` — workspace scripts and pinned package manager.
- `pnpm-workspace.yaml` — TypeScript workspace membership.
- `tsconfig.base.json` — strict shared compiler settings.
- `eslint.config.mjs`, `.prettierrc.json` — static formatting policy.
- `.node-version`, `.npmrc`, `.gitignore`, `.env.example` — reproducible and safe defaults.
- `.githooks/pre-commit`, `.githooks/commit-msg` — local enforcement entrypoints.
- `.github/workflows/ci.yml` — clean-clone CI.
- `scripts/check-toolchain.mjs` and `.self-test.mjs` — runtime version gate.
- `scripts/check-capability-coverage.mjs` and `.self-test.mjs` — API/CLI/Web/Skill consistency gate.
- `scripts/check-gate-self-tests.mjs` and `.self-test.mjs` — every gate has a real negative self-test.
- `scripts/check-commit-evidence.mjs` and `.self-test.mjs` — coverage claims require valid `file:line` evidence.
- `scripts/install-hooks.sh` — explicit, non-destructive hook installation.
- `scripts/verify-phase0.sh` and `.self-test.sh` — complete Phase 0 verifier and a deliberately broken fixture.

### Shared packages

- `packages/contracts/` — Zod schemas, stable errors, IDs, auth/org/audit DTOs.
- `packages/capabilities/` — capability declarations and registry validation.
- `packages/sdk/` — typed HTTP client consumed by CLI and Web.
- `packages/testkit/` — PostgreSQL/Redis test lifecycle, deterministic clock, fake phone sender.

### Applications

- `apps/api/` — Fastify API, domain services, repositories, migrations, auth and audit.
- `apps/worker/` — recoverable outbox worker skeleton; no SMS provider in Phase 0.
- `apps/cli/` — `torg` command tree and credential stores.
- `apps/web/` — minimal React login/organization/device shell.

### Local infrastructure and docs

- `deploy/compose.local.yml` — local PostgreSQL/Redis only, bound to loopback.
- `docs/architecture/phase0-security-foundation.md` — boundaries, routes, schemas, threat decisions.
- `docs/runbooks/local-development.md` — exact local lifecycle and reset commands.

## Contract decisions for this plan

These names are introduced here and must not be renamed in implementation without updating the approved design and capability gate:

- API prefix: `/v1`.
- Error envelope: `{ "error": { "code", "message", "requestId", "details?" } }`.
- Phase 0 roles: `platform_superadmin`, `platform_operator`, `org_owner`, `org_admin`, `member`.
- Principal type schema reserves `human`, `system`, `ai_employee`, `service_account`; `Phase0CreatablePrincipalType` permits only `human` and `system`, and Phase 0 routes expose no general Principal creation endpoint.
- Actor sources: `web`, `cli`, `ai_via_cli`, `system`.
- The authenticated Principal remains the human user for both `cli` and `ai_via_cli`. Session `client_channel` is fixed at login; `ai_via_cli` is a recorded invocation annotation and never grants permission.
- Session tokens: 15-minute EdDSA access JWT; 30-day rotating opaque refresh token stored only as SHA-256 hash server-side.
- CLI development API default: `http://127.0.0.1:4110`. No command may silently switch to production.
- PostgreSQL application role may insert/select audit events but may not update/delete them.

### Initial capability IDs

```text
system.health.read
capability.list
capability.describe
auth.phone.start
auth.phone.confirm
auth.register
auth.login
auth.refresh
auth.logout
auth.whoami
device.list
device.revoke
organization.list
organization.create
organization.member.list
organization.member.add
audit.list
```

## Task 1: Bootstrap the strict monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `.node-version`
- Create: `.npmrc`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `scripts/check-toolchain.mjs`
- Test: `scripts/check-toolchain.self-test.mjs`

- [x] **Step 1: Write the failing toolchain self-test**

```js
// scripts/check-toolchain.self-test.mjs
import { strict as assert } from "node:assert";
import { checkVersions } from "./check-toolchain.mjs";

assert.throws(
  () => checkVersions({ node: "22.0.0", pnpm: "10.32.1" }),
  /Node 24 is required/,
);
assert.doesNotThrow(() => checkVersions({ node: "24.14.0", pnpm: "10.32.1" }));
console.log("check-toolchain.self-test: PASS");
```

- [x] **Step 2: Run it and verify the module is missing**

Run: `node scripts/check-toolchain.self-test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/check-toolchain.mjs`.

- [x] **Step 3: Create the root manifests and minimal gate**

```json
// package.json
{
  "name": "tashan-orgspace",
  "private": true,
  "packageManager": "pnpm@10.32.1",
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "check:toolchain": "node scripts/check-toolchain.mjs",
    "test:gate-self": "node scripts/check-toolchain.self-test.mjs",
    "format:check": "prettier --check .",
    "lint": "eslint .",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@types/node": "26.2.0",
    "eslint": "10.8.1",
    "eslint-config-prettier": "10.1.8",
    "prettier": "3.9.6",
    "typescript": "6.0.3",
    "typescript-eslint": "8.67.0"
  }
}
```

```js
// scripts/check-toolchain.mjs
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function checkVersions({ node, pnpm }) {
  if (Number(node.split(".")[0]) !== 24) throw new Error("Node 24 is required");
  if (Number(pnpm.split(".")[0]) !== 10) throw new Error("pnpm 10 is required");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkVersions({
    node: process.versions.node,
    pnpm: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
  });
  console.log("check-toolchain: PASS");
}
```

Set `pnpm-workspace.yaml` packages to `apps/*` and `packages/*`; set `tsconfig.base.json` to `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `useUnknownInCatchVariables`, `moduleResolution: Bundler`, and `target: ES2024`. `.env.example` contains names only and safe local URLs; it contains no credential values.

- [x] **Step 4: Install and verify**

Run: `pnpm install && pnpm check:toolchain && node scripts/check-toolchain.self-test.mjs`

Expected: lockfile created; both checks print `PASS`.

- [x] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .prettierrc.json .prettierignore .node-version .npmrc .gitignore .env.example scripts/check-toolchain.mjs scripts/check-toolchain.self-test.mjs README.md docs/superpowers/plans/2026-08-18-phase0-security-foundation.md
git commit -m "build(toolchain): bootstrap strict monorepo"
```

## Task 2: Add safe local PostgreSQL and Redis lifecycle

**Files:**
- Create: `deploy/compose.local.yml`
- Create: `packages/testkit/package.json`
- Create: `packages/testkit/tsconfig.json`
- Create: `packages/testkit/src/infra.ts`
- Test: `packages/testkit/src/infra.test.ts`
- Create: `docs/runbooks/local-development.md`

- [x] **Step 1: Write a failing infrastructure readiness test**

```ts
// packages/testkit/src/infra.test.ts
import { expect, test } from "vitest";
import { assertLocalServiceUrl } from "./infra.js";

test.each([
  "postgres://user:pass@db.example.com:5432/orgspace",
  "redis://10.0.0.4:6379",
])("rejects a non-loopback local-test URL: %s", (url) => {
  expect(() => assertLocalServiceUrl(url)).toThrow(/loopback/);
});

test("accepts loopback URLs", () => {
  expect(() => assertLocalServiceUrl("postgres://orgspace:orgspace@127.0.0.1:55432/orgspace")).not.toThrow();
});
```

- [x] **Step 2: Run the test and observe missing implementation**

Run: `pnpm --filter @tashan/testkit test -- infra.test.ts`

Expected: FAIL because `assertLocalServiceUrl` is missing.

- [x] **Step 3: Implement loopback-only development checks and Compose**

```ts
// packages/testkit/src/infra.ts
export function assertLocalServiceUrl(raw: string): void {
  const host = new URL(raw).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`local infrastructure URL must use loopback, got ${host}`);
  }
}
```

`deploy/compose.local.yml` must bind PostgreSQL to `127.0.0.1:55432` and Redis to `127.0.0.1:56379`, define health checks, use named volumes, and contain no `restart: always`. The runbook must state that `docker compose -f deploy/compose.local.yml down` preserves data and `down -v` is destructive and requires explicit confirmation.

- [x] **Step 4: Verify clean startup and shutdown**

Run: `docker compose -f deploy/compose.local.yml up -d --wait && pnpm --filter @tashan/testkit test && docker compose -f deploy/compose.local.yml down`

Expected: PostgreSQL and Redis healthy; tests pass; containers stop without deleting volumes.

- [x] **Step 5: Commit**

```bash
git add deploy packages/testkit docs/runbooks/local-development.md
git commit -m "build(local-infra): add loopback data services"
```

## Task 3: Define stable shared contracts and errors

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/common.ts`
- Create: `packages/contracts/src/error.ts`
- Create: `packages/contracts/src/auth.ts`
- Create: `packages/contracts/src/organization.ts`
- Create: `packages/contracts/src/audit.ts`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/contracts.test.ts`

- [x] **Step 1: Write rejection-first schema tests**

```ts
import { describe, expect, test } from "vitest";
import { ActorSource, OrganizationRole, PhoneNumber, Phase0CreatablePrincipalType } from "./index.js";

describe("security discriminants", () => {
  test.each(["root", "owner", "ai_employee", "service_account"])('rejects Phase 0 principal creation type "%s"', (value) => {
    expect(Phase0CreatablePrincipalType.safeParse(value).success).toBe(false);
  });
  test.each(["admin", "superadmin", "guest"])("rejects role alias %s", (value) => {
    expect(OrganizationRole.safeParse(value).success).toBe(false);
  });
  test("rejects client-invented actor source", () => {
    expect(ActorSource.safeParse("trusted_cli").success).toBe(false);
  });
  test("requires E.164 phone format", () => {
    expect(PhoneNumber.safeParse("13800138000").success).toBe(false);
    expect(PhoneNumber.parse("+8613800138000")).toBe("+8613800138000");
  });
});
```

- [x] **Step 2: Run and verify failure**

Run: `pnpm --filter @tashan/contracts test`

Expected: FAIL because schemas are not exported.

- [x] **Step 3: Implement exact enums and error envelope**

```ts
// packages/contracts/src/error.ts
import { z } from "zod";

export const ErrorCode = z.enum([
  "AUTH_REQUIRED", "AUTH_INVALID_CREDENTIALS", "AUTH_TOKEN_EXPIRED", "AUTH_TOKEN_REVOKED",
  "DEVICE_REVOKED", "PHONE_NOT_VERIFIED", "ORG_FORBIDDEN", "ORG_NOT_FOUND",
  "CAPABILITY_NOT_FOUND", "IDEMPOTENCY_CONFLICT", "RATE_LIMITED",
  "USERNAME_TAKEN", "PHONE_PROVIDER_UNAVAILABLE", "VALIDATION_FAILED", "INTERNAL_ERROR",
]);

export const ErrorEnvelope = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    requestId: z.string().uuid(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
```

Define `PrincipalType = z.enum(["human", "system", "ai_employee", "service_account"])`, `Phase0CreatablePrincipalType = z.enum(["human", "system"])`, the five exact roles, four actor sources, branded UUID schemas, E.164 phone, registration/login/refresh/device/org/audit request and response schemas. Export only from `src/index.ts`.

- [x] **Step 4: Run contract tests and typecheck**

Run: `pnpm --filter @tashan/contracts test && pnpm --filter @tashan/contracts typecheck`

Expected: all tests pass with zero type errors.

- [x] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): define Phase 0 schemas"
```

## Task 4: Make the capability registry the single source of truth

**Files:**
- Create: `packages/capabilities/package.json`
- Create: `packages/capabilities/tsconfig.json`
- Create: `packages/capabilities/src/index.ts`
- Create: `packages/capabilities/src/schema.ts`
- Create: `packages/capabilities/src/registry.ts`
- Create: `packages/capabilities/src/phase0.ts`
- Create: `packages/capabilities/src/phase0-capabilities.json`
- Test: `packages/capabilities/src/registry.test.ts`
- Create: `apps/cli/src/bindings.ts`
- Create: `apps/cli/src/capability-bindings.json`
- Create: `apps/web/src/capability-surfaces.ts`
- Create: `apps/web/src/capability-surfaces.json`
- Create: `skill/capability-references.json`

- [x] **Step 1: Write failing registry pathology tests**

```ts
import { expect, test } from "vitest";
import { buildRegistry } from "./registry.js";

const base = {
  version: 1, inputSchema: "Empty", outputSchema: "Empty",
  permissions: [], sideEffect: "none", idempotent: true,
  confirmation: "none", cli: "health", web: "deferred",
} as const;

test("rejects duplicate IDs", () => {
  expect(() => buildRegistry([{ ...base, id: "system.health.read" }, { ...base, id: "system.health.read" }])).toThrow(/duplicate/);
});

test("rejects a mutating capability marked side-effect free", () => {
  expect(() => buildRegistry([{ ...base, id: "device.revoke", cli: "device revoke" }])).toThrow(/mutation metadata/);
});
```

- [x] **Step 2: Run and verify failure**

Run: `pnpm --filter @tashan/capabilities test`

Expected: FAIL because the registry does not exist.

- [x] **Step 3: Implement registry validation and all 17 initial IDs**

```ts
export const Capability = z.object({
  id: z.string().regex(/^[a-z]+(?:\.[a-z]+)+$/),
  version: z.literal(1),
  inputSchema: z.string().min(1),
  outputSchema: z.string().min(1),
  permissions: z.array(z.string()),
  sideEffect: z.enum(["none", "session", "write", "revoke"]),
  idempotent: z.boolean(),
  confirmation: z.enum(["none", "required"]),
  cli: z.string().min(1),
  web: z.enum(["required", "deferred"]),
  auditAction: z.string().min(1),
});
```

`phase0.ts` declares exactly the 17 IDs in this plan. `apps/cli/src/capability-bindings.json` is the gate-readable command mapping and `bindings.ts` schema-validates it as `Record<CapabilityId, string>`. The Web pair follows the same pattern for required Web IDs. The Skill JSON lists capability IDs but no copied command syntax.

- [x] **Step 4: Run registry tests**

Run: `pnpm --filter @tashan/capabilities test && pnpm --filter @tashan/capabilities typecheck`

Expected: duplicate and mutation-metadata negative tests pass; registry contains 17 unique IDs.

- [x] **Step 5: Commit**

```bash
git add packages/capabilities apps/cli/src/bindings.ts apps/cli/src/capability-bindings.json apps/web/src/capability-surfaces.ts apps/web/src/capability-surfaces.json skill/capability-references.json
git commit -m "feat(capabilities): add Phase 0 registry"
```

## Task 5: Enforce coverage and gate self-tests in CI and hooks

**Files:**
- Create: `scripts/check-capability-coverage.mjs`
- Create: `scripts/check-capability-coverage.self-test.mjs`
- Create: `scripts/check-gate-self-tests.mjs`
- Create: `scripts/check-gate-self-tests.self-test.mjs`
- Create: `scripts/check-commit-evidence.mjs`
- Create: `scripts/check-commit-evidence.self-test.mjs`
- Create: `.githooks/pre-commit`
- Create: `.githooks/commit-msg`
- Create: `scripts/install-hooks.sh`
- Create: `.github/workflows/ci.yml`

- [x] **Step 1: Write real-shape negative fixtures in each self-test**

```js
// scripts/check-capability-coverage.self-test.mjs
import { strict as assert } from "node:assert";
import { checkCoverage } from "./check-capability-coverage.mjs";

const server = [{ id: "device.revoke", web: "required" }];
assert.throws(() => checkCoverage(server, {}, ["device.revoke"], ["device.revoke"]), /missing CLI binding: device.revoke/);
assert.throws(() => checkCoverage(server, { "device.revoke": "device revoke" }, [], ["device.revoke"]), /missing Web surface/);
assert.throws(() => checkCoverage(server, { "device.revoke": "device revoke" }, ["device.revoke"], ["device.revoked"]), /unknown Skill capability/);
console.log("check-capability-coverage.self-test: PASS");
```

The gate inventory self-test creates a temporary `check-orphan.mjs` without `check-orphan.self-test.mjs` and asserts rejection. The commit-evidence self-test uses the actual strings `all green`, `0 violations`, and `fully covered` without `file:line`, then verifies rejection; it also verifies a real in-range citation succeeds.

- [x] **Step 2: Run self-tests and verify missing gate modules**

Run: `node scripts/check-capability-coverage.self-test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [x] **Step 3: Implement gates and fail-closed hooks**

`check-capability-coverage.mjs` compares server IDs, CLI keys, required Web IDs, and Skill IDs; duplicate or extra entries fail. `check-gate-self-tests.mjs` discovers every `scripts/check-*.mjs` except `*.self-test.mjs` and requires the same basename plus `.self-test.mjs`. `check-commit-evidence.mjs` validates each cited path exists and the cited line is in range.

`.githooks/pre-commit` runs formatting, lint, typecheck, unit tests, all gates, and all self-tests with `set -eu`. `.githooks/commit-msg` runs the evidence checker. `scripts/install-hooks.sh` only sets `git config core.hooksPath .githooks` after an explicit invocation; no package install script mutates Git config.

- [x] **Step 4: Prove positive and negative behavior**

Run:

```bash
node scripts/check-capability-coverage.self-test.mjs
node scripts/check-gate-self-tests.self-test.mjs
node scripts/check-commit-evidence.self-test.mjs
node scripts/check-capability-coverage.mjs
node scripts/check-gate-self-tests.mjs
```

Expected: every self-test prints `PASS`; production gates print zero violations. Temporarily remove one CLI binding, run coverage gate and observe non-zero exit, then restore it and rerun successfully.

- [x] **Step 5: Commit**

```bash
git add scripts .githooks .github package.json
git commit -m "build(gates): enforce capability consistency"
```

## Task 6: Create the Phase 0 database schema

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/vitest.integration.config.ts`
- Create: `apps/api/migrations/001_phase0.sql`
- Create: `apps/api/migrations/002_app_roles.sql`
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/db/migrate.ts`
- Test: `apps/api/test/db/schema.integration.test.ts`

- [x] **Step 1: Write failing schema invariants**

The integration test connects to local PostgreSQL, migrates an empty database, then asserts:

```ts
expect(await columnNames(sql, "sessions")).toEqual(expect.arrayContaining([
  "device_id", "refresh_token_hash", "token_version", "expires_at", "revoked_at",
]));
await expect(sql`update audit_events set action = 'tampered'`).rejects.toThrow(/audit_events are append-only/);
await expect(sql`delete from audit_events`).rejects.toThrow(/audit_events are append-only/);
```

Also construct duplicate active Membership `(organization_id, account_id)`, duplicate refresh token hash, and invalid role values; each must be rejected by PostgreSQL, not only application code.

- [x] **Step 2: Run against a clean database and verify failure**

Run: `pnpm --filter @tashan/api test:integration -- schema.integration.test.ts`

Expected: FAIL because migrations are absent.

- [x] **Step 3: Write complete migrations**

`001_phase0.sql` creates:

```sql
create extension if not exists pgcrypto;
create extension if not exists citext;
create table accounts (
  id uuid primary key default gen_random_uuid(),
  username citext not null unique,
  password_hash text not null,
  phone_e164 text unique,
  phone_verified_at timestamptz,
  status text not null check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table principals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid unique references accounts(id),
  type text not null check (type in ('human','system','ai_employee','service_account')),
  created_at timestamptz not null default now(),
  check (
    (type = 'human' and account_id is not null)
    or (type in ('system','ai_employee','service_account') and account_id is null)
  )
);
```

Add `phone_verifications`, `organizations`, `memberships`, `devices`, `sessions`, `idempotency_records`, `outbox_events`, and `audit_events`. Membership has a partial unique index allowing only one non-removed membership per organization/account. Session refresh hashes are unique. Audit rows contain organization/account/principal/session/device IDs, server IP, proxy chain JSON, device metadata JSON, actor source, capability ID, action, object type/ID, result, error code, request/idempotency IDs, redacted before/after JSON, `prev_hash`, `event_hash`, and timestamp.

`002_app_roles.sql` adds an audit trigger that raises `audit_events are append-only` on UPDATE/DELETE and grants the application role INSERT/SELECT only. Migrations do not create or embed production passwords.

- [x] **Step 4: Recreate database and run integration tests**

Run: `pnpm --filter @tashan/api db:reset:test && pnpm --filter @tashan/api test:integration -- schema.integration.test.ts`

Expected: all constraints and append-only tests pass.

- [x] **Step 5: Commit**

```bash
git add apps/api/package.json apps/api/migrations apps/api/src/db apps/api/test/db
git commit -m "feat(database): add Phase 0 schema"
```

## Task 7: Add transactional repositories, idempotency, and outbox

**Files:**
- Create: `apps/api/src/db/transaction.ts`
- Create: `apps/api/src/repositories/account-repository.ts`
- Create: `apps/api/src/repositories/session-repository.ts`
- Create: `apps/api/src/repositories/organization-repository.ts`
- Create: `apps/api/src/repositories/audit-repository.ts`
- Create: `apps/api/src/repositories/idempotency-repository.ts`
- Create: `apps/api/src/repositories/outbox-repository.ts`
- Test: `apps/api/test/repositories/transaction.integration.test.ts`

- [x] **Step 1: Write rollback and duplicate-idempotency tests**

```ts
test("rolls back domain, audit, and outbox together", async () => {
  await expect(unitOfWork.run(async (tx) => {
    await accounts.insert(tx, accountFixture());
    await audit.append(tx, auditFixture());
    await outbox.append(tx, outboxFixture());
    throw new Error("forced rollback");
  })).rejects.toThrow("forced rollback");
  expect(await counts()).toEqual({ accounts: 0, audit: 0, outbox: 0 });
});

test("same idempotency key with different request hash conflicts", async () => {
  await idempotency.claim(actorId, "organization.create", "key-1", "hash-a");
  await expect(idempotency.claim(actorId, "organization.create", "key-1", "hash-b"))
    .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
});
```

- [x] **Step 2: Run and verify failure**

Run: `pnpm --filter @tashan/api test:integration -- transaction.integration.test.ts`

Expected: FAIL because repositories are missing.

- [x] **Step 3: Implement one transaction boundary**

`UnitOfWork.run` passes one `postgres.TransactionSql` to every repository. No repository may open an internal transaction. Idempotency stores SHA-256 of canonical JSON input and the completed response envelope. Outbox rows are inserted in the same transaction as the domain change.

- [x] **Step 4: Run repository tests**

Run: `pnpm --filter @tashan/api test:integration -- transaction.integration.test.ts`

Expected: rollback leaves all three tables empty; identical request returns cached response; different hash returns `IDEMPOTENCY_CONFLICT`.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/db/transaction.ts apps/api/src/repositories apps/api/test/repositories
git commit -m "feat(database): add transactional repositories"
```

## Task 8: Implement password, access-token, and device-session security

**Files:**
- Create: `apps/api/src/auth/password.ts`
- Create: `apps/api/src/auth/access-token.ts`
- Create: `apps/api/src/auth/refresh-token.ts`
- Create: `apps/api/src/auth/auth-service.ts`
- Create: `apps/api/src/auth/auth-errors.ts`
- Create: `apps/api/migrations/003_session_refresh_tokens.sql`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Test: `apps/api/test/auth/auth-service.test.ts`
- Test: `apps/api/test/auth/session-rotation.integration.test.ts`

- [x] **Step 1: Write adversarial tests before login success**

```ts
test.each([
  ["expired JWT", expiredAccessToken(), "AUTH_TOKEN_EXPIRED"],
  ["revoked device", accessTokenFor(revokedDevice), "DEVICE_REVOKED"],
  ["old token version", accessTokenWithVersion(1), "AUTH_TOKEN_REVOKED"],
])("rejects %s", async (_name, token, code) => {
  await expect(auth.authenticate(token)).rejects.toMatchObject({ code });
});

test("refresh-token reuse revokes the session", async () => {
  const first = await auth.login(validCredentials, deviceA);
  const second = await auth.refresh(first.refreshToken);
  await expect(auth.authenticate(second.accessToken)).resolves.toMatchObject({ deviceId: deviceA.id });
  await expect(auth.refresh(first.refreshToken)).rejects.toMatchObject({ code: "AUTH_TOKEN_REVOKED" });
  await expect(auth.authenticate(second.accessToken)).rejects.toMatchObject({ code: "AUTH_TOKEN_REVOKED" });
});
```

Also add a concurrent-refresh test proving exactly one compare-and-swap succeeds. Verify wrong username and wrong password return the same public error and do not reveal account existence; rate-limit login by normalized username and server-observed IP.

Add registration tests proving `Alice` and `alice` collide, weak passwords are rejected before database access, and registration creates exactly one human Principal but no Membership.

- [x] **Step 2: Run and verify failure**

Run: `pnpm --filter @tashan/api test -- auth-service.test.ts && pnpm --filter @tashan/api test:integration -- session-rotation.integration.test.ts`

Expected: FAIL because auth services are absent.

- [x] **Step 3: Implement minimal secure primitives**

```ts
export const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("base64url");
}
```

Generate 32 random bytes for refresh tokens. Sign 15-minute EdDSA JWTs containing `iss`, `aud`, `kid`, `sub`, `principalId`, `sessionId`, `deviceId`, `tokenVersion`, `actorSource`, `iat`, `exp`, and `jti`; verify algorithm, issuer, audience and active key ID. On every request, load session and device after signature verification; do not trust JWT membership claims. Rotation uses a compare-and-swap on the old hash and token version. Reuse of an old refresh token revokes the entire session.

Registration validates username/password with the shared schema, hashes with Argon2id, creates Account and human Principal in one transaction, and maps case-insensitive uniqueness to `USERNAME_TAKEN`. Registration does not verify a phone and does not create an organization Membership.

- [x] **Step 4: Run auth tests**

Run: `pnpm --filter @tashan/api test -- auth-service.test.ts && pnpm --filter @tashan/api test:integration -- session-rotation.integration.test.ts`

Expected: all rejection and rotation tests pass.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/auth apps/api/test/auth
git commit -m "feat(auth): add device-bound sessions"
```

## Task 9: Enforce phone verification and organization membership

**Files:**
- Create: `apps/api/src/phone/phone-verification-service.ts`
- Create: `apps/api/src/phone/verification-code-sender.ts`
- Create: `apps/api/src/organizations/organization-service.ts`
- Create: `apps/api/src/organizations/authorization.ts`
- Create: `apps/api/src/rate-limit/redis-fixed-window.ts`
- Test: `apps/api/test/organizations/organization-service.integration.test.ts`
- Test: `apps/api/test/organizations/phone-verification.integration.test.ts`
- Test: `apps/api/test/organizations/redis-rate-limiter.integration.test.ts`
- Create: `packages/testkit/src/fake-verification-code-sender.ts`

- [x] **Step 1: Write rejection-first membership tests**

```ts
test("cannot activate membership without a verified phone", async () => {
  await expect(orgs.addMember(admin, orgId, unverifiedAccountId, "member"))
    .rejects.toMatchObject({ code: "PHONE_NOT_VERIFIED" });
});

test("valid member from another organization is forbidden", async () => {
  await expect(orgs.listMembers(memberOfOrgB, orgAId))
    .rejects.toMatchObject({ code: "ORG_FORBIDDEN" });
});

test("ordinary member cannot add another member", async () => {
  await expect(orgs.addMember(ordinaryMember, orgId, verifiedAccountId, "member"))
    .rejects.toMatchObject({ code: "ORG_FORBIDDEN" });
});
```

- [x] **Step 2: Run and verify failure**

Run: `pnpm --filter @tashan/api test:integration`

Expected: FAIL because organization authorization is missing.

- [x] **Step 3: Implement phone and organization state machines**

Phone start creates a hashed six-digit code, 10-minute expiry, maximum five attempts, and Redis rate limits by account, phone, and server-observed IP. `VerificationCodeSender` is an interface; Phase 0 production config has no provider and returns a stable unavailable error, while tests use `FakeVerificationCodeSender`. Confirmation atomically marks the phone verified and consumes the challenge.

Organization creation requires a verified phone and creates `org_owner` membership in one transaction. `addMember` permits owner/admin only and checks the target account's current verification state. Authorization always scopes by both organization ID and active Membership.

- [x] **Step 4: Run domain and integration tests**

Run: `TEST_DATABASE_URL=<loopback-test-url> TEST_REDIS_URL=<loopback-test-url> pnpm --filter @tashan/api test:integration`

Expected: unverified phone, cross-org, and ordinary-member cases fail with stable codes; verified owner flow passes.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/phone apps/api/src/organizations apps/api/test/organizations packages/testkit/src/fake-verification-code-sender.ts
git commit -m "feat(organizations): require verified membership"
```

## Task 10: Build tamper-evident audit capture

**Files:**
- Create: `apps/api/migrations/004_audit_chain_position.sql`
- Create: `apps/api/src/audit/audit-service.ts`
- Create: `apps/api/src/audit/audit-context.ts`
- Create: `apps/api/src/audit/redaction.ts`
- Create: `apps/api/src/http/trusted-proxy.ts`
- Modify: `apps/api/src/repositories/audit-repository.ts`
- Modify: `packages/contracts/src/audit.ts`
- Test: `apps/api/test/audit/audit-service.test.ts`
- Test: `apps/api/test/audit/audit-chain.integration.test.ts`

- [x] **Step 1: Write spoofing and PII rejection tests**

```ts
test("ignores x-forwarded-for from an untrusted peer", () => {
  expect(resolveClientIp({ peer: "203.0.113.7", forwardedFor: "10.0.0.1", trustedProxies: [] }))
    .toEqual({ clientIp: "203.0.113.7", proxyChain: [] });
});

test("redacts phone and refresh token", () => {
  expect(redact({ phone: "+8613800138000", refreshToken: "secret" }))
    .toEqual({ phone: "+86138****8000", refreshToken: "[REDACTED]" });
});

test("detects a broken hash chain", async () => {
  await appendThreeEvents();
  await privilegedFixtureTamperSecondEvent();
  await expect(audit.verifyChain(orgId)).resolves.toMatchObject({ valid: false, brokenAt: 2 });
});
```

- [x] **Step 2: Run and verify failure**

Run: `pnpm --filter @tashan/api test -- audit-service.test.ts`

Expected: FAIL because audit capture is absent.

- [x] **Step 3: Implement canonical hashing and trusted context**

Use canonical JSON with sorted keys. Under an organization-scoped advisory transaction lock, load the previous hash and calculate:

```ts
eventHash = sha256(`${previousHash}.${canonicalJson(redactedEventWithoutHashes)}`);
```

Only configured ECS/gateway proxy CIDRs may contribute forwarded IPs. Device name, OS, architecture, CLI/Web/Skill version, request ID, idempotency key, actor source, capability, result and error code must be present when available. The API derives `web`/`cli` from the authenticated session. It accepts `ai_via_cli` only as an audit annotation on an authenticated CLI session, stores the original reported value separately, and never uses it for authorization.

- [x] **Step 4: Run audit unit and integration tests**

Run: `pnpm --filter @tashan/api test -- audit-service.test.ts && pnpm --filter @tashan/api test:integration -- audit-chain.integration.test.ts`

Expected: spoofed headers ignored, PII redacted, valid chain verifies, fixture tampering is detected.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/audit apps/api/src/http/trusted-proxy.ts apps/api/test/audit
git commit -m "security(audit): add tamper-evident events"
```

## Task 11: Expose Fastify API routes from the capability contracts

**Files:**
- Create: `apps/api/migrations/005_idempotency_actor_key.sql`
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/http/error-handler.ts`
- Create: `apps/api/src/http/authenticate.ts`
- Create: `apps/api/src/http/idempotency.ts`
- Create: `apps/api/src/http/request-audit.ts`
- Create: `apps/api/src/http/request-context.ts`
- Create: `apps/api/src/routes/auth-routes.ts`
- Create: `apps/api/src/routes/device-routes.ts`
- Create: `apps/api/src/routes/organization-routes.ts`
- Create: `apps/api/src/routes/capability-routes.ts`
- Create: `apps/api/src/routes/audit-routes.ts`
- Create: `apps/api/src/routes/phone-routes.ts`
- Create: `apps/api/src/routes/route-helpers.ts`
- Modify: `apps/api/src/auth/auth-service.ts`
- Modify: `apps/api/src/organizations/organization-service.ts`
- Modify: `apps/api/src/phone/phone-verification-service.ts`
- Modify: `apps/api/src/repositories/idempotency-repository.ts`
- Create: `packages/contracts/src/system.ts`
- Modify: `packages/contracts/src/audit.ts`
- Modify: `package.json`
- Test: `apps/api/test/http/api.integration.test.ts`
- Test: `apps/api/src/config.test.ts`

- [x] **Step 1: Write route-contract tests with real payloads**

```ts
test("returns the stable error envelope", async () => {
  const response = await app.inject({ method: "GET", url: "/v1/auth/whoami" });
  expect(response.statusCode).toBe(401);
  expect(ErrorEnvelope.parse(response.json()).error).toMatchObject({ code: "AUTH_REQUIRED" });
});

test("revoking one device does not revoke another", async () => {
  const { tokenA, tokenB, deviceA } = await loginTwice();
  await api(tokenB).delete(`/v1/devices/${deviceA}`);
  await expect(api(tokenA).get("/v1/auth/whoami")).rejects.toMatchObject({ status: 401 });
  await expect(api(tokenB).get("/v1/auth/whoami")).resolves.toMatchObject({ status: 200 });
});
```

Add route tests for all 17 capability IDs, including duplicate username, missing idempotency key on mutations, cross-org access, and malformed UUIDs.

- [x] **Step 2: Run and verify 404/failure**

Run: `pnpm --filter @tashan/api test:integration -- api.integration.test.ts`

Expected: FAIL because `/v1` routes are not mounted.

- [x] **Step 3: Implement routes and middleware**

Mount exactly:

```text
GET    /v1/health
GET    /v1/capabilities
GET    /v1/capabilities/:capabilityId
POST   /v1/auth/register
POST   /v1/phone-verifications
POST   /v1/phone-verifications/confirm
POST   /v1/auth/login
POST   /v1/auth/refresh
POST   /v1/auth/logout
GET    /v1/auth/whoami
GET    /v1/devices
DELETE /v1/devices/:deviceId
GET    /v1/organizations
POST   /v1/organizations
GET    /v1/organizations/:organizationId/members
POST   /v1/organizations/:organizationId/members
GET    /v1/audit-events
```

Each handler references one capability ID, parses request/response with shared schemas, and writes audit on success and rejection. Mutation routes require `Idempotency-Key`, except login/refresh/logout which use session-specific replay protection. Config validation refuses wildcard CORS, missing signing key, production mode with loopback secrets, or an enabled phone provider without credentials.

- [x] **Step 4: Run API tests**

Run: `pnpm --filter @tashan/api test && pnpm --filter @tashan/api test:integration`

Expected: all route, auth, org, audit and idempotency tests pass.

- [x] **Step 5: Commit**

```bash
git add apps/api/src apps/api/test/http
git commit -m "feat(api): expose Phase 0 control plane"
```

## Task 12: Add the recoverable outbox worker skeleton

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/src/config.ts`
- Create: `apps/worker/src/outbox-loop.ts`
- Create: `apps/worker/src/main.ts`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/vitest.integration.config.ts`
- Test: `apps/worker/src/outbox-loop.integration.test.ts`

- [x] **Step 1: Write lease recovery tests**

```ts
test("reclaims an expired lease after worker crash", async () => {
  const event = await insertPendingEvent();
  await lease(event.id, "dead-worker", clock.minusMinutes(10));
  expect(await worker.claimBatch()).toEqual([expect.objectContaining({ id: event.id })]);
});

test("does not process an event twice while lease is live", async () => {
  const event = await insertPendingEvent();
  await lease(event.id, "worker-a", clock.plusMinutes(1));
  expect(await workerB.claimBatch()).toEqual([]);
});
```

- [x] **Step 2: Run and verify failure**

Run: `pnpm --filter @tashan/worker test -- outbox-loop.integration.test.ts`

Expected: FAIL because worker does not exist.

- [x] **Step 3: Implement `FOR UPDATE SKIP LOCKED` leasing**

Claim pending or expired rows in a transaction, set `lease_owner` and `lease_expires_at`, then dispatch only registered Phase 0 handlers. Unknown event types move to dead-letter with a stable reason; they are not dropped. SIGTERM stops new claims, waits for the active handler, and releases its lease.

- [x] **Step 4: Run worker tests**

Run: `TEST_DATABASE_URL=<loopback-test-url> pnpm --filter @tashan/worker test:integration`

Expected: crash recovery, live lease exclusion, dead-letter and SIGTERM tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): add recoverable outbox loop"
```

## Task 13: Build the typed SDK

**Files:**
- Create: `packages/sdk/package.json`
- Create: `packages/sdk/src/client.ts`
- Create: `packages/sdk/src/transport.ts`
- Create: `packages/sdk/src/index.ts`
- Test: `packages/sdk/src/client.test.ts`

- [ ] **Step 1: Write transport and error-decoding tests**

```ts
test("adds bearer, request, device, channel and idempotency headers", async () => {
  const transport = captureTransport(okResponse({ id: "org-1" }));
  await client(transport).createOrganization({ name: "Tashan" }, { idempotencyKey: "k1" });
  expect(transport.lastHeaders()).toMatchObject({
    authorization: "Bearer access-token",
    "idempotency-key": "k1",
    "x-torg-device-id": deviceId,
    "x-torg-client-channel": "cli",
    "x-torg-invocation-source": "ai_via_cli",
  });
});

test("decodes stable API errors", async () => {
  await expect(client(errorTransport("ORG_FORBIDDEN")).listMembers(orgId))
    .rejects.toMatchObject({ code: "ORG_FORBIDDEN" });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @tashan/sdk test`

Expected: FAIL because SDK is absent.

- [ ] **Step 3: Implement schema-validated methods**

Create one SDK method per Phase 0 capability. Parse every response with `@tashan/contracts`; never return raw `unknown`. The transport accepts `AbortSignal`, has a finite timeout, never retries mutations automatically, and refreshes access tokens only once per request chain.

- [ ] **Step 4: Run SDK tests and typecheck**

Run: `pnpm --filter @tashan/sdk test && pnpm --filter @tashan/sdk typecheck`

Expected: headers, errors, timeout, one-refresh and schema rejection tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): add typed Phase 0 client"
```

## Task 14: Create the safe `torg` CLI and credential stores

**Files:**
- Create: `apps/cli/package.json`
- Create: `apps/cli/src/main.ts`
- Create: `apps/cli/src/program.ts`
- Create: `apps/cli/src/output.ts`
- Create: `apps/cli/src/config.ts`
- Create: `apps/cli/src/credentials/credential-store.ts`
- Create: `apps/cli/src/credentials/macos-keychain-store.ts`
- Create: `apps/cli/src/credentials/linux-secret-service-store.ts`
- Create: `apps/cli/src/credentials/encrypted-file-store.ts`
- Create: `apps/cli/src/credentials/memory-store.ts`
- Test: `apps/cli/test/safe-defaults.test.ts`
- Test: `apps/cli/test/credential-store.test.ts`

- [ ] **Step 1: Write safe-default and injection tests first**

```ts
test("no args prints help without filesystem or network access", async () => {
  const effects = fakeEffects();
  const result = await runCli([], effects);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: torg");
  expect(effects.calls()).toEqual([]);
});

test("password flag is not accepted", async () => {
  const result = await runCli(["auth", "login", "--password", "secret"], fakeEffects());
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("unknown option '--password'");
});

test.each(["name;open /tmp/pwned", "$(touch /tmp/pwned)", "`id`"])('passes keychain label as one argv: %s', async (label) => {
  const spawn = captureSpawn();
  await new MacOSKeychainStore(spawn).read(label);
  expect(spawn.shellUsed()).toBe(false);
  expect(spawn.argv()).toContain(label);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @tashan/cli test -- safe-defaults.test.ts credential-store.test.ts`

Expected: FAIL because program and stores are absent.

- [ ] **Step 3: Implement safe CLI infrastructure**

Commander program name is `torg`; no-argument action prints help. Source/development default is `http://127.0.0.1:4110`; a production URL must come from explicit config or release packaging. stdout carries data, stderr carries diagnostics. `--json` outputs one JSON value and stable exit codes.

Keychain and Secret Service call `security`/`secret-tool` using `spawnFile(binary, argv, { shell: false })`. If unavailable, use memory only. Encrypted file storage requires both explicit `--credential-file` and a passphrase prompt, derives a key with scrypt, encrypts with AES-256-GCM, writes atomically with mode `0600`, and deletes the temp file on every failure branch.

- [ ] **Step 4: Run safe-default tests**

Run: `pnpm --filter @tashan/cli test -- safe-defaults.test.ts credential-store.test.ts`

Expected: no-arg test has zero effects; injection inputs remain one argv; failed encrypted writes leave no temp files.

- [ ] **Step 5: Commit**

```bash
git add apps/cli
git commit -m "feat(cli): add safe torg foundation"
```

## Task 15: Implement Phase 0 CLI commands

**Files:**
- Create: `apps/cli/src/commands/auth.ts`
- Create: `apps/cli/src/commands/device.ts`
- Create: `apps/cli/src/commands/organization.ts`
- Create: `apps/cli/src/commands/capability.ts`
- Create: `apps/cli/src/commands/audit.ts`
- Test: `apps/cli/test/commands.test.ts`
- Test: `apps/cli/test/cli-api.integration.test.ts`

- [ ] **Step 1: Write command behavior tests**

```ts
test("login prompts securely and never prints tokens", async () => {
  const result = await runCli(["auth", "login", "--username", "alice"], effectsWithPassword("secret"));
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Logged in as alice");
  expect(result.stdout + result.stderr).not.toContain("refresh-token");
});

test("organization creation requires explicit idempotency key in non-interactive mode", async () => {
  const result = await runCli(["org", "create", "--name", "Tashan", "--json", "--yes"], fakeEffects());
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("--idempotency-key is required");
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @tashan/cli test -- commands.test.ts`

Expected: FAIL because commands are absent.

- [ ] **Step 3: Bind all Phase 0 capabilities**

Implement:

```text
torg auth phone-start --phone <e164>
torg auth phone-confirm --challenge <uuid> --code-stdin
torg auth register --username <name> [--password-stdin]
torg auth login --username <name> [--password-stdin]
torg auth refresh
torg auth logout
torg auth whoami
torg device list
torg device revoke <device-id> --yes --idempotency-key <key>
torg org list
torg org create --name <name> --yes --idempotency-key <key>
torg org member list --org <org-id>
torg org member add --org <org-id> --account <account-id> --role <role> --yes --idempotency-key <key>
torg audit list --org <org-id>
torg capability list --json
torg capability describe <capability-id> --json
```

Mutations fail before network access when required confirmation, organization, input, or idempotency key is absent. `device revoke` refuses the current device unless `--allow-current-device` is also present.

- [ ] **Step 4: Run mocked and real API integration tests**

Run: `pnpm --filter @tashan/cli test && pnpm --filter @tashan/cli test:integration`

Expected: all commands have text and JSON snapshots; two-device integration and cross-org rejection pass.

- [ ] **Step 5: Run the capability coverage gate**

Run: `node scripts/check-capability-coverage.mjs`

Expected: `17 server capabilities, 17 CLI bindings, 0 missing`.

- [ ] **Step 6: Commit**

```bash
git add apps/cli
git commit -m "feat(cli): cover Phase 0 capabilities"
```

## Task 16: Build the minimal Web login, organization, and device shell

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app.tsx`
- Create: `apps/web/src/auth/login-page.tsx`
- Create: `apps/web/src/organizations/organization-switcher.tsx`
- Create: `apps/web/src/devices/device-list.tsx`
- Create: `apps/web/src/api.ts`
- Test: `apps/web/src/app.test.tsx`

- [ ] **Step 1: Write accessible user-flow tests**

```tsx
test("logs in, selects an organization, and revokes another device", async () => {
  render(<App sdk={fakeSdk(twoDevicesFixture)} />);
  await user.type(screen.getByLabelText("用户名"), "alice");
  await user.type(screen.getByLabelText("密码"), "secret");
  await user.click(screen.getByRole("button", { name: "登录" }));
  await user.selectOptions(await screen.findByLabelText("当前组织"), orgId);
  await user.click(screen.getByRole("button", { name: "撤销 MacBook Air" }));
  await user.click(screen.getByRole("button", { name: "确认撤销" }));
  expect(await screen.findByText("设备已撤销")).toBeVisible();
});
```

Add tests for invalid credentials, phone-not-verified organization creation, current-device protection, loading states, and API error focus.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @tashan/web test`

Expected: FAIL because the Web app is absent.

- [ ] **Step 3: Implement the minimal shell**

Use the shared SDK and shared schemas. Keep access tokens in memory; use an HttpOnly refresh cookie for Web rather than browser storage. The Web shell implements the capability IDs marked `web: required`: registration, phone verification, login, logout, whoami, organization list, device list and device revoke. Capability list/describe remain `deferred` in Web but available in CLI.

- [ ] **Step 4: Run Web tests and production build**

Run: `pnpm --filter @tashan/web test && pnpm --filter @tashan/web build`

Expected: accessible flow tests pass and Vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): add Phase 0 account shell"
```

## Task 17: Prove the full two-user/two-device lifecycle

**Files:**
- Create: `tests/e2e/phase0-lifecycle.test.ts`
- Create: `tests/e2e/cross-org-rejections.test.ts`
- Create: `tests/e2e/audit-evidence.test.ts`
- Create: `vitest.e2e.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the full lifecycle before wiring the runner**

The test must perform real HTTP calls and CLI subprocesses:

```ts
test("Phase 0 lifecycle", async () => {
  const alice = await registerAndVerify("alice", "+8613800138001");
  const bob = await registerAndVerify("bob", "+8613800138002");
  const aliceMac = await cliLogin(alice, "alice-mac");
  const aliceLinux = await cliLogin(alice, "alice-linux");
  const org = await cli(aliceMac).orgCreate("Tashan", "org-create-1");
  await cli(aliceMac).memberAdd(org.id, bob.id, "member", "member-add-1");
  await cli(aliceLinux).deviceRevoke(aliceMac.deviceId, "device-revoke-1");
  await expect(cli(aliceMac).whoami()).rejects.toMatchObject({ code: "DEVICE_REVOKED" });
  await expect(cli(aliceLinux).whoami()).resolves.toMatchObject({ username: "alice" });
  expect(await auditEvidence(org.id)).toContainEqual(expect.objectContaining({ capabilityId: "device.revoke" }));
});
```

Cross-org tests use a valid token and guessed real object IDs from another organization. Audit tests assert server IP, device ID/name, OS/arch, CLI version, actor source, request ID and result are present and secrets/whole phone numbers are absent.

- [ ] **Step 2: Run and verify runner failure**

Run: `pnpm test:e2e`

Expected: FAIL because E2E config/startup wiring is missing.

- [ ] **Step 3: Add deterministic E2E orchestration**

The runner starts Compose with `--wait`, creates an isolated database, migrates, starts API and worker on loopback random ports, executes tests, then terminates processes and Compose in `finally`. It must refuse non-loopback database/Redis/API URLs. No arbitrary sleeps: poll health endpoints with a bounded deadline.

- [ ] **Step 4: Run E2E twice**

Run: `pnpm test:e2e && pnpm test:e2e`

Expected: both runs pass; the second run proves cleanup and idempotent setup.

- [ ] **Step 5: Commit**

```bash
git add tests vitest.e2e.config.ts package.json
git commit -m "test(e2e): prove Phase 0 lifecycle"
```

## Task 18: Add Phase 0 verification, docs, and negative self-test

**Files:**
- Create: `scripts/verify-phase0.sh`
- Create: `scripts/verify-phase0.self-test.sh`
- Create: `docs/architecture/phase0-security-foundation.md`
- Modify: `README.md`

- [ ] **Step 1: Write the verifier self-test first**

```bash
#!/usr/bin/env bash
set -eu
fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT
mkdir -p "$fixture_dir/repo"
tar --exclude=.git --exclude=node_modules --exclude=coverage --exclude=.local-data -cf - . \
  | tar -C "$fixture_dir/repo" -xf -
node -e '
  const fs = require("fs");
  const p = process.argv[1];
  const x = JSON.parse(fs.readFileSync(p, "utf8"));
  delete x["device.revoke"];
  fs.writeFileSync(p, JSON.stringify(x, null, 2));
' "$fixture_dir/repo/apps/cli/src/capability-bindings.json"
if (cd "$fixture_dir/repo" && ./scripts/verify-phase0.sh); then
  echo "FAIL: verifier accepted missing device.revoke binding" >&2
  exit 1
fi
echo "verify-phase0.self-test: PASS"
```

The verifier itself must be included in its dirty/self-coverage list.

- [ ] **Step 2: Run and verify missing verifier**

Run: `bash scripts/verify-phase0.self-test.sh`

Expected: FAIL because `verify-phase0.sh` does not exist.

- [ ] **Step 3: Implement the complete verifier**

`verify-phase0.sh` runs, in order:

```bash
pnpm check:toolchain
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
node scripts/check-capability-coverage.mjs
node scripts/check-gate-self-tests.mjs
node scripts/check-capability-coverage.self-test.mjs
node scripts/check-gate-self-tests.self-test.mjs
node scripts/check-commit-evidence.self-test.mjs
pnpm test:e2e
```

It fails closed, prints each command, and records no secret-bearing environment values. Documentation lists the exact routes, tables, capability IDs, actor/role enums, token lifecycle, trusted proxy behavior and non-goals. README links the approved design, this plan, architecture doc and local runbook.

- [ ] **Step 4: Prove the verifier catches the business drift**

Run: `bash scripts/verify-phase0.self-test.sh`

Expected: inner verifier fails specifically with `missing CLI binding: device.revoke`; outer self-test prints `PASS`.

- [ ] **Step 5: Run the full verifier on the real tree**

Run: `bash scripts/verify-phase0.sh`

Expected: all static, unit, integration, gate, negative-self-test and E2E layers pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-phase0.sh scripts/verify-phase0.self-test.sh docs/architecture/phase0-security-foundation.md README.md
git commit -m "docs(phase0): add verification contract"
```

## Final Phase 0 review

- [ ] Run `git status --short` and confirm only intended plan-tracking changes remain.
- [ ] Run `bash scripts/verify-phase0.sh` fresh and save its output summary with the candidate commit SHA.
- [ ] Inspect `git diff main...HEAD` and confirm no Phase 1+ functionality entered the branch.
- [ ] Confirm every `scripts/check-*.mjs` and `scripts/verify-*.sh` has a same-named self-test.
- [ ] Confirm no access key, signing private key, password, refresh token, full phone number, `.env`, database volume, or local credential file is tracked.
- [ ] Confirm removing `device.revoke` CLI binding makes the coverage gate fail, then restore it and rerun successfully.
- [ ] Confirm current-device revocation needs explicit override, while revoking another device works.
- [ ] Confirm a valid user from another organization receives `ORG_FORBIDDEN` and the rejection is audited.
- [ ] Commit any plan-tracking checkbox updates separately with `docs(plan): record Phase 0 execution`.

## Plan self-review result

- **Spec coverage:** Phase 0 requirements in the approved design map to Tasks 1–18. File storage, work items/OKR, SMS provider, chat, runtime and dynamic ingress remain intentionally outside this plan.
- **Security order:** Auth, tenancy, credential and proxy tests begin with at least three concrete rejection inputs before happy-path implementation.
- **Type consistency:** Capability IDs, roles, actor sources, error codes, route names and session fields are defined once above and reused throughout.
- **Gate behavior:** Capability coverage, gate inventory, commit evidence and Phase 0 verifier each have a same-named negative self-test using a real failure shape.
- **Safe defaults:** No-argument CLI is effect-free; source checkout targets loopback; local Compose binds loopback; hooks install only by explicit command; destructive reset is not the default.
- **No placeholders:** Later phases are excluded by scope rather than represented by empty stubs.
