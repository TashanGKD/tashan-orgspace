# OrgSpace Phone Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace username authentication with independent phone-number registration, login and password reset, using an OrgSpace-owned Aliyun verification sender and matching Web, CLI and Skill surfaces without modifying the Panshi camp project.

**Architecture:** Contracts define anonymous purpose-bound verification challenges and phone-first auth requests. The API owns verification state, account records, device sessions and Aliyun delivery; Web and CLI call the same SDK methods while handling secrets only in controlled inputs. Forward migrations fail closed on incompatible legacy accounts, and capability/drift gates prevent username authentication or missing client surfaces from returning.

**Tech Stack:** TypeScript 6, Zod 4, Fastify 5, PostgreSQL 17, Redis 8, React 19, TanStack Query 5, Commander, Vitest, Aliyun Dysmsapi SDK.

**Atomic cutover rule:** The existing commit hook enforces API, CLI, Web and Skill parity. Tasks 1–7 are therefore testable work units inside one uncommitted cutover; do not create an intermediate commit while the full verifier is red. Task 8 closes every surface and creates the single feature commit only after the complete hook passes. This is intentionally stricter than preserving a sequence of broken commits.

**Protected-project baseline:** The sorted `git status --porcelain` fingerprint of the Panshi worktree was `b2ce3195c7982c0d1ec918d65bbb22b8d7aca96e1b9e20e2a49658e4998e1a2b` on 2026-08-19. Recompute it at the final gate; do not edit, stage, restore or clean that worktree.

---

## File map

```text
packages/contracts/src/auth.ts                  phone-first request/response schemas
packages/contracts/src/common.ts                display-name and verification-purpose schemas
packages/contracts/src/error.ts                 stable verification/reset errors
packages/capabilities/src/phase0*.{ts,json}      authoritative capability registry
apps/api/migrations/006_phone_identity.sql       fail-closed account/challenge migration
apps/api/src/phone/verification-code-sender.ts   sender boundary
apps/api/src/phone/phone-verification-service.ts anonymous purpose-bound challenges
apps/api/src/phone/aliyun-verification-code-sender.ts OrgSpace Aliyun adapter
apps/api/src/auth/auth-service.ts                phone register/login/reset transactions
apps/api/src/routes/auth-routes.ts               public auth HTTP routes and Web cookie behavior
apps/api/src/config.ts                           fail-closed Aliyun configuration
apps/api/src/server.ts                           provider composition
packages/sdk/src/client.ts                       strict cross-client auth methods
apps/cli/src/commands/auth.ts                    secret-safe phone auth commands
apps/web/src/auth/access-panel.tsx               three-state anonymous UI
apps/web/src/platform/session/session-context.tsx Web auth lifecycle
scripts/check-phone-auth-surface.mjs              username-removal and client-coverage gate
skill/tashan-orgspace/references/authentication.md user and agent instructions
tests/e2e/phone-auth-lifecycle.test.ts             multi-device reset lifecycle
```

### Task 1: Replace username contracts and capabilities

**Files:**
- Modify: `packages/contracts/src/common.ts`
- Modify: `packages/contracts/src/auth.ts`
- Modify: `packages/contracts/src/organization.ts`
- Modify: `packages/contracts/src/error.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Modify: `packages/capabilities/src/phase0-capabilities.json`
- Modify: `apps/cli/src/capability-bindings.json`
- Modify: `skill/tashan-orgspace/capability-references.json`

- [ ] **Step 1: Write failing strict-contract tests**

Add cases that require normalized phone input, reject legacy `username`, reject extra secret fields, and distinguish verification purposes:

```ts
const device = DeviceLoginMetadata.parse({
  id: "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
  name: "Test device",
  os: "test",
  architecture: "test",
  clientVersion: "0.0.0",
  channel: "cli",
});
expect(
  RegisterRequest.parse({
    phone: "13800138000",
    challengeId,
    code: "123456",
    password: "correct-horse",
    device,
  }).phone,
).toBe("+8613800138000");
expect(LoginRequest.safeParse({ username: "alice", password: "correct-horse", device }).success)
  .toBe(false);
expect(VerificationPurpose.options).toEqual(["register", "password_reset"]);
expect(
  PasswordResetRequest.safeParse({
    phone: "+8613800138000",
    challengeId,
    code: "123456",
    newPassword: "correct-horse",
    token: "must-not-pass",
  }).success,
).toBe(false);
```

- [ ] **Step 2: Run the contract suite and verify RED**

Run: `pnpm --filter @tashan/contracts test`

Expected: FAIL because the phone-first schemas and purpose enum do not exist.

- [ ] **Step 3: Implement strict schemas and capability IDs**

Define `VerificationPurpose = z.enum(["register", "password_reset"])`, `DisplayName`, `VerificationSendRequest/Response`, phone-first `RegisterRequest`, `LoginRequest` and `PasswordResetRequest`. Make `RegisterResponse` equal the authenticated login response shape. Replace `AccountSummary.username` and `MembershipSummary.username` with `displayName`.

Replace Phase 0 capabilities `auth.phone.start` and `auth.phone.confirm` with:

```json
{
  "id": "auth.verification.send",
  "inputSchema": "VerificationSendRequest",
  "outputSchema": "VerificationSendResponse",
  "cli": "auth code-send",
  "web": "required",
  "auditAction": "auth.verification.send"
}
```

and add `auth.password.reset` with CLI binding `auth password-reset`, Web required, anonymous permission, write side effect and required confirmation. Keep the registry length at 17 by replacing the two old phone capabilities with verification-send and password-reset.

- [ ] **Step 4: Run contracts and capability tests**

Run:

```bash
pnpm --filter @tashan/contracts test
pnpm --filter @tashan/capabilities test
node scripts/check-capability-coverage.mjs
```

Expected: contract and capability unit tests pass; record the expected cross-surface RED until Tasks 6–8 add all new surfaces.

- [ ] **Step 5: Record the cutover checkpoint without committing**

```bash
git diff --check
git status --short
```

Expected: only the named OrgSpace files are dirty. Continue to Task 2; the parity hook intentionally prevents an intermediate commit.

### Task 2: Add the fail-closed phone identity migration

**Files:**
- Create: `apps/api/migrations/006_phone_identity.sql`
- Modify: `apps/api/src/db/migrate.test.ts`
- Modify: `apps/api/test/db/schema.integration.test.ts`
- Modify: `apps/api/src/routes/route-helpers.ts`
- Modify: `apps/api/src/repositories/account-repository.ts`
- Modify: `apps/api/src/organizations/organization-service.ts`
- Modify: `apps/api/src/routes/organization-routes.ts`

- [ ] **Step 1: Write failing migration and schema tests**

Add tests proving a fresh database ends with non-null unique `phone_e164`, non-null `phone_verified_at`, non-null `display_name`, no `username`, and purpose-bound anonymous challenges. Add a pathology fixture with an unverified legacy account and assert migration failure contains `legacy accounts require explicit phone mapping`.

- [ ] **Step 2: Run the database tests and verify RED**

Run:

```bash
pnpm --filter @tashan/api exec vitest run src/db/migrate.test.ts
pnpm --filter @tashan/api exec vitest run --config vitest.integration.config.ts test/db/schema.integration.test.ts
```

Expected: FAIL because migration `006_phone_identity.sql` is absent.

- [ ] **Step 3: Implement the forward migration**

The migration must:

```sql
do $$
begin
  if exists (select 1 from phone_verifications) then
    raise exception 'legacy phone verification challenges must expire before migration';
  end if;
end $$;

alter table accounts add column display_name text;
update accounts
set display_name = '用户' || right(phone_e164, 4)
where phone_e164 is not null and phone_verified_at is not null;

do $$
begin
  if exists (
    select 1 from accounts
    where phone_e164 is null or phone_verified_at is null or display_name is null
  ) then
    raise exception 'legacy accounts require explicit phone mapping';
  end if;
end $$;

alter table accounts alter column phone_e164 set not null;
alter table accounts alter column phone_verified_at set not null;
alter table accounts alter column display_name set not null;
alter table accounts drop column username;

alter table phone_verifications alter column account_id drop not null;
alter table phone_verifications add column purpose text not null;
alter table phone_verifications add constraint phone_verifications_purpose_check
  check (purpose in ('register', 'password_reset'));
alter table phone_verifications add column request_id uuid not null;
alter table phone_verifications add column server_ip inet not null;
alter table phone_verifications add column delivery_result text not null;
```

Replace all account/member projections with `display_name`. Do not add a destructive automatic reset.

- [ ] **Step 4: Run migration, schema, API type and organization tests**

Run:

```bash
pnpm --filter @tashan/api test
pnpm --filter @tashan/api typecheck
pnpm --filter @tashan/api exec vitest run --config vitest.integration.config.ts test/db/schema.integration.test.ts test/organizations/organization-service.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Record the cutover checkpoint without committing**

```bash
git diff --check
git status --short
```

Expected: migration and API projection changes are present, with no Panshi paths. Continue without bypassing hooks.

### Task 3: Rebuild verification challenges for anonymous purposes

**Files:**
- Modify: `apps/api/src/phone/verification-code-sender.ts`
- Replace: `apps/api/src/phone/phone-verification-service.ts`
- Replace: `apps/api/src/routes/phone-routes.ts`
- Create: `apps/api/test/phone/phone-verification-service.test.ts`
- Modify: `apps/api/test/organizations/phone-verification.integration.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write adversarial tests before the happy path**

Construct and reject these inputs:

1. a `register` challenge submitted as `password_reset`;
2. the right code paired with a different phone;
3. a consumed or expired challenge;
4. a sixth failed attempt;
5. sender failure after challenge allocation, proving no usable challenge remains.

Then add the happy path asserting HMAC storage, no plaintext code in serialized records, 10-minute expiry and phone/IP/purpose rate-limit keys.

- [ ] **Step 2: Run the focused suite and verify RED**

Run: `pnpm --filter @tashan/api exec vitest run test/phone/phone-verification-service.test.ts`

Expected: FAIL because the service currently requires an authenticated account and has no purpose.

- [ ] **Step 3: Implement allocation and consumption**

Expose:

```ts
start(input: {
  phone: string;
  purpose: "register" | "password_reset";
  serverIp: string;
  requestId: string;
}, transaction?: TransactionClient): Promise<{ challengeId: string; expiresAt: Date }>;

consume(input: {
  phone: string;
  purpose: "register" | "password_reset";
  challengeId: string;
  code: string;
}, transaction: TransactionClient): Promise<void>;
```

Insert the challenge and send inside one controlled branch; on sender failure, roll back the row. Use constant-time HMAC comparison and increment attempts under `FOR UPDATE`.

Mount `POST /v1/auth/verification/send` without authentication. It remains idempotent with actor key `verification:<purpose>:<normalized phone>:<server IP>` and never exposes account existence.

- [ ] **Step 4: Run focused and integration tests**

Run:

```bash
pnpm --filter @tashan/api exec vitest run test/phone/phone-verification-service.test.ts
pnpm --filter @tashan/api exec vitest run --config vitest.integration.config.ts test/organizations/phone-verification.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Record the cutover checkpoint without committing**

```bash
git diff --check
git status --short
```

### Task 4: Implement the independent Aliyun verification sender

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/api/src/phone/aliyun-verification-code-sender.ts`
- Create: `apps/api/test/phone/aliyun-verification-code-sender.test.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write provider and configuration rejection tests**

Use an injected fake client and assert:

```ts
await expect(sender.send(message)).resolves.toBeUndefined(); // Code === "OK"
await expect(rejectedSender.send(message)).rejects.toThrow("not accepted");
await expect(incompleteSender.send(message)).rejects.toThrow("incomplete");
expect(() => loadConfig({ ...base, PHONE_PROVIDER: "aliyun" })).toThrow(
  "ALIYUN_SMS_ACCESS_KEY_ID is required",
);
```

Also assert the captured request contains the configured sign/template and JSON `{ code }`, while serialized logs contain neither code nor credentials.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @tashan/api exec vitest run test/phone/aliyun-verification-code-sender.test.ts src/config.test.ts
```

Expected: FAIL because no Aliyun sender exists and the server rejects the provider.

- [ ] **Step 3: Implement fail-closed Aliyun composition**

Add pinned official Aliyun SMS dependencies. Implement `AliyunVerificationCodeSender` behind `VerificationCodeSender`; accept only an explicit `Code === "OK"` and a non-empty provider request ID. Wire `PHONE_PROVIDER=aliyun` in `server.ts`; keep `disabled` as the no-env development default. Never log credentials or codes.

- [ ] **Step 4: Run provider, config and type checks**

Run:

```bash
pnpm --filter @tashan/api exec vitest run test/phone/aliyun-verification-code-sender.test.ts src/config.test.ts
pnpm --filter @tashan/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Record the cutover checkpoint without committing**

```bash
git diff --check
git status --short
```

### Task 5: Implement phone register, login and password reset transactions

**Files:**
- Modify: `apps/api/src/auth/auth-service.ts`
- Modify: `apps/api/src/auth/auth-errors.ts`
- Modify: `apps/api/src/routes/auth-routes.ts`
- Modify: `apps/api/test/auth/auth-service.test.ts`
- Modify: `apps/api/test/http/api.integration.test.ts`
- Modify: `apps/api/test/auth/session-rotation.integration.test.ts`

- [ ] **Step 1: Write failing transaction and enumeration tests**

Tests must prove:

- registration consumes a matching challenge, creates account/principal/device/session and returns login tokens;
- two concurrent registrations for one phone create exactly one account;
- login uses normalized phone and gives the same public error for unknown phone and wrong password;
- password reset consumes only `password_reset`, updates the Argon2 hash and revokes every active session;
- rollback preserves the old password and sessions when audit/session revocation fails;
- Web register sets the refresh cookie; Web reset clears it.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @tashan/api exec vitest run test/auth/auth-service.test.ts
pnpm --filter @tashan/api exec vitest run --config vitest.integration.config.ts test/auth/session-rotation.integration.test.ts test/http/api.integration.test.ts
```

Expected: FAIL on username lookup and missing reset methods.

- [ ] **Step 3: Implement minimal transaction methods and routes**

Implement `register(input, context, transaction)` by consuming the register challenge before inserting the account and calling the same internal session-issuance helper used by login. Implement `resetPassword` in one transaction:

```sql
update accounts set password_hash = $newHash, updated_at = now() where id = $accountId;
update sessions set revoked_at = now(), updated_at = now()
where account_id = $accountId and revoked_at is null;
```

Use a dummy Argon2 hash for unknown-phone login timing. `POST /v1/auth/password/reset` uses idempotency actor key based on normalized phone and server IP, clears `__Host-torg_refresh`, and never returns tokens.

- [ ] **Step 4: Run API tests and typecheck**

Run:

```bash
pnpm --filter @tashan/api test
pnpm --filter @tashan/api typecheck
pnpm --filter @tashan/api exec vitest run --config vitest.integration.config.ts test/auth/session-rotation.integration.test.ts test/http/api.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Record the cutover checkpoint without committing**

```bash
git diff --check
git status --short
```

### Task 6: Update SDK and secret-safe CLI

**Files:**
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/sdk/src/client.test.ts`
- Modify: `apps/cli/src/commands/auth.ts`
- Modify: `apps/cli/src/credentials/session-credentials.ts`
- Modify: `apps/cli/test/commands.test.ts`
- Modify: `apps/cli/test/credential-store.test.ts`
- Modify: `apps/cli/test/cli-api.integration.test.ts`

- [ ] **Step 1: Write failing SDK and CLI tests**

Assert exact paths, idempotency headers and no credential output. CLI tests must reject `--password`, `--code` and `--username`; support hidden prompts and `--password-stdin`/`--code-stdin`; clear credentials after password reset; and store only account ID, display name and tokens with mode `0600`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @tashan/sdk test
pnpm --filter @tashan/cli test
```

Expected: FAIL because existing methods and commands use username and post-login phone binding.

- [ ] **Step 3: Implement SDK and CLI surfaces**

SDK methods:

```ts
sendVerificationCode(input, mutation)
register(input, mutation)
login(input, signal?)
resetPassword(input, mutation)
```

CLI commands use phone/challenge as non-secret options and read password/code via hidden prompts or stdin. `auth register` updates both tokens and identity because registration auto-logs in. `auth password-reset` clears local credentials only after API success.

- [ ] **Step 4: Run SDK/CLI tests and integration**

Run:

```bash
pnpm --filter @tashan/sdk test
pnpm --filter @tashan/cli test
pnpm --filter @tashan/cli exec vitest run --config vitest.integration.config.ts test/cli-api.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Record the cutover checkpoint without committing**

```bash
git diff --check
git status --short
```

### Task 7: Replace the Web anonymous flow with the three-state access panel

**Files:**
- Replace: `apps/web/src/auth/login-page.tsx`
- Create: `apps/web/src/auth/access-panel.tsx`
- Create: `apps/web/src/auth/verification-code-control.tsx`
- Create: `apps/web/src/auth/access-panel.test.tsx`
- Modify: `apps/web/src/platform/session/session-context.tsx`
- Modify: `apps/web/src/platform/session/session-context.test.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/features/account/account-page.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write failing UI tests**

Cover:

- login/register/reset tab switching preserves phone but clears password/code;
- send-code button starts a countdown only after API success;
- register sends phone/challenge/code/password/device and enters authenticated state;
- password reset shows success, returns to login and leaves session anonymous;
- errors show message and focused request ID;
- old username input and post-login phone-verification strip are absent.

- [ ] **Step 2: Run focused Web tests and verify RED**

Run:

```bash
pnpm --filter @tashan/web exec vitest run src/auth/access-panel.test.tsx src/platform/session/session-context.test.tsx src/app.test.tsx
```

Expected: FAIL because the three-state access panel is absent.

- [ ] **Step 3: Implement the independent OrgSpace UI**

Use local components and OrgSpace wording. Do not import any Panshi files or packages. `SessionProvider` owns `sendVerificationCode`, `register`, `login` and `resetPassword`; registration sets authenticated state, reset clears credentials and sets anonymous state. Countdown state is local UI state and never acts as server expiry truth.

- [ ] **Step 4: Run all Web tests, typecheck and production build**

Run:

```bash
pnpm --filter @tashan/web test
pnpm --filter @tashan/web typecheck
pnpm --filter @tashan/web build
```

Expected: PASS.

- [ ] **Step 5: Record the cutover checkpoint without committing**

```bash
git diff --check
git status --short
```

### Task 8: Strengthen capability, Skill and username-removal gates

**Files:**
- Modify: `apps/web/src/capability-surfaces.json`
- Modify: `skill/tashan-orgspace/SKILL.md`
- Modify: `skill/tashan-orgspace/references/authentication.md`
- Create: `scripts/check-phone-auth-surface.mjs`
- Create: `scripts/check-phone-auth-surface.self-test.mjs`
- Modify: `scripts/check-gate-self-tests.mjs`
- Modify: `scripts/verify-phase0.sh`

- [ ] **Step 1: Write the gate self-test first**

The self-test creates real-shaped fixtures and proves rejection of:

- a `--username` auth option;
- a `where username =` authentication lookup;
- a missing Web password-reset surface;
- a missing CLI binding;
- a Skill document that recommends passing password/code as command arguments.

- [ ] **Step 2: Run the self-test and verify RED**

Run: `node scripts/check-phone-auth-surface.self-test.mjs`

Expected: FAIL because the gate does not exist.

- [ ] **Step 3: Implement and wire the gate**

The gate scans only auth contracts, routes, service, SDK, CLI and Skill paths; it must not flag historical design/verification documents. It compares the four capability IDs against API registry, CLI bindings, Web surface records and Skill references, then rejects active username-auth patterns and secret-bearing CLI flags. Add it and its self-test to the gate inventory and full verifier.

- [ ] **Step 4: Run all gate checks**

Run:

```bash
node scripts/check-phone-auth-surface.self-test.mjs
node scripts/check-phone-auth-surface.mjs
node scripts/check-capability-coverage.mjs
node scripts/check-gate-self-tests.mjs
```

Expected: all commands print `PASS`.

- [ ] **Step 5: Run the full hook and commit the atomic cutover**

```bash
git add packages apps scripts skill .env.example pnpm-lock.yaml
git commit -m "feat(auth): switch OrgSpace to independent phone access"
```

Expected: the normal commit hook runs and passes; never use `--no-verify`.

### Task 9: Prove multi-device reset and record verification

**Files:**
- Create: `tests/e2e/phone-auth-lifecycle.test.ts`
- Modify: `tests/e2e/support/flows.ts`
- Modify: `tests/e2e/support/cli-scenario.ts`
- Modify: `scripts/fixtures/fresh-user-server.mjs`
- Create: `docs/verification/2026-08-19-phone-authentication.md`

- [ ] **Step 1: Write the full lifecycle E2E test**

The test must use a fake verification sender and two distinct devices:

1. send/register and auto-login device A;
2. login device B with the same phone;
3. verify both tokens work;
4. send and complete password reset;
5. verify both old access and refresh tokens fail;
6. verify the old password fails;
7. login device A with the new password;
8. inspect audit evidence for masked phone, IP, device, source, request ID and no code/password/token.

- [ ] **Step 2: Run E2E and verify RED**

Run: `pnpm test:e2e`

Expected: FAIL until all fixtures use phone auth and the new lifecycle is implemented.

- [ ] **Step 3: Update fixtures and make the lifecycle pass**

Update fresh-user and CLI fixtures to the exact new contracts. Fake senders may expose codes only through test-process memory or a mode-`0600` temporary file that is removed in `finally`; they must never print codes.

- [ ] **Step 4: Run complete verification and production build**

Run:

```bash
bash scripts/verify-phase0.sh
pnpm --filter @tashan/web build
find apps/web/dist -maxdepth 2 -type f -print | sort
```

Expected: `verify-phase0: PASS`, all E2E tests pass and the Web build emits `index.html` plus hashed assets.

- [ ] **Step 5: Prove Panshi zero impact and write evidence**

Before implementation, record the sorted `git status --porcelain` fingerprint for:

```text
/Users/boyuan/aiwork/Tashan-Org/homepage-v2/.worktrees/panshi-ai4s-camp-site/panshi-ai4s-camp
```

After verification, compute it again and require equality. The verification document separates static checks, unit/rejection tests, database E2E, build artifacts, Panshi zero-impact evidence, and explicitly unrun real Aliyun SMS/AUP/production deployment.

- [ ] **Step 6: Commit**

```bash
git add tests scripts/fixtures/fresh-user-server.mjs docs/verification/2026-08-19-phone-authentication.md
git commit -m "test(auth): verify phone lifecycle across devices"
```

### Task 10: Review and preserve the branch

**Files:** none

- [ ] **Step 1: Inspect history, complete diff and forbidden scope**

Run:

```bash
git status --short --branch
git log --oneline --decorate main..HEAD
git diff --check main...HEAD
git diff --name-only main...HEAD | rg '^(deploy/|services/|\.github/workflows/release)' && exit 1 || true
```

Expected: clean OrgSpace worktree, no whitespace errors and no deployment/release changes.

- [ ] **Step 2: Recheck Panshi fingerprint**

Run the exact sorted-status fingerprint from Task 9 and compare it to the baseline. Expected: identical.

- [ ] **Step 3: Stop without external mutation**

Keep `codex/web-platform` and its worktree. Do not push, merge, open a PR, deploy AUP, configure a domain or send a real SMS.
