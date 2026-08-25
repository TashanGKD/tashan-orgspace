# OrgSpace Web Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 0 single-page control desk with a routed, organization-first Web shell that preserves existing account/device flows, exposes the approved full navigation with safe coming-soon pages, adds member and audit surfaces, uses same-origin API access, and enforces real Web capability bindings in CI.

**Architecture:** Keep Web as a peer client of CLI through `@tashan/sdk`. React Router owns URL context, TanStack Query owns server-state caches, a session provider owns the in-memory access token lifecycle, and a product-module catalog owns navigation/roadmap state separately from executable capabilities. Business authorization remains in the API; the Web role projection only controls navigation and redirects.

**Tech Stack:** React 19, TypeScript 6, Vite 8, React Router 8.3.0, TanStack Query 5.101.4, Vitest 4, Testing Library, existing Zod contracts and OrgSpace SDK.

---

## Scope boundary

This plan implements the Web platform layer and migrates capabilities that already exist in Phase 0. Files, tasks, OKR, approvals, meetings, chat, runtime, services and databases appear only as `coming_soon` modules. Their APIs and real pages require separate specs and plans.

No step deploys to AUP, changes DNS, changes production infrastructure, or pushes the branch.

## File map

```text
apps/web/src/
  main.tsx                                production composition root
  app.tsx                                 route tree composition only
  api.ts                                  same-origin SDK construction
  platform/
    data/query-client.ts                  safe query defaults and cache construction
    feedback/feedback-context.tsx         global notice/error including request ID
    modules/module-catalog.ts             complete product navigation and roadmap truth
    routing/route-paths.ts                 route builders and organization ID parsing
    session/session-context.tsx            restore/login/register/logout lifecycle
    shell/app-shell.tsx                    stable header/sidebar/content shell
    shell/navigation.tsx                   permission/status-aware navigation
    context/organization-context.tsx       current org, membership and scoped cancellation
  features/
    auth/login-page.tsx                    existing login/register UI
    account/account-page.tsx               phone verification and device management
    organization/home-page.tsx             organization home and creation entry
    organization/members-page.tsx          member list and admin-only add form
    audit/audit-page.tsx                   admin-only organization audit list
    roadmap/coming-soon-page.tsx           inert module explanation page
  test/
    fixtures.ts                            contract-shaped SDK fixtures
    render-app.tsx                         MemoryRouter/QueryClient test harness
  capability-surfaces.json                 capability-to-surface records, not bare IDs
  product-modules.json                     navigation catalog data
scripts/
  check-capability-coverage.mjs            validates real Web route/action/test evidence
  check-capability-coverage.self-test.mjs  real-shape negative fixtures
```

Existing `organizations/organization-switcher.tsx` and `devices/device-list.tsx` are moved into the matching feature modules or retained as focused children; they do not call the SDK directly.

### Task 1: Approve the design record and install platform dependencies

**Files:**
- Modify: `docs/superpowers/specs/2026-08-19-web-logic-and-architecture-design.md:5`
- Modify: `apps/web/package.json:12-17`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Mark the reviewed specification approved**

Change the status line to:

```markdown
> 状态：用户已于 2026-08-19 批准书面规格
```

- [ ] **Step 2: Add exact dependencies**

Run:

```bash
pnpm --filter @tashan/web add react-router@8.3.0 @tanstack/react-query@5.101.4
```

Expected: `apps/web/package.json` contains both exact versions and the lockfile records them.

- [ ] **Step 3: Verify dependency and baseline integrity**

Run:

```bash
pnpm --filter @tashan/web typecheck
pnpm --filter @tashan/web test
```

Expected: current 6 Web tests pass before refactoring.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-19-web-logic-and-architecture-design.md apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add routing and query foundations"
```

### Task 2: Create the product module catalog with fail-closed validation

**Files:**
- Create: `apps/web/src/product-modules.json`
- Create: `apps/web/src/platform/modules/module-catalog.ts`
- Create: `apps/web/src/platform/modules/module-catalog.test.ts`

- [ ] **Step 1: Write adversarial catalog tests first**

Create tests that construct three concrete failures before the happy path:

```ts
import { describe, expect, test } from "vitest";
import { parseProductModules } from "./module-catalog.js";

const base = {
  id: "organization.home",
  label: "组织首页",
  context: "organization",
  status: "available",
  route: "/org/:organizationId/home",
  capabilities: ["organization.list"],
};

describe("product module catalog", () => {
  test("rejects duplicate and nested-collision routes", () => {
    expect(() => parseProductModules([base, { ...base, id: "organization.copy" }])).toThrow(
      /duplicate module route/,
    );
  });

  test("rejects a coming-soon module with executable capabilities", () => {
    expect(() => parseProductModules([{ ...base, status: "coming_soon" }])).toThrow(
      /coming-soon modules cannot bind capabilities/,
    );
  });

  test("rejects an organization route without an organization segment", () => {
    expect(() => parseProductModules([{ ...base, route: "/tasks" }])).toThrow(
      /organization route must contain :organizationId/,
    );
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @tashan/web exec vitest run src/platform/modules/module-catalog.test.ts
```

Expected: FAIL because `module-catalog.ts` does not exist.

- [ ] **Step 3: Implement strict catalog parsing**

Use a Zod schema with these exact discriminants:

```ts
export const ProductModuleContext = z.enum(["global", "personal", "organization"]);
export const ProductModuleStatus = z.enum(["available", "coming_soon"]);
export const ProductModule = z.object({
  id: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/),
  label: z.string().trim().min(1).max(64),
  description: z.string().trim().min(1).max(240),
  context: ProductModuleContext,
  status: ProductModuleStatus,
  route: z.string().startsWith("/"),
  roles: z.array(z.enum(["org_owner", "org_admin", "member"])),
  capabilities: z.array(CapabilityId),
});
```

`parseProductModules` must reject duplicate IDs, duplicate normalized routes, `coming_soon` entries with capabilities, organization routes without `:organizationId`, and non-organization routes that contain that segment.

- [ ] **Step 4: Add the approved full navigation**

`product-modules.json` must include available modules for organization home, account/devices, organization members and organization audit. It must include inert `coming_soon` entries for my work, personal files/runtime/services/usage, and organization tasks/OKR/approvals/meetings/files/messages/runtime/services. Admin entries use roles `org_owner` and `org_admin`; ordinary organization modules include `member`.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @tashan/web exec vitest run src/platform/modules/module-catalog.test.ts
git add apps/web/src/product-modules.json apps/web/src/platform/modules
git commit -m "feat(web): add product module catalog"
```

Expected: catalog tests pass.

### Task 3: Build route, query and session foundations

**Files:**
- Create: `apps/web/src/platform/data/query-client.ts`
- Create: `apps/web/src/platform/routing/route-paths.ts`
- Create: `apps/web/src/platform/session/session-context.tsx`
- Create: `apps/web/src/platform/session/session-context.test.tsx`
- Create: `apps/web/src/platform/feedback/feedback-context.tsx`
- Create: `apps/web/src/test/fixtures.ts`
- Create: `apps/web/src/test/render-app.tsx`

- [ ] **Step 1: Write session rejection and cleanup tests**

The tests must cover these three breaking inputs:

```ts
test("shows restoring state instead of flashing the login form", async () => {
  const restore = deferred();
  const sdk = client({ refresh: vi.fn(() => restore.promise) });
  renderSession({ sdk });
  expect(screen.getByText("正在恢复安全会话…")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "登录组织空间" })).not.toBeInTheDocument();
  restore.reject(authRequired());
  expect(await screen.findByRole("heading", { name: "登录组织空间" })).toBeVisible();
});

test("never refreshes more than once during initial restoration", async () => {
  const sdk = client({ refresh: vi.fn().mockRejectedValue(authRequired()) });
  renderSession({ sdk });
  await screen.findByRole("heading", { name: "登录组织空间" });
  expect(sdk.refresh).toHaveBeenCalledOnce();
});

test("does not update state after unmount during restoration", async () => {
  const restore = deferred();
  const view = renderSession({ sdk: client({ refresh: vi.fn(() => restore.promise) }) });
  view.unmount();
  restore.resolve({});
  await expect(restore.promise).resolves.toEqual({});
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm --filter @tashan/web exec vitest run src/platform/session/session-context.test.tsx
```

Expected: FAIL because the provider and test harness do not exist.

- [ ] **Step 3: Implement shared foundations**

`createWebQueryClient()` must use safe defaults: queries retry at most once for network/5xx failures, never retry 401/403/409/429, mutations never retry automatically, and stale time defaults to zero for permission-sensitive Phase 0 data.

`route-paths.ts` must export builders that call the existing `OrganizationId` Zod schema before interpolation:

```ts
export const routes = {
  login: "/login",
  myWork: "/my-work",
  organizationHome: (organizationId: string) =>
    `/org/${encodeURIComponent(OrganizationId.parse(organizationId))}/home`,
  organizationMembers: (organizationId: string) =>
    `/org/${encodeURIComponent(OrganizationId.parse(organizationId))}/admin/members`,
  organizationAudit: (organizationId: string) =>
    `/org/${encodeURIComponent(OrganizationId.parse(organizationId))}/admin/audit`,
};
```

`SessionProvider` owns only account/session lifecycle and exposes `status: "restoring" | "anonymous" | "authenticated"`, `account`, `login`, `register`, `logout`, `verifyPhone`, and device metadata. It must not own organization selection.

`FeedbackProvider` exposes one global notice or one error. `OrgSpaceApiError` feedback includes `requestId`; unknown errors use a generic Chinese message and no fabricated ID.

- [ ] **Step 4: Run focused tests and commit**

```bash
pnpm --filter @tashan/web exec vitest run src/platform/session/session-context.test.tsx
pnpm --filter @tashan/web typecheck
git add apps/web/src/platform apps/web/src/test
git commit -m "feat(web): add session and data foundations"
```

Expected: focused tests and typecheck pass.

### Task 4: Implement organization-scoped routing and stale-response isolation

**Files:**
- Create: `apps/web/src/platform/context/organization-context.tsx`
- Create: `apps/web/src/platform/context/organization-context.test.tsx`
- Create: `apps/web/src/platform/routing/app-routes.tsx`
- Create: `apps/web/src/platform/routing/access-boundary.tsx`

- [ ] **Step 1: Write adversarial organization-boundary tests**

Tests must prove:

```ts
test("a slower old-organization response never replaces the selected organization", async () => {
  // Resolve org B first, then org A. The visible heading must remain org B.
});

test("a member cannot render an admin route by typing its URL", async () => {
  renderAt(`/org/${organizationId}/admin/audit`, { role: "member" });
  expect(await screen.findByText("你没有访问此页面的权限")).toBeVisible();
  expect(sdk.listAuditEvents).not.toHaveBeenCalled();
});

test("an organization ID absent from the membership list redirects safely", async () => {
  renderAt(`/org/${unknownOrganizationId}/home`);
  expect(await screen.findByText("无法访问该组织")).toBeVisible();
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm --filter @tashan/web exec vitest run src/platform/context/organization-context.test.tsx
```

Expected: FAIL because the organization provider and access boundary do not exist.

- [ ] **Step 3: Implement scoped queries and routing**

Organization queries use keys beginning with `['organization', organizationId]`; member and audit keys include their resource name after the ID. On route organization change, cancel queries matching the previous organization prefix before rendering the new child route.

Resolve the current role by loading `sdk.listMembers(organizationId)` and finding `membership.accountId === session.account.id`. The API remains the final authority. `AccessBoundary` must render no child and make no child data request until role resolution completes.

Use nested React Router routes. `/` redirects to the last accessible organization in local storage or the first organization. Validate that stored organization against `listOrganizations` before redirecting. Persist only the organization ID, never data or tokens.

- [ ] **Step 4: Run focused tests and commit**

```bash
pnpm --filter @tashan/web exec vitest run src/platform/context/organization-context.test.tsx
pnpm --filter @tashan/web typecheck
git add apps/web/src/platform/context apps/web/src/platform/routing
git commit -m "feat(web): isolate organization routes and state"
```

Expected: stale-response, unauthorized-route and unknown-organization tests pass.

### Task 5: Build the App Shell and complete navigation skeleton

**Files:**
- Create: `apps/web/src/platform/shell/app-shell.tsx`
- Create: `apps/web/src/platform/shell/navigation.tsx`
- Create: `apps/web/src/platform/shell/app-shell.test.tsx`
- Create: `apps/web/src/features/roadmap/coming-soon-page.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write navigation behavior tests**

```ts
test("shows the complete roadmap but hides admin modules from members", async () => {
  renderShell({ role: "member" });
  expect(screen.getByRole("link", { name: /任务.*即将上线/ })).toBeVisible();
  expect(screen.queryByRole("link", { name: "组织管理" })).not.toBeInTheDocument();
});

test("coming-soon pages are inert", async () => {
  renderAt(`/org/${organizationId}/tasks`, { role: "member" });
  expect(await screen.findByRole("heading", { name: "任务" })).toBeVisible();
  expect(screen.getByText("即将上线")).toBeVisible();
  expect(allMutationMocks()).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @tashan/web exec vitest run src/platform/shell/app-shell.test.tsx
```

Expected: FAIL because shell/navigation do not exist.

- [ ] **Step 3: Implement responsive shell**

Render global, personal, organization and admin groups from the parsed module catalog. Replace `:organizationId` only after validating the current organization. `coming_soon` links include visible text and an accessible status label. On narrow screens, navigation becomes a keyboard-operable drawer; content order and focus order remain logical.

`ComingSoonPage` accepts a catalog entry and renders only its label, description, status, and a back link. It imports neither the SDK nor mutation hooks.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @tashan/web exec vitest run src/platform/shell/app-shell.test.tsx
pnpm --filter @tashan/web build
git add apps/web/src/platform/shell apps/web/src/features/roadmap apps/web/src/styles.css
git commit -m "feat(web): add organization-first application shell"
```

Expected: shell tests and production build pass.

### Task 6: Migrate Phase 0 account, organization, member and audit surfaces

**Files:**
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/auth/login-page.tsx`
- Move/Modify: `apps/web/src/devices/device-list.tsx`
- Move/Modify: `apps/web/src/organizations/organization-switcher.tsx`
- Create: `apps/web/src/features/account/account-page.tsx`
- Create: `apps/web/src/features/organization/home-page.tsx`
- Create: `apps/web/src/features/organization/members-page.tsx`
- Create: `apps/web/src/features/audit/audit-page.tsx`
- Replace: `apps/web/src/app.test.tsx`

- [ ] **Step 1: Write route-level Phase 0 tests**

The route-level suite must retain all six existing behaviors and add:

```ts
test("an admin can list members and add a member with an idempotency key", async () => {
  renderAt(`/org/${organizationId}/admin/members`, { role: "org_admin" });
  await user.type(screen.getByLabelText("账号 ID"), targetAccountId);
  await user.selectOptions(screen.getByLabelText("组织角色"), "member");
  await user.click(screen.getByRole("button", { name: "添加成员" }));
  expect(sdk.addMember).toHaveBeenCalledWith(
    organizationId,
    { accountId: targetAccountId, role: "member" },
    expect.objectContaining({ idempotencyKey: expect.any(String) }),
  );
});

test("an admin can page organization audit events and copy a request ID", async () => {
  renderAt(`/org/${organizationId}/admin/audit`, { role: "org_owner" });
  expect(await screen.findByText("organization.create")).toBeVisible();
  expect(screen.getByText(requestId)).toBeVisible();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @tashan/web exec vitest run src/app.test.tsx
```

Expected: new route-level tests fail because pages are missing.

- [ ] **Step 3: Implement pages through SDK hooks**

Use SDK-returned contract types directly with `Awaited<ReturnType<OrgSpaceClient['method']>>`; do not recreate `AccountView`, `OrganizationView` or `DeviceView`.

All mutations use `web-<action>-<crypto.randomUUID()>` idempotency keys. Device revoke, member add, organization create and logout wait for API success before updating. Audit pagination passes `organizationId`, `cursor` and `limit: 25`; append only after a successful response and deduplicate by audit event ID.

The organization home renders real Phase 0 cards plus clearly labeled placeholders for future dashboard signals; it must not invent task counts, meetings or messages.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @tashan/web test
pnpm --filter @tashan/web typecheck
git add apps/web/src
git commit -m "feat(web): migrate phase zero workspace pages"
```

Expected: Web tests and typecheck pass.

### Task 7: Use same-origin API access with a safe local proxy

**Files:**
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `.env.example`
- Create: `apps/web/src/api.test.ts`

- [ ] **Step 1: Write safe-default tests**

```ts
test("production composition uses the browser origin", () => {
  expect(resolveWebApiOrigin({ origin: "https://orgspace.tashan.chat" })).toBe(
    "https://orgspace.tashan.chat",
  );
});

test("rejects credential-bearing or path-bearing overrides", () => {
  expect(() => resolveWebApiOrigin({ origin: "https://orgspace.tashan.chat", override: "https://u:p@example.com" })).toThrow();
  expect(() => resolveWebApiOrigin({ origin: "https://orgspace.tashan.chat", override: "https://example.com/v1" })).toThrow();
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @tashan/web exec vitest run src/api.test.ts
```

Expected: FAIL because `resolveWebApiOrigin` does not exist.

- [ ] **Step 3: Implement same-origin production and local proxy**

`main.tsx` passes `window.location.origin` to `createWebClient`. `vite.config.ts` proxies `/v1` to `PUBLIC_API_URL` only in development and defaults that target to `http://127.0.0.1:4110`. Validate the proxy target as an HTTP(S) origin without credentials, query, hash or non-root path. Remove the unused production-facing `VITE_TORG_API_URL` path.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @tashan/web exec vitest run src/api.test.ts
pnpm --filter @tashan/web build
git add apps/web/src/api.ts apps/web/src/api.test.ts apps/web/src/main.tsx apps/web/vite.config.ts .env.example
git commit -m "fix(web): use same-origin api access"
```

Expected: safe-default tests and build pass.

### Task 8: Upgrade the Web capability consistency gate

**Files:**
- Replace: `apps/web/src/capability-surfaces.json`
- Modify: `apps/web/src/capability-surfaces.ts`
- Modify: `scripts/check-capability-coverage.mjs`
- Modify: `scripts/check-capability-coverage.self-test.mjs`
- Modify: `packages/capabilities/src/phase0.ts`
- Modify: `packages/capabilities/src/phase0-capabilities.json`

- [ ] **Step 1: Extend the gate self-test with real-shape violations**

Use records shaped like:

```json
{
  "capabilityId": "device.revoke",
  "route": "/account",
  "action": "device-revoke",
  "test": "apps/web/src/app.test.tsx"
}
```

Add negative assertions for:

```ts
assert.throws(() => checkCoverage(server, cli, [], skill, files), /missing Web surface/);
assert.throws(() => checkCoverage(server, cli, [{ ...surface, route: "tasks" }], skill, files), /absolute Web route/);
assert.throws(() => checkCoverage(server, cli, [{ ...surface, test: "missing.test.tsx" }], skill, files), /missing Web test file/);
assert.throws(() => checkCoverage(server, cli, [surface, { ...surface, action: "device-revoke" }], skill, files), /duplicate Web action/);
```

- [ ] **Step 2: Run the self-test and verify RED**

```bash
node scripts/check-capability-coverage.self-test.mjs
```

Expected: FAIL because the gate still accepts only string IDs.

- [ ] **Step 3: Implement the stronger gate**

Validate unique capability IDs, routes and action IDs; absolute normalized routes; repository-relative test paths ending in `.test.ts` or `.test.tsx`; test file existence; and exact equality between server `web: required` capabilities and surface records. Keep all existing CLI and Skill checks.

Replace `CapabilitySurfaceList` with a strict `CapabilitySurface` object schema containing `capabilityId`, `route`, `action` and `test`, then export `CapabilitySurfaceList` as an array with duplicate capability/action refinement. The repository gate remains responsible for checking real file existence.

Change Phase 0 `organization.member.list`, `organization.member.add` and `audit.list` from `web: deferred` to `web: required` only after their real pages and tests exist.

- [ ] **Step 4: Prove the gate and all self-tests**

```bash
node scripts/check-capability-coverage.self-test.mjs
node scripts/check-capability-coverage.mjs
node scripts/check-gate-self-tests.mjs
```

Expected: all three commands print `PASS`; the capability count remains 17.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/capability-surfaces.json apps/web/src/capability-surfaces.ts scripts/check-capability-coverage.mjs scripts/check-capability-coverage.self-test.mjs packages/capabilities/src/phase0.ts packages/capabilities/src/phase0-capabilities.json
git commit -m "ci(web): verify routes actions and tests"
```

### Task 9: Full verification and implementation evidence

**Files:**
- Create: `docs/verification/2026-08-19-web-platform-foundation.md`

- [ ] **Step 1: Run the complete repository verifier**

```bash
bash scripts/verify-phase0.sh
```

Expected: toolchain, formatting, lint, typecheck, unit tests, capability coverage and all gate self-tests pass.

- [ ] **Step 2: Run the Web production build and inspect output**

```bash
pnpm --filter @tashan/web build
find apps/web/dist -maxdepth 2 -type f -print | sort
```

Expected: build succeeds and emits `apps/web/dist/index.html` plus versioned assets.

- [ ] **Step 3: Run targeted negative self-tests again**

```bash
node scripts/check-capability-coverage.self-test.mjs
pnpm --filter @tashan/web exec vitest run \
  src/platform/modules/module-catalog.test.ts \
  src/platform/session/session-context.test.tsx \
  src/platform/context/organization-context.test.tsx \
  src/platform/shell/app-shell.test.tsx \
  src/api.test.ts
```

Expected: all rejection cases pass.

- [ ] **Step 4: Record evidence without claiming deployment**

The verification document must separate:

- static/type/lint evidence;
- unit and rejection-test evidence;
- capability gate and self-test evidence;
- build artifact evidence;
- explicitly unrun PostgreSQL/Redis E2E, browser visual acceptance and production/AUP deployment.

- [ ] **Step 5: Commit verification evidence**

```bash
git add docs/verification/2026-08-19-web-platform-foundation.md
git commit -m "docs(verification): record web platform checks"
```

### Task 10: Review the branch without merging or pushing

**Files:** none

- [ ] **Step 1: Inspect the complete diff and history**

```bash
git status --short --branch
git log --oneline --decorate main..HEAD
git diff --stat main...HEAD
git diff --check main...HEAD
```

Expected: clean worktree, only planned Web/platform/docs/gate changes, and no whitespace errors.

- [ ] **Step 2: Confirm forbidden production scope is absent**

```bash
git diff --name-only main...HEAD | rg '^(deploy/|services/|\.github/workflows/release)' && exit 1 || true
```

Expected: no output.

- [ ] **Step 3: Stop and report for review**

Do not merge, push, deploy, or alter AUP. Report the branch path, commits, validation layers and remaining unverified layers to the user.
