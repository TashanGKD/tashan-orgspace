# Defer Compute and User Web Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove compute execution and user website hosting from the current/v1 implementation scope while keeping their four product modules visible in a dedicated navigation group as inert `coming_soon` destinations.

**Architecture:** A machine-readable deferred-scope registry is the source of truth for the four visible future modules and forbidden capability prefixes. Web navigation reads that registry, while a fail-closed gate checks module status, capability absence, Coming Soon routing and canonical-document markers across backend, Web, CLI and Skill. Current product documents are rewritten around collaboration and files; historical compute/service design is retained only as explicitly superseded context.

**Tech Stack:** JSON, TypeScript 6, React 19, Zod 4, Node.js gate scripts, Vitest, Testing Library, Markdown, pnpm, existing Phase 0 verifier.

---

## Source evidence

- `apps/web/src/product-modules.json` already contains `personal.runtime`, `personal.services`, `organization.runtime` and `organization.services` as `coming_soon` modules with empty capabilities.
- `apps/web/src/platform/modules/module-catalog.ts` already rejects any `coming_soon` module that binds a capability.
- `apps/web/src/app.tsx` maps all organization `coming_soon` modules to `ComingSoonPage`; `ComingSoonPage` contains no action or form.
- Desktop `Navigation` currently filters these four modules out; mobile More already shows all visible modules and marks `coming_soon` entries.
- No `runtime.*`, `build.*`, `service.*` or `database.*` capability exists in the current 17-capability registry, CLI bindings or Skill references.
- Canonical design and delivery documents still describe compute, builds, services, databases, daemons and user domains as current v1 work.

## Target file structure

```text
apps/web/src/
  deferred-product-scope.json        # deferred scope source of truth
  product-modules.json               # visible inert modules
  platform/modules/module-catalog.ts # typed registry export
  platform/shell/navigation.tsx      # desktop Future group
scripts/
  check-deferred-product-scope.mjs
  check-deferred-product-scope.self-test.mjs
docs/superpowers/specs/
  2026-08-28-defer-compute-and-user-web-deployment-design.md
docs/verification/
  deferred-product-scope.md
```

### Task 1: Add the deferred-scope registry and fail-closed gate

**Files:**
- Create: `apps/web/src/deferred-product-scope.json`
- Create: `scripts/check-deferred-product-scope.mjs`
- Create: `scripts/check-deferred-product-scope.self-test.mjs`
- Modify: `scripts/verify-phase0.sh`
- Modify: `scripts/verify-phase0.self-test.sh`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md`
- Modify: `docs/superpowers/specs/2026-08-26-full-product-frontend-blueprint.md`
- Modify: `docs/superpowers/plans/2026-08-26-full-product-delivery.md`

- [ ] **Step 1: Create the deferred-scope registry**

Create `apps/web/src/deferred-product-scope.json` exactly as:

```json
{
  "decisionId": "defer-compute-and-user-web-deployment-2026-08-28",
  "status": "deferred_visible",
  "moduleIds": [
    "personal.runtime",
    "personal.services",
    "organization.runtime",
    "organization.services"
  ],
  "requiredModuleStatus": "coming_soon",
  "forbiddenCapabilityPrefixes": [
    "runtime.",
    "run.",
    "build.",
    "service.",
    "database.",
    "domain.",
    "deployment."
  ],
  "requiredDocumentMarker": "<!-- DEFERRED_PRODUCT_SCOPE: general-compute,user-web-hosting -->"
}
```

Add this exact marker near the top of every document read by the production gate:

```md
<!-- DEFERRED_PRODUCT_SCOPE: general-compute,user-web-hosting -->
```

The four files are `README.md`, the 2026-08-18 total design, the 2026-08-26 frontend blueprint and the 2026-08-26 full-product delivery plan. Task 3–6 will rewrite their semantics; adding the marker here ensures the new gate can be wired without leaving the repository verifier broken between commits.

- [ ] **Step 2: Write the RED gate self-test**

Create `scripts/check-deferred-product-scope.self-test.mjs`. It imports `checkDeferredProductScope`, loads current registry data, constructs a minimal valid fixture and verifies these failures independently:

```js
import { strict as assert } from "node:assert";

import { checkDeferredProductScope } from "./check-deferred-product-scope.mjs";

const scope = {
  decisionId: "defer-compute-and-user-web-deployment-2026-08-28",
  status: "deferred_visible",
  moduleIds: [
    "personal.runtime",
    "personal.services",
    "organization.runtime",
    "organization.services",
  ],
  requiredModuleStatus: "coming_soon",
  forbiddenCapabilityPrefixes: [
    "runtime.",
    "run.",
    "build.",
    "service.",
    "database.",
    "domain.",
    "deployment.",
  ],
  requiredDocumentMarker: "<!-- DEFERRED_PRODUCT_SCOPE: general-compute,user-web-hosting -->",
};

const moduleFor = (id) => ({
  id,
  status: "coming_soon",
  capabilities: [],
  route: id.startsWith("organization.")
    ? `/org/:organizationId/${id.split(".")[1]}`
    : `/personal/${id.split(".")[1]}`,
});

const valid = {
  scope,
  modules: scope.moduleIds.map(moduleFor),
  serverCapabilities: [{ id: "organization.list" }],
  cliBindings: { "organization.list": ["organization", "list"] },
  skillCapabilities: ["organization.list"],
  appSource: 'comingSoon.map((module) => <ComingSoonPage module={module} />)',
  documents: {
    "README.md": scope.requiredDocumentMarker,
    "design.md": scope.requiredDocumentMarker,
    "frontend.md": scope.requiredDocumentMarker,
    "delivery.md": scope.requiredDocumentMarker,
  },
};

const clone = (value) => structuredClone(value);

assert.deepEqual(checkDeferredProductScope(valid), {
  deferredModules: 4,
  documents: 4,
  violations: 0,
});

const availableModule = clone(valid);
availableModule.modules[0].status = "available";
assert.throws(
  () => checkDeferredProductScope(availableModule),
  /deferred module must remain coming_soon: personal.runtime/,
);

const boundModule = clone(valid);
boundModule.modules[1].capabilities = ["service.create"];
assert.throws(
  () => checkDeferredProductScope(boundModule),
  /deferred module cannot bind capabilities: personal.services/,
);

const serverCapability = clone(valid);
serverCapability.serverCapabilities.push({ id: "runtime.submit" });
assert.throws(
  () => checkDeferredProductScope(serverCapability),
  /deferred capability entered server registry: runtime.submit/,
);

const cliCapability = clone(valid);
cliCapability.cliBindings["service.create"] = ["service", "create"];
assert.throws(
  () => checkDeferredProductScope(cliCapability),
  /deferred capability entered CLI bindings: service.create/,
);

const skillCapability = clone(valid);
skillCapability.skillCapabilities.push("database.create");
assert.throws(
  () => checkDeferredProductScope(skillCapability),
  /deferred capability entered Skill references: database.create/,
);

const missingMarker = clone(valid);
missingMarker.documents["README.md"] = "current product copy";
assert.throws(
  () => checkDeferredProductScope(missingMarker),
  /missing deferred scope marker: README.md/,
);

const wrongRoute = clone(valid);
wrongRoute.appSource = "const comingSoon = [];";
assert.throws(
  () => checkDeferredProductScope(wrongRoute),
  /coming-soon routes are not bound to ComingSoonPage/,
);

console.log("check-deferred-product-scope.self-test: PASS");
```

- [ ] **Step 3: Run the RED self-test**

Run:

```bash
node scripts/check-deferred-product-scope.self-test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` because the production gate does not exist.

- [ ] **Step 4: Implement the gate**

Create `scripts/check-deferred-product-scope.mjs` with two entry points:

```js
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isDeferredCapability(scope, capabilityId) {
  return scope.forbiddenCapabilityPrefixes.some((prefix) => capabilityId.startsWith(prefix));
}

export function checkDeferredProductScope({
  appSource,
  cliBindings,
  documents,
  modules,
  scope,
  serverCapabilities,
  skillCapabilities,
}) {
  if (scope.status !== "deferred_visible") throw new Error("invalid deferred scope status");
  if (!Array.isArray(scope.moduleIds) || scope.moduleIds.length !== 4) {
    throw new Error("deferred scope must contain exactly four module IDs");
  }
  if (new Set(scope.moduleIds).size !== scope.moduleIds.length) {
    throw new Error("duplicate deferred module ID");
  }

  const byId = new Map(modules.map((module) => [module.id, module]));
  for (const moduleId of scope.moduleIds) {
    const module = byId.get(moduleId);
    if (module === undefined) throw new Error(`missing deferred module: ${moduleId}`);
    if (module.status !== scope.requiredModuleStatus) {
      throw new Error(`deferred module must remain coming_soon: ${moduleId}`);
    }
    if (!Array.isArray(module.capabilities) || module.capabilities.length !== 0) {
      throw new Error(`deferred module cannot bind capabilities: ${moduleId}`);
    }
  }

  for (const { id } of serverCapabilities) {
    if (isDeferredCapability(scope, id)) {
      throw new Error(`deferred capability entered server registry: ${id}`);
    }
  }
  for (const id of Object.keys(cliBindings)) {
    if (isDeferredCapability(scope, id)) {
      throw new Error(`deferred capability entered CLI bindings: ${id}`);
    }
  }
  for (const id of skillCapabilities) {
    if (isDeferredCapability(scope, id)) {
      throw new Error(`deferred capability entered Skill references: ${id}`);
    }
  }
  if (!appSource.includes("comingSoon.map") || !appSource.includes("ComingSoonPage")) {
    throw new Error("coming-soon routes are not bound to ComingSoonPage");
  }
  for (const [path, content] of Object.entries(documents)) {
    if (!content.includes(scope.requiredDocumentMarker)) {
      throw new Error(`missing deferred scope marker: ${path}`);
    }
  }
  return {
    deferredModules: scope.moduleIds.length,
    documents: Object.keys(documents).length,
    violations: 0,
  };
}

export function checkRepositoryDeferredProductScope(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const scope = readJson(resolve(root, "apps/web/src/deferred-product-scope.json"));
  return checkDeferredProductScope({
    scope,
    modules: readJson(resolve(root, "apps/web/src/product-modules.json")),
    serverCapabilities: readJson(
      resolve(root, "packages/capabilities/src/phase0-capabilities.json"),
    ),
    cliBindings: readJson(resolve(root, "apps/cli/src/capability-bindings.json")),
    skillCapabilities: readJson(
      resolve(root, "skill/tashan-orgspace/capability-references.json"),
    ).capabilities,
    appSource: readFileSync(resolve(root, "apps/web/src/app.tsx"), "utf8"),
    documents: Object.fromEntries(
      [
        "README.md",
        "docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md",
        "docs/superpowers/specs/2026-08-26-full-product-frontend-blueprint.md",
        "docs/superpowers/plans/2026-08-26-full-product-delivery.md",
      ].map((path) => [path, readFileSync(resolve(root, path), "utf8")]),
    ),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = checkRepositoryDeferredProductScope(root);
  console.log(
    `check-deferred-product-scope: PASS (${result.violations} violations, ${result.deferredModules} deferred modules, ${result.documents} documents)`,
  );
}
```

- [ ] **Step 5: Run the gate and self-test GREEN**

Run:

```bash
node scripts/check-deferred-product-scope.mjs
node scripts/check-deferred-product-scope.self-test.mjs
```

Expected: both print `PASS`; production gate reports 4 deferred modules and 4 documents.

- [ ] **Step 6: Wire the gate into the complete verifier**

Add these exact steps to `scripts/verify-phase0.sh` before gate discovery:

```bash
run_step "node scripts/check-deferred-product-scope.mjs" node scripts/check-deferred-product-scope.mjs
run_step "node scripts/check-deferred-product-scope.self-test.mjs" node scripts/check-deferred-product-scope.self-test.mjs
```

Add both literal command strings to the `required_step` loop in `scripts/verify-phase0.self-test.sh`. Run:

```bash
node scripts/check-gate-self-tests.mjs
bash scripts/verify-phase0.self-test.sh
```

Expected: gate discovery reports 17 gates; verifier self-test passes.

- [ ] **Step 7: Commit the registry and gate**

```bash
git add apps/web/src/deferred-product-scope.json scripts/check-deferred-product-scope.mjs scripts/check-deferred-product-scope.self-test.mjs scripts/verify-phase0.sh scripts/verify-phase0.self-test.sh README.md docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md docs/superpowers/specs/2026-08-26-full-product-frontend-blueprint.md docs/superpowers/plans/2026-08-26-full-product-delivery.md
git commit -m "ci(product): enforce deferred product scope"
```

### Task 2: Keep deferred modules visible and inert

**Files:**
- Modify: `apps/web/src/platform/modules/module-catalog.ts`
- Modify: `apps/web/src/platform/modules/module-catalog.test.ts`
- Modify: `apps/web/src/platform/shell/navigation.tsx`
- Modify: `apps/web/src/platform/shell/app-shell.test.tsx`
- Modify: `apps/web/src/platform/shell/workspace-shell.test.tsx`
- Modify: `apps/web/src/design-system/workspace-shell.css`
- Modify: `apps/web/src/product-modules.json`

- [ ] **Step 1: Write RED registry and navigation tests**

In `module-catalog.test.ts`, load the real registry and catalog and add:

```ts
import deferredScope from "../../deferred-product-scope.json" with { type: "json" };
import modules from "../../product-modules.json" with { type: "json" };

test("keeps every deferred direction visible but inert", () => {
  const catalog = parseProductModules(modules);
  for (const moduleId of deferredScope.moduleIds) {
    const module = catalog.find((candidate) => candidate.id === moduleId);
    expect(module?.status).toBe("coming_soon");
    expect(module?.capabilities).toEqual([]);
  }
});
```

In `app-shell.test.tsx`, add a member navigation assertion:

```tsx
test("shows deferred directions in a separate future group", () => {
  render(
    <MemoryRouter>
      <Navigation organizationId={organizationId} role="member" />
    </MemoryRouter>,
  );
  const future = screen.getByRole("region", { name: "未来能力" });
  expect(within(future).getByRole("link", { name: "个人运行与构建 即将上线" })).toBeVisible();
  expect(within(future).getByRole("link", { name: "个人服务与数据库 即将上线" })).toBeVisible();
  expect(within(future).getByRole("link", { name: "运行与构建 即将上线" })).toBeVisible();
  expect(within(future).getByRole("link", { name: "服务与数据库 即将上线" })).toBeVisible();
});
```

Import `within` from Testing Library.

- [ ] **Step 2: Run RED navigation tests**

Run:

```bash
pnpm --filter @tashan/web test -- module-catalog.test.ts app-shell.test.tsx
```

Expected: registry test passes against current JSON; navigation test fails because desktop navigation omits the future group.

- [ ] **Step 3: Export the deferred module IDs from the typed catalog**

In `module-catalog.ts`, import and validate the scope:

```ts
import rawDeferredScope from "../../deferred-product-scope.json" with { type: "json" };

const DeferredProductScope = z
  .object({
    decisionId: z.literal("defer-compute-and-user-web-deployment-2026-08-28"),
    status: z.literal("deferred_visible"),
    moduleIds: z.array(z.string()).length(4),
    requiredModuleStatus: z.literal("coming_soon"),
    forbiddenCapabilityPrefixes: z.array(z.string().min(1)),
    requiredDocumentMarker: z.string().min(1),
  })
  .strict();

export const deferredProductScope = DeferredProductScope.parse(rawDeferredScope);
export const deferredModuleIds = new Set(deferredProductScope.moduleIds);
```

After parsing modules, assert each deferred ID exists, is `coming_soon` and has no capabilities. This duplicates no values: it reads the same registry used by the CI gate.

- [ ] **Step 4: Add the desktop Future group**

Update `ModuleLink` to accept `showComingSoon` and expose an accessible name containing the state only for the future group:

```tsx
function ModuleLink({ collapsed, module, organizationId, showComingSoon = false }: {
  collapsed: boolean;
  module: ProductModule;
  organizationId: string;
  showComingSoon?: boolean;
}) {
  const Icon = moduleIcons[module.id] ?? FileText;
  const label = showComingSoon ? `${module.label} 即将上线` : module.label;
  return (
    <NavLink aria-label={label} title={collapsed ? label : undefined} to={moduleHref(module, organizationId)}>
      <Icon aria-hidden className="navigation-icon" size={16} />
      {collapsed ? null : <span>{module.label}</span>}
      {showComingSoon && !collapsed ? <small>即将上线</small> : null}
    </NavLink>
  );
}
```

Add a third group after “设置与管理”:

```ts
{
  label: "未来能力",
  items: visible.filter((module) => deferredModuleIds.has(module.id)),
  showComingSoon: true,
}
```

Add `showComingSoon: false` to the other groups and pass the flag to `ModuleLink`. Do not add any other `coming_soon` module to this group.

- [ ] **Step 5: Style the state label without restoring navigation noise**

Add to `workspace-shell.css`:

```css
.workspace-sidebar .workspace-navigation a small {
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: 0.62rem;
  font-weight: 600;
  white-space: nowrap;
}

.workspace-sidebar[data-collapsed="true"] .workspace-navigation a small {
  display: none;
}
```

Do not add status labels to tasks, files, messages or other strategic primary entries.

- [ ] **Step 6: Update user-facing descriptions without claiming implementation**

Keep all four module IDs, routes, `status: "coming_soon"` and empty capabilities. Change only descriptions to avoid active verbs:

```json
"personal.runtime": "未来用于个人运行与构建",
"personal.services": "未来用于个人服务、数据库和网站部署",
"organization.runtime": "未来用于组织运行与构建",
"organization.services": "未来用于组织服务、数据库和网站部署"
```

Change `personal.overview` to `查看个人文件、存储用量和未来能力` and `personal.usage` to `查看个人存储用量`.

- [ ] **Step 7: Run GREEN Web tests and build**

Run:

```bash
pnpm --filter @tashan/web test
pnpm --filter @tashan/web typecheck
pnpm --filter @tashan/web build
node scripts/check-deferred-product-scope.mjs
```

Expected: all pass; navigation test finds exactly four future directions, and the gate still reports empty capabilities.

- [ ] **Step 8: Commit the inert navigation**

```bash
git add apps/web/src/deferred-product-scope.json apps/web/src/product-modules.json apps/web/src/platform/modules apps/web/src/platform/shell apps/web/src/design-system/workspace-shell.css
git commit -m "feat(web): show deferred product directions"
```

### Task 3: Rewrite the canonical product definition and architecture

**Files:**
- Modify: `docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md`
- Modify: `docs/superpowers/specs/2026-08-19-public-control-plane-sequencing.md`

- [ ] **Step 1: Preserve the deferred-scope marker and add the supersession note**

The total design already received this marker in Task 1; verify it remains. Add the same marker near the top of public-control-plane sequencing:

```md
<!-- DEFERRED_PRODUCT_SCOPE: general-compute,user-web-hosting -->
```

In the total design add:

```md
> 2026-08-28 范围更新：通用计算执行和用户网站/服务托管不属于当前实现或 v1 验收范围；相关方向保留在导航并标记“即将上线”。本更新以 `2026-08-28-defer-compute-and-user-web-deployment-design.md` 为准。
```

- [ ] **Step 2: Change the product definition and principles**

Replace “协作与安全计算平台” with “组织协作与文件平台”. Remove server resource management from the one-line definition. In the four-part loop, change “程序和服务执行” to “任务、审批和组织流程推进”.

Remove active principles for workload paths and public egress. Keep default safety, audit, CLI parity and future AI extensibility.

- [ ] **Step 3: Rewrite v1 scope and subsystem list**

Delete compute/build/service/database/domain items from `3.1 v1 业务范围`. Add this subsection immediately after v1 non-goals:

```md
### 3.3 延期但导航可见

- 个人与组织“运行与构建”；
- 个人与组织“服务与数据库”，包括用户网站部署；
- 代码执行、Docker 构建、批处理、数据库、daemon、用户服务域名和 `service public`。

这些模块只显示“即将上线”，不属于当前实施阶段、capability、CLI/Skill 或 v1 验收。
```

Renumber the following subsection and remove runtime/dynamic service entries from the active independent-spec sequence.

- [ ] **Step 4: Remove compute assumptions from active roles, objects and infrastructure**

Make these exact conceptual changes:

- `platform_superadmin` no longer mentions elastic compute;
- `member` no longer receives compute usage rights;
- file security no longer discusses runtime mounts;
- the unified object list omits runs, services and databases;
- current architecture tree omits Go `gateway` for user services and `executor`;
- S3 stores collaborative files and versions, not build artifacts;
- Docker Compose and Nginx remain platform deployment infrastructure;
- platform gateway means the existing OrgSpace Web/API gateway, not dynamic user-service routing.

- [ ] **Step 5: Replace the detailed compute/service chapter with a deferred record**

Replace the active compute, resource-pool, service-domain and `service public` chapters with:

```md
## 11. 延期方向：计算执行与用户网站托管

本方向不属于当前实现或 v1 验收。导航保留四个 `coming_soon` 模块，用于展示长期方向；当前不定义 RuntimeWorkload、Build、Service、DatabaseService、Daemon、ServiceDomain 或 ServicePublication，也不建设用户 Executor、BuildKit、动态服务路由或 `service public`。

OrgSpace 自身继续使用 AUP、Docker Compose、Nginx、PostgreSQL 和 Redis。平台自身部署不等于向用户提供计算、数据库或网站托管产品。

历史计算与服务设计由 `2026-08-28-defer-compute-and-user-web-deployment-design.md` 取代。未来重新启用必须重新完成设计、威胁模型、能力注册和用户确认。
```

- [ ] **Step 6: Update public-control-plane sequencing**

Keep Phase 0 public user access, AUP/ECS ingress and distribution. Replace the secure-compute and dynamic-user-service phases with one deferred section using the same marker and explicitly state that existing gateway only serves OrgSpace itself.

Do not delete production paths, tunnel ports, TLS, backup or secret rules used by the current platform.

- [ ] **Step 7: Validate canonical wording and commit**

Run:

```bash
rg -n "v1.*(Python|Docker 构建|数据库|daemon|service public)|当前.*(RuntimeWorkload|Executor|BuildKit)" docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md docs/superpowers/specs/2026-08-19-public-control-plane-sequencing.md
node scripts/check-deferred-product-scope.mjs
git diff --check
```

Expected: the grep returns no active-scope matches; the gate passes.

Commit:

```bash
git add docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md docs/superpowers/specs/2026-08-19-public-control-plane-sequencing.md
git commit -m "docs(product): narrow the active product scope"
```

### Task 4: Align Web architecture and frontend blueprint

**Files:**
- Modify: `docs/superpowers/specs/2026-08-19-web-logic-and-architecture-design.md`
- Modify: `docs/superpowers/specs/2026-08-26-full-product-frontend-blueprint.md`
- Modify: `docs/superpowers/specs/2026-08-28-homepage-v2-workbench-visual-system.md`

- [ ] **Step 1: Add deferral markers and current-scope statements**

Add the exact marker to the Web architecture and frontend blueprint:

```md
<!-- DEFERRED_PRODUCT_SCOPE: general-compute,user-web-hosting -->
```

State that routes for deferred modules exist only to render Coming Soon pages and are not API contracts.

- [ ] **Step 2: Simplify the Web dependency and route diagrams**

In Web architecture:

- remove `AUP Runtime`, user database and service gateway from Web-facing backend dependencies;
- keep PostgreSQL/Redis/object storage as internal platform/file dependencies;
- keep `/personal/runtime`, `/personal/services`, `/org/:organizationId/runtime` and `/org/:organizationId/services` only in a “visible deferred routes” block;
- remove real feature-flow steps for build, runtime, database, domain and service publication.

The deferred route block must say:

```text
Visible deferred routes → ComingSoonPage only → no capability → no write request
```

- [ ] **Step 3: Replace detailed compute/service wireframes**

In the frontend blueprint, replace runtime, service, database, domain and `service public` screens with one shared wireframe:

```text
┌──────────────────────────────────────────────────────────────┐
│ 运行与构建 / 服务与数据库                                   │
│ 未来产品方向                                                 │
├──────────────────────────────────────────────────────────────┤
│                         即将上线                             │
│                    此功能暂未开放                            │
│                    [ 返回组织首页 ]                          │
└──────────────────────────────────────────────────────────────┘
```

Remove CPU/memory pool cards, deployment forms, service-public actions and domain status from the approved core-screen set.

- [ ] **Step 4: Update the visual-system future-surface references**

Change “file/runtime/service management” to “file and organization-management surfaces”. State that deferred modules reuse the branded Coming Soon state and do not need separate operational components.

- [ ] **Step 5: Verify and commit the Web documents**

Run:

```bash
rg -n "service public|用户计算池|Docker 构建|AUP Runtime" docs/superpowers/specs/2026-08-19-web-logic-and-architecture-design.md docs/superpowers/specs/2026-08-26-full-product-frontend-blueprint.md docs/superpowers/specs/2026-08-28-homepage-v2-workbench-visual-system.md
node scripts/check-deferred-product-scope.mjs
git diff --check
```

Expected: any remaining matches occur only in clearly labeled deferred/history paragraphs.

Commit:

```bash
git add docs/superpowers/specs/2026-08-19-web-logic-and-architecture-design.md docs/superpowers/specs/2026-08-26-full-product-frontend-blueprint.md docs/superpowers/specs/2026-08-28-homepage-v2-workbench-visual-system.md
git commit -m "docs(web): reduce deferred modules to state pages"
```

### Task 5: Rewrite the full-product delivery plan and release train

**Files:**
- Modify: `docs/superpowers/plans/2026-08-26-full-product-delivery.md`

- [ ] **Step 1: Preserve the marker and update the plan header**

Verify the exact deferral marker added in Task 1 remains. Change the architecture paragraph to specialized data planes for files and chat only. Remove S3 build artifacts and Docker/BuildKit from the user-feature tech stack; retain Docker Compose and Nginx as platform deployment tools.

- [ ] **Step 2: Remove compute and hosting implementation tasks**

Delete the executable checklists and file lists under current Task 6 and Task 7. Replace them with a non-checklist section:

```md
### Deferred directions: compute execution and user web deployment

The navigation retains four inert `coming_soon` modules. This plan does not create runtime, build, service, database, daemon, domain or public-access contracts, migrations, APIs, CLI commands, Skill references or acceptance journeys. Re-entry requires a newly approved design and plan.
```

Renumber chat, global work and v1 closure tasks so the active task sequence is contiguous.

- [ ] **Step 3: Update v1 closure acceptance**

Remove compute, services, domains and workload recovery from synthetic and production acceptance. The complete synthetic journey must cover:

```text
auth → organizations → files → work/process → OKR → notifications/SMS → chat → search/admin → device/session revocation → audit
```

Production recovery retains AUP backup, database restore, tunnel/gateway, file storage, SMS carrier and public Skill/CLI installation checks.

- [ ] **Step 4: Rewrite the release train**

Use:

```text
Phase 0  已上线：身份 / 组织 / 设备 / 审计 / 公网安装
Phase 1  通用工作台 + 空间 / 文件
Phase 2  WorkItem / 审批 / 会议 / OKR
Phase 3  通知 / 短信 / 定时提醒
Phase 4  对话 / 搜索 / 全局工作 / 管理
Phase 5  全面一致性 / 恢复 / 安全 / v1 验收

Deferred  计算 / 构建 / 用户网站 / 服务 / 数据库 / daemon / 用户域名
```

- [ ] **Step 5: Verify no active checklist remains for deferred work**

Run:

```bash
rg -n "^- \[ \].*(执行器|Docker|BuildKit|service public|数据库|daemon|用户域名)" docs/superpowers/plans/2026-08-26-full-product-delivery.md
node scripts/check-deferred-product-scope.mjs
```

Expected: the grep returns no matches and the gate passes.

- [ ] **Step 6: Commit the revised delivery plan**

```bash
git add docs/superpowers/plans/2026-08-26-full-product-delivery.md
git commit -m "docs(plan): defer compute and hosting phases"
```

### Task 6: Align README, Skill safety and Phase 0 boundaries

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/phase0-security-foundation.md`
- Modify: `skill/tashan-orgspace/references/safety.md`
- Modify: `docs/superpowers/specs/2026-08-26-reliable-cli-skill-distribution-design.md`

- [ ] **Step 1: Update README and preserve the marker**

Verify the exact marker added in Task 1 remains and change the product description to “独立的组织协作与文件平台”. Replace the current missing-scope paragraph with:

```md
文件空间、OKR/任务、审批、通知短信和聊天仍待实现。运行与构建、用户网站、服务、数据库、daemon 和用户域名作为延期方向保留在导航并标记“即将上线”，不属于当前实现或 v1 验收。
```

Keep AUP deployment, alpha.3, installer and public release statements unchanged.

- [ ] **Step 2: Update architecture and distribution boundaries**

In `phase0-security-foundation.md`, separate “future active product phases” from “visible deferred directions”. Do not claim AUP production deployment is future; it already exists.

In Skill safety, state that the CLI exposes no compute, service, database, daemon, domain or site-deployment commands while the scope is deferred. Keep general warnings about capabilities actually present.

In reliable-distribution design, replace “本轮不实现” with “延期能力仅保留 Coming Soon 导航，不进入发布 capability”.

- [ ] **Step 3: Run source-wide scope checks**

Run:

```bash
rg -n "协作与安全计算平台|v1.*(Python|Docker 构建|数据库|daemon)|当前.*service public" README.md docs/architecture/phase0-security-foundation.md docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md docs/superpowers/specs/2026-08-19-public-control-plane-sequencing.md docs/superpowers/specs/2026-08-19-web-logic-and-architecture-design.md docs/superpowers/specs/2026-08-26-full-product-frontend-blueprint.md docs/superpowers/specs/2026-08-26-reliable-cli-skill-distribution-design.md docs/superpowers/specs/2026-08-28-homepage-v2-workbench-visual-system.md skill/tashan-orgspace/references/safety.md
node scripts/check-deferred-product-scope.mjs
git diff --check
```

Expected: no active-scope claim remains; historical matches are explicitly labeled deferred or superseded.

- [ ] **Step 4: Commit supporting documentation**

```bash
git add README.md docs/architecture/phase0-security-foundation.md skill/tashan-orgspace/references/safety.md docs/superpowers/specs/2026-08-26-reliable-cli-skill-distribution-design.md
git commit -m "docs(scope): align product and distribution boundaries"
```

### Task 7: Complete automated and browser acceptance

**Files:**
- Create: `docs/verification/deferred-product-scope.md`
- Modify: `docs/superpowers/plans/2026-08-28-defer-compute-and-user-web-deployment.md`

- [ ] **Step 1: Run complete automated verification**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
node scripts/check-deferred-product-scope.mjs
node scripts/check-deferred-product-scope.self-test.mjs
ORGSPACE_TEST_CLEANUP_VOLUMES=1 bash scripts/verify-phase0.sh
```

Expected: all pass; gate discovery reports 17 gates; production stack and E2E remain green.

- [ ] **Step 2: Run browser acceptance for every deferred entry**

Start the isolated loopback production stack. At 1440px and 390px:

1. log in with a synthetic account;
2. verify desktop “未来能力” contains the four deferred links and visible `即将上线` labels;
3. verify mobile More contains the same four entries;
4. open each deferred route;
5. verify one heading, `即将上线`, `此功能暂未开放`, and return navigation;
6. verify there is no form, mutation button, upload control, terminal, log stream, domain, database credential or public/private action;
7. verify no horizontal overflow and visible keyboard focus.

- [ ] **Step 3: Record verification evidence**

Create `docs/verification/deferred-product-scope.md` with:

- exact verified commit;
- automated counts and final `verify-phase0: PASS` output;
- four deferred module IDs and routes;
- browser widths and screenshot paths;
- explicit proof that capabilities, CLI bindings and Skill references remain absent;
- distinction between OrgSpace's own AUP deployment and deferred user hosting;
- any remaining non-blocking debt.

- [ ] **Step 4: Mark plan boxes and commit acceptance**

Mark every completed checkbox in this plan, run `git diff --check`, then:

```bash
git add docs/verification/deferred-product-scope.md docs/superpowers/plans/2026-08-28-defer-compute-and-user-web-deployment.md
git commit -m "docs(verification): record deferred scope acceptance"
```
