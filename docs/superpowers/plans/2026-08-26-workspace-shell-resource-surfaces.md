# OrgSpace Workspace Shell and Resource Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 0 navigation shell with the approved T1 Calm Organization workbench and provide reusable, capability-bound list/detail/action components for every future product module.

**Architecture:** Keep the existing React 19, React Router 8, TanStack Query and SDK boundary. Add a small independently authored UI primitive layer using CSS tokens, Radix behavior primitives, Lucide icons and restrained Framer Motion. A resource surface registry binds each module to list/detail routes and capability actions; an executable gate prevents API/Web/CLI/Skill surface drift.

**Tech Stack:** React 19, TypeScript 6, Vite 8, React Router 8, TanStack Query 5, Vitest, Testing Library, CSS custom properties, Radix UI primitives, Lucide React, Framer Motion.

---

## Reference constraints

- `homepage-v2` is read-only and dirty; use component proportions and interaction patterns only. Do not import files or legacy blue/green gradients.
- `gqy20/dance-os` reference commit is `630a075c043f6b2cba13910c841ca23f61698a8d`; its README says internal/not open source. Do not copy code, assets or bundled fonts.
- Use OrgSpace T1 colors and existing application contracts. Reference projects never become runtime dependencies.

### Task 1: Add T1 design tokens and primitive dependencies

**Files:**
- Create: `apps/web/src/design-system/tokens.css`
- Create: `apps/web/src/design-system/primitives/button.tsx`
- Create: `apps/web/src/design-system/primitives/badge.tsx`
- Create: `apps/web/src/design-system/primitives/sheet.tsx`
- Create: `apps/web/src/design-system/primitives/menu.tsx`
- Create: `apps/web/src/design-system/primitives/skeleton.tsx`
- Create: `apps/web/src/design-system/primitives/index.ts`
- Create: `apps/web/src/design-system/primitives/primitives.test.tsx`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write RED primitive behavior tests**

Assert keyboard focus, disabled state, accessible names, Escape-close for sheets, outside-click close for menus, status text beyond color and reduced-motion behavior. Tests must fail because the primitives do not exist.

- [ ] **Step 2: Add the minimal dependencies**

Add exactly `@radix-ui/react-dialog@1.1.23`, `@radix-ui/react-dropdown-menu@2.1.24`, `@radix-ui/react-slot@1.3.3`, `lucide-react@1.34.0`, `framer-motion@13.1.1`, `clsx@2.1.1` and `class-variance-authority@0.7.1`. Do not add Tailwind, shadcn generators, bundled third-party fonts or Recharts in this task.

- [ ] **Step 3: Implement tokens and primitives**

Define exact CSS variables for T1 primary/deep/soft, warm/deep, neutral surfaces, borders, text, focus, success/warning/error/info, 4px spacing scale, 6/10/14px radii, subtle shadows and 160/200/220ms motion. Implement primitives as local source files around Radix behavior.

- [ ] **Step 4: Run GREEN and production build**

Run:

```bash
pnpm --filter @tashan/web test -- primitives.test.tsx
pnpm --filter @tashan/web typecheck
pnpm --filter @tashan/web build
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/src/design-system apps/web/src/styles.css pnpm-lock.yaml
git commit -m "feat(web): add OrgSpace UI primitives"
```

### Task 2: Define the resource surface registry and drift gate

**Files:**
- Create: `packages/capabilities/src/resource-surfaces.ts`
- Create: `packages/capabilities/src/resource-surfaces.test.ts`
- Create: `apps/web/src/resource-surfaces.json`
- Create: `apps/web/src/platform/resources/resource-surfaces.ts`
- Create: `scripts/check-resource-surface-coverage.mjs`
- Create: `scripts/check-resource-surface-coverage.self-test.mjs`
- Modify: `packages/capabilities/src/index.ts`
- Modify: `scripts/check-gate-self-tests.mjs`
- Modify: `scripts/check-gate-self-tests.self-test.mjs`
- Modify: `scripts/verify-phase0.sh`

- [ ] **Step 1: Write RED contract and pathology tests**

Reject duplicate resource types/routes, missing list/read capability, list routes without matching detail routes, organization routes without `:organizationId`, mutation actions without CLI bindings, unknown capability IDs and a `coming_soon` surface claiming active actions.

- [ ] **Step 2: Implement the strict resource surface schema**

Use this exact shape:

```ts
type ResourceSurface = {
  resourceType: string;
  context: "global" | "personal" | "organization";
  listRoute: string;
  detailRoute: string;
  listCapability: CapabilityId;
  readCapability: CapabilityId;
  actions: readonly {
    capabilityId: CapabilityId;
    confirmation: "none" | "required" | "high-risk";
  }[];
};
```

Phase 0 organization, member, device and audit objects receive real surfaces; future modules remain in `product-modules.json` as coming soon without fake capabilities.

- [ ] **Step 3: Implement the executable drift gate and negative self-test**

The gate compares capability registry, resource surfaces, Web routes, CLI bindings and Skill references. The self-test removes one detail route, changes one confirmation level and adds one unknown capability; each mutation must be rejected.

- [ ] **Step 4: Wire the gate into the complete verifier**

Run:

```bash
node scripts/check-resource-surface-coverage.self-test.mjs
node scripts/check-resource-surface-coverage.mjs
bash scripts/verify-phase0.self-test.sh
```

- [ ] **Step 5: Commit**

```bash
git add packages/capabilities apps/web/src/resource-surfaces.json apps/web/src/platform/resources scripts/check-resource-surface-coverage* scripts/check-gate-self-tests* scripts/verify-phase0.sh
git commit -m "feat(platform): bind list and detail surfaces"
```

### Task 3: Build the responsive workspace shell

**Files:**
- Modify: `apps/web/src/platform/shell/app-shell.tsx`
- Modify: `apps/web/src/platform/shell/app-shell.test.tsx`
- Modify: `apps/web/src/platform/shell/navigation.tsx`
- Create: `apps/web/src/platform/shell/sidebar.tsx`
- Create: `apps/web/src/platform/shell/mobile-navigation.tsx`
- Create: `apps/web/src/platform/shell/workspace-header.tsx`
- Create: `apps/web/src/platform/shell/space-switcher.tsx`
- Create: `apps/web/src/platform/shell/shell-state.ts`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write RED shell journey tests**

Cover explicit 216→64px collapse, device-local preference, organization/personal/global navigation groups, role-filtered admin links, mobile bottom navigation, More sheet, Escape close, active-route labeling, organization loading/forbidden and no horizontal overflow at 320px.

- [ ] **Step 2: Implement the fixed-height desktop shell**

Use `100dvh`, a non-scrolling 216/64px sidebar, a compact top header and one scrolling main region. Keep the existing organization provider and session boundaries. Navigation uses Lucide line icons and T1 active states, not emoji or copied dance-os labels.

- [ ] **Step 3: Implement mobile navigation**

Show at most five high-frequency destinations in the bottom bar and put the remainder in an accessible left Sheet. Preserve safe-area padding and the same deep-link routes as desktop.

- [ ] **Step 4: Run responsive and accessibility verification**

Run Web unit tests at desktop/mobile media queries, keyboard navigation tests, reduced-motion tests, typecheck and build.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/platform/shell apps/web/src/styles.css
git commit -m "feat(web): build responsive workspace shell"
```

### Task 4: Build generic list, detail and action components

**Files:**
- Create: `apps/web/src/platform/resources/resource-list-page.tsx`
- Create: `apps/web/src/platform/resources/resource-list-toolbar.tsx`
- Create: `apps/web/src/platform/resources/resource-row.tsx`
- Create: `apps/web/src/platform/resources/resource-detail-page.tsx`
- Create: `apps/web/src/platform/resources/resource-detail-drawer.tsx`
- Create: `apps/web/src/platform/resources/resource-action-bar.tsx`
- Create: `apps/web/src/platform/resources/resource-states.tsx`
- Create: `apps/web/src/platform/resources/resource-components.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write RED component-state tests**

Require loading, empty, partial-error, fatal-error, forbidden, readonly and version-conflict states. List rows must be keyboard-openable only when interactive; detail drawer must retain list context, trap focus and expose a stable full-page link.

- [ ] **Step 2: Implement the calm list language**

Use homepage-v2-inspired search/filter chips and list/grid toggles, translated to T1 tokens. Rows use a 3px status rail plus text/dot status, tabular numeric metadata, subtle hover surface and no heavy card shadow.

- [ ] **Step 3: Implement detail and action regions**

Use a sticky header, scrollable content, relationship/attachment/activity slots and sticky footer actions. Capability and state metadata control presentation; server responses remain the final authorization truth.

- [ ] **Step 4: Run GREEN and visual state snapshots**

Render every state in tests, run typecheck/build and capture desktop/mobile screenshots for manual inspection. Do not label screenshot generation as browser interaction acceptance until keyboard and click journeys are exercised.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/platform/resources apps/web/src/styles.css
git commit -m "feat(web): add resource list and detail views"
```

### Task 5: Migrate Phase 0 modules onto the new surfaces

**Files:**
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/features/account/account-page.tsx`
- Modify: `apps/web/src/features/organization/home-page.tsx`
- Modify: `apps/web/src/features/organization/members-page.tsx`
- Modify: `apps/web/src/features/audit/audit-page.tsx`
- Modify: `apps/web/src/platform/routing/route-paths.ts`
- Modify: `apps/web/src/platform/routing/route-paths.test.ts`
- Modify: `apps/web/src/product-modules.json`

- [ ] **Step 1: Write RED Phase 0 list/detail route tests**

Require member list→member detail, device list→device detail, audit list→event detail and organization list→organization detail deep links. Preserve all current role and unknown-organization rejections.

- [ ] **Step 2: Migrate account, member and audit pages**

Reuse the generic surfaces without changing API contracts. Audit detail shows trusted device/network context and redacted state only. Device/member actions preserve current confirmation and idempotency behavior.

- [ ] **Step 3: Replace coming-soon presentation**

Future module entries remain visible as a roadmap only where product navigation requires them; they cannot masquerade as working list/detail pages or bind nonexistent capabilities.

- [ ] **Step 4: Run complete Phase 0 regression**

Run:

```bash
pnpm --filter @tashan/web test
pnpm --filter @tashan/web build
ORGSPACE_TEST_CLEANUP_VOLUMES=1 bash scripts/verify-phase0.sh
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): migrate Phase 0 resource views"
```

### Task 6: Browser acceptance, PR and deployment

**Files:**
- Create: `docs/verification/workspace-shell-resource-surfaces.md`

- [ ] **Step 1: Run real browser journeys**

Exercise login, organization switching, sidebar collapse/reload, mobile More navigation, member list/detail, audit list/detail, device revoke confirmation, forbidden organization and keyboard-only navigation.

- [ ] **Step 2: Inspect visual quality at required widths**

Capture and inspect 1440px, 1024px, 768px and 390px layouts. Verify no clipped labels, accidental horizontal scroll, fake clickable rows, color-only states, gradient/glass effects or unreadable dense sections.

- [ ] **Step 3: Run all repository and parity gates**

Run the complete verifier on the exact commit and record command outputs separately from browser evidence.

- [ ] **Step 4: Create and merge a reviewed PR**

Use merge commit after CI, unresolved-comment and milestone checks. Delete the remote feature branch after merge.

- [ ] **Step 5: Deploy and smoke the exact merge**

Deploy through the existing AUP safe deployer, verify `.deployed-commit`, public health, protected routes and the current Skill/CLI release. This frontend foundation does not require a new CLI tag unless capability or CLI code changes.
