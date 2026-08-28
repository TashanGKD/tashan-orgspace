# OrgSpace Homepage-v2 Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mixed Phase 0/teal OrgSpace interface with the approved homepage-v2 “山水工作台” across login, shell, resource lists, drawers, dialogs and mobile layouts without changing backend, CLI or Skill contracts.

**Architecture:** Copy immutable homepage-v2 brand assets into OrgSpace, establish one CSS token source, split active styles into focused modules, and migrate existing React surfaces onto shared page-hero/list/drawer primitives. Preserve current routes and data calls; detail routes render their lists behind a controlled drawer so deep links and list context both work.

**Tech Stack:** React 19, TypeScript 6, Vite 8, React Router 8, TanStack Query 5, Radix Dialog, Lucide React, Framer Motion, CSS custom properties, Vitest, Testing Library, Node.js consistency gates.

---

## Source evidence read before this plan

- `apps/web/src/main.tsx` imports exactly one stylesheet: `./styles.css`.
- Active Web components and tests live under `apps/web/src`; no `apps/web/public` assets currently exist.
- Current runtime dependencies already include Radix Dialog, Radix Dropdown Menu, Lucide and Framer Motion; no new UI dependency is required.
- Homepage-v2 asset sources and SHA-256 values:
  - `frontend/public/media/bg_horizontal.webp`: `b155f0f9a65c3262803f58b571c07d675663cd61d405690d7d15366563913c45`
  - `frontend/public/media/logo_complete.webp`: `8dfd1d4cffd2886cd118d74e945075414912c6359e74eb235cf2993c052e60a8`
  - `frontend/public/media/logo_square_2.webp`: `3d990e6ca08a3f46e0b184fcfab78b5ad7ee077c4285fee12681b3400f5411cc`
- Homepage-v2's live source defines `#0E2E4F`, `#5B9BD5`, `#9FD4C4`, `#6BC5D6`, `20px` large radii, navy-tinted shadows and a `1200px` container in `frontend/src/styles/App.css`.
- Existing route and authorization behavior is mounted in `apps/web/src/app.tsx`; this redesign does not alter its API or permission contracts.

## Target file structure

```text
apps/web/public/media/brand/
  bg-horizontal.webp
  logo-complete.webp
  logo-square.webp
apps/web/src/design-system/
  brand-assets.json
  brand-tokens.css
  global.css
  primitives.css
  workspace-shell.css
  resource-surfaces.css
  access.css
  primitives/
apps/web/src/platform/resources/
  page-hero.tsx
  resource-*.tsx
apps/web/src/styles.css
scripts/
  check-web-brand-contract.mjs
  check-web-brand-contract.self-test.mjs
```

### Task 1: Copy and lock homepage-v2 brand assets

**Files:**
- Create: `apps/web/public/media/brand/bg-horizontal.webp`
- Create: `apps/web/public/media/brand/logo-complete.webp`
- Create: `apps/web/public/media/brand/logo-square.webp`
- Create: `apps/web/src/design-system/brand-assets.json`
- Create: `apps/web/src/design-system/brand-system.test.ts`

- [x] **Step 1: Write the failing asset-contract test**

Create `brand-system.test.ts`:

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import assets from "./brand-assets.json" with { type: "json" };

const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("homepage-v2 brand assets", () => {
  test.each(assets)("keeps $name pinned to its reviewed checksum", (asset) => {
    const path = resolve(import.meta.dirname, `../../public/${asset.publicPath}`);
    expect(sha256(path)).toBe(asset.sha256);
    expect(asset.source).toMatch(/^homepage-v2\/frontend\/public\/media\//);
  });
});
```

- [x] **Step 2: Run RED**

Run `pnpm --filter @tashan/web test -- brand-system.test.ts`.

Expected: FAIL because the manifest and assets do not exist.

- [x] **Step 3: Copy the exact reviewed binaries**

Run:

```bash
mkdir -p apps/web/public/media/brand
install -m 0644 /Users/boyuan/aiwork/Tashan-Org/homepage-v2/frontend/public/media/bg_horizontal.webp apps/web/public/media/brand/bg-horizontal.webp
install -m 0644 /Users/boyuan/aiwork/Tashan-Org/homepage-v2/frontend/public/media/logo_complete.webp apps/web/public/media/brand/logo-complete.webp
install -m 0644 /Users/boyuan/aiwork/Tashan-Org/homepage-v2/frontend/public/media/logo_square_2.webp apps/web/public/media/brand/logo-square.webp
```

Create `brand-assets.json`:

```json
[
  {
    "name": "mountain-background",
    "publicPath": "media/brand/bg-horizontal.webp",
    "source": "homepage-v2/frontend/public/media/bg_horizontal.webp",
    "sha256": "b155f0f9a65c3262803f58b571c07d675663cd61d405690d7d15366563913c45"
  },
  {
    "name": "complete-logo",
    "publicPath": "media/brand/logo-complete.webp",
    "source": "homepage-v2/frontend/public/media/logo_complete.webp",
    "sha256": "8dfd1d4cffd2886cd118d74e945075414912c6359e74eb235cf2993c052e60a8"
  },
  {
    "name": "square-logo",
    "publicPath": "media/brand/logo-square.webp",
    "source": "homepage-v2/frontend/public/media/logo_square_2.webp",
    "sha256": "3d990e6ca08a3f46e0b184fcfab78b5ad7ee077c4285fee12681b3400f5411cc"
  }
]
```

- [x] **Step 4: Run GREEN and build**

Run the targeted test and `pnpm --filter @tashan/web build`.

Expected: asset test passes; Vite copies the assets into `dist/media/brand`.

- [x] **Step 5: Commit**

```bash
git add apps/web/public/media/brand apps/web/src/design-system/brand-assets.json apps/web/src/design-system/brand-system.test.ts
git commit -m "feat(web): add homepage-v2 brand assets"
```

### Task 2: Replace the visual token and primitive CSS source

**Files:**
- Create: `apps/web/src/design-system/brand-tokens.css`
- Create: `apps/web/src/design-system/global.css`
- Create: `apps/web/src/design-system/primitives.css`
- Modify: `apps/web/src/design-system/primitives/primitives.test.tsx`
- Delete: `apps/web/src/design-system/tokens.css`

- [x] **Step 1: Write RED token assertions**

Extend the primitive test to read `brand-tokens.css` and assert:

```ts
expect(css).toContain("--brand-navy: #0e2e4f");
expect(css).toContain("--brand-blue: #5b9bd5");
expect(css).toContain("--brand-mint: #9fd4c4");
expect(css).toContain("--radius-card: 20px");
expect(css).toContain("--shadow-card: 0 4px 16px rgba(15, 46, 79, 0.12)");
expect(css).not.toMatch(/--ink:|--paper:|--red:/);
```

- [x] **Step 2: Run RED**

Run `pnpm --filter @tashan/web test -- primitives.test.tsx`.

Expected: FAIL because the new token file does not exist.

- [x] **Step 3: Create the single token source**

`brand-tokens.css` must define:

```css
:root {
  --brand-navy: #0e2e4f;
  --brand-navy-deep: #0a1f35;
  --brand-blue: #5b9bd5;
  --brand-mint: #9fd4c4;
  --brand-cyan: #6bc5d6;
  --brand-mint-light: #b5e5c8;
  --brand-gradient: linear-gradient(135deg, #5b9bd5 0%, #9fd4c4 100%);
  --surface-canvas: #f6fafc;
  --surface-primary: #ffffff;
  --surface-secondary: #f1f6f8;
  --border-subtle: #dfe9ef;
  --text-primary: #0e2e4f;
  --text-secondary: #5f7487;
  --text-tertiary: #8293a0;
  --success: #39725f;
  --success-surface: #eaf6f0;
  --warning: #956018;
  --warning-surface: #fff5dd;
  --error: #a63f38;
  --error-surface: #fff0ee;
  --info: #3c6f94;
  --info-surface: #edf5fb;
  --radius-control: 10px;
  --radius-field: 12px;
  --radius-row: 16px;
  --radius-card: 20px;
  --radius-hero: 32px;
  --shadow-sm: 0 2px 8px rgba(15, 46, 79, 0.08);
  --shadow-card: 0 4px 16px rgba(15, 46, 79, 0.12);
  --shadow-lg: 0 8px 32px rgba(15, 46, 79, 0.15);
  --focus-ring: 0 0 0 3px rgba(91, 155, 213, 0.24);
  --motion-fast: 160ms;
  --motion-base: 220ms;
  --motion-slow: 280ms;
}
```

- [x] **Step 4: Move active primitive rules**

Move `.org-button`, `.org-status-badge`, `.org-overlay`, `.org-sheet`, `.org-dialog`, `.org-menu-*` and `.org-skeleton` from the deleted `tokens.css` into `primitives.css`. Replace all old `--org-*` references with the new tokens. Primary buttons use `var(--brand-gradient)` and `var(--shadow-sm)`; danger buttons use semantic error tokens.

Create `global.css` with the system sans stack, antialiasing, `box-sizing`, `body`/`#root` sizing, link defaults, form font inheritance and the reduced-motion media rule. No global serif font or patterned paper background may remain.

- [x] **Step 5: Run GREEN and commit**

Run Web tests, typecheck and build. Commit:

```bash
git add apps/web/src/design-system
git commit -m "feat(web): replace workbench visual tokens"
```

### Task 3: Build the homepage-v2 workspace shell

**Files:**
- Create: `apps/web/src/design-system/workspace-shell.css`
- Modify: `apps/web/src/platform/shell/sidebar.tsx`
- Modify: `apps/web/src/platform/shell/navigation.tsx`
- Modify: `apps/web/src/platform/shell/workspace-header.tsx`
- Modify: `apps/web/src/platform/shell/mobile-navigation.tsx`
- Modify: `apps/web/src/platform/shell/workspace-shell.test.tsx`

- [x] **Step 1: Write RED shell-brand tests**

Assert the expanded sidebar includes `/media/brand/logo-complete.webp`, the collapsed sidebar includes `/media/brand/logo-square.webp`, primary navigation contains no visible repeated `即将上线`, strategic core links remain present, and the mobile bar still has exactly four links plus More.

- [x] **Step 2: Run RED**

Run `pnpm --filter @tashan/web test -- workspace-shell.test.tsx app-shell.test.tsx`.

Expected: logo and navigation-noise assertions fail.

- [x] **Step 3: Implement the shell contract**

Use `workspace-shell.css` for:

```css
.workspace-shell { height: 100dvh; background: var(--surface-canvas); color: var(--text-primary); }
.workspace-sidebar { width: 208px; background: rgba(255,255,255,.98); border-right: 1px solid rgba(14,46,79,.08); }
.workspace-sidebar[data-collapsed="true"] { width: 64px; }
.workspace-header { min-height: 60px; background: rgba(255,255,255,.94); backdrop-filter: blur(18px); }
.workspace-content { overflow-y: auto; padding: 0 24px 32px; }
```

Sidebar uses real logo images and a `208→64px` transition. Navigation shows available modules plus strategic core IDs `organization.home`, `organization.tasks`, `organization.files`, `organization.messages`, `organization.members`, and `organization.audit`; other coming-soon modules live only in the More sheet. Do not show `即将上线` beside each primary item.

- [x] **Step 4: Implement responsive shell rules**

At `max-width: 760px`, hide the sidebar, set header height to `56px`, add safe-area padding, show the `70px` bottom navigation, and give `.workspace-content` bottom padding of `calc(86px + env(safe-area-inset-bottom))`.

- [x] **Step 5: Verify and commit**

Run shell tests, full Web tests, typecheck and build. Commit:

```bash
git add apps/web/src/platform/shell apps/web/src/design-system/workspace-shell.css
git commit -m "feat(web): build homepage-v2 workspace shell"
```

### Task 4: Redesign login, registration and recovery

**Files:**
- Create: `apps/web/src/design-system/access.css`
- Modify: `apps/web/src/auth/access-panel.tsx`
- Modify: `apps/web/src/auth/access-panel.test.tsx`

- [x] **Step 1: Write RED access-layout tests**

Assert the access page renders the complete logo, a mountain-branded region, one named access card, the existing three tabs and no `.seal`, `.access-manifesto`, `ORG`, black/red visual marker or legacy English label.

- [x] **Step 2: Run RED**

Run `pnpm --filter @tashan/web test -- access-panel.test.tsx`.

- [x] **Step 3: Implement the approved login structure**

Use this DOM hierarchy while keeping all existing callbacks and inputs:

```tsx
<main className="access-page">
  <header className="access-header">
    <img src="/media/brand/logo-complete.webp" alt="他山组织空间" />
    <span>他山学科交叉创新协会</span>
  </header>
  <section className="access-stage">
    <div className="access-welcome">...</div>
    <section className="access-card" aria-labelledby="access-title">...</section>
  </section>
</main>
```

`access.css` uses the local mountain asset, a strong white overlay, a `420px` glass card, `22px` radius and homepage-v2 shadows. Mobile becomes a single centered card; the welcome copy remains above it in compact form.

- [x] **Step 4: Verify every auth mode**

Run tests for login, registration, resend countdown and password reset. Confirm labels and autocomplete attributes are unchanged.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/auth apps/web/src/design-system/access.css
git commit -m "feat(web): redesign account access surfaces"
```

### Task 5: Create shared mountain page heroes and resource drawers

**Files:**
- Create: `apps/web/src/design-system/resource-surfaces.css`
- Create: `apps/web/src/platform/resources/page-hero.tsx`
- Create: `apps/web/src/platform/resources/page-hero.test.tsx`
- Modify: `apps/web/src/platform/resources/resource-list-page.tsx`
- Modify: `apps/web/src/platform/resources/resource-detail-page.tsx`
- Modify: `apps/web/src/platform/resources/resource-detail-drawer.tsx`
- Modify: `apps/web/src/platform/resources/resource-row.tsx`
- Modify: `apps/web/src/platform/resources/resource-list-toolbar.tsx`
- Modify: `apps/web/src/platform/resources/resource-components.test.tsx`

- [x] **Step 1: Write RED shared-surface tests**

Test that PageHero exposes one `h1`, optional description and action; resource lists use PageHero; rows retain native link keyboard behavior; drawers keep list context, contain focus, show ordinary information before `技术信息`, and can close with Escape.

- [x] **Step 2: Run RED**

Run the new PageHero test and `resource-components.test.tsx`.

- [x] **Step 3: Implement PageHero**

```tsx
export function PageHero({ title, description, action }: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-hero">
      <div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>
      {action ? <div className="page-hero-action">{action}</div> : null}
    </header>
  );
}
```

`resource-surfaces.css` sets a local mountain background with white overlay, `32–36px` page titles, `1200px` centered content, `16px` list rows, `20px` cards, navy shadows and a maximum `2px` hover lift.

- [x] **Step 4: Implement drawer route mode**

Add `detail` and `technical` slots to `ResourceDetailDrawer`. List pages always remain mounted; a detail route opens the drawer over the list. The drawer URL remains the existing detail URL. Remove the mandatory full-page link unless a caller supplies one.

- [x] **Step 5: Verify and commit**

Run shared surface tests, Web tests, typecheck and build. Commit:

```bash
git add apps/web/src/design-system/resource-surfaces.css apps/web/src/platform/resources
git commit -m "feat(web): add branded resource surfaces"
```

### Task 6: Migrate organization and member workflows

**Files:**
- Modify: `apps/web/src/features/organization/home-page.tsx`
- Modify: `apps/web/src/features/organization/home-page.test.tsx`
- Modify: `apps/web/src/features/organization/members-page.tsx`
- Modify: `apps/web/src/features/organization/members-page.test.tsx`

- [x] **Step 1: Write RED journey tests**

Require:

- Create Organization opens a named drawer instead of exposing the form below the list.
- Submitting still uses one idempotency key and navigates to the created organization.
- Member rows stay visible when a member detail route opens.
- Member detail opens in a named drawer and retains account ID under `技术信息`.
- Add Member opens a drawer; role selection and duplicate-submit protection remain intact.

- [x] **Step 2: Run RED**

Run home and member page tests.

- [x] **Step 3: Migrate OrganizationHomePage**

Keep real organization data only. Organization cards show name and state; do not invent summary metrics. Move the current create form into a controlled `Sheet`; keep organization ID in the organization-detail information block.

- [x] **Step 4: Migrate MembersPage**

Always render ResourceListPage. When `selectedAccountId` exists, render ResourceDetailDrawer over the list. Move the add-member form into a controlled Sheet. Use the same query result for list and detail; preserve current not-found/error states.

- [x] **Step 5: Verify and commit**

Run page tests, full Web tests, typecheck and build. Commit:

```bash
git add apps/web/src/features/organization
git commit -m "feat(web): migrate organization workbench surfaces"
```

### Task 7: Migrate devices, operation records and product states

**Files:**
- Modify: `apps/web/src/features/account/account-page.tsx`
- Modify: `apps/web/src/features/audit/audit-page.tsx`
- Modify: `apps/web/src/features/audit/audit-page.test.tsx`
- Modify: `apps/web/src/features/roadmap/coming-soon-page.tsx`
- Modify: `apps/web/src/platform/resources/resource-states.tsx`
- Modify: `apps/web/src/app.test.tsx`

- [x] **Step 1: Write RED route/drawer tests**

Require device and operation-detail URLs to keep their lists visible behind a detail drawer. Verify technical IDs remain in drawers, revoke confirmation remains Radix-controlled, pagination deep links still search all pages, and coming-soon/empty/forbidden surfaces use the branded state composition.

- [x] **Step 2: Run RED**

Run app, audit and resource component tests.

- [x] **Step 3: Migrate AccountPage**

Render the device list for both list and detail routes. Open DeviceDetail in ResourceDetailDrawer for `selectedDeviceId`. Keep revoke confirmation as a centered Dialog. Remove the standalone return-link layout.

- [x] **Step 4: Migrate AuditPage and states**

Keep the current human-readable operation labels and deep-link pagination. Render AuditDetail in the drawer over the list and retain raw evidence under `技术信息`. Use the mountain asset only in drawer/state headers, not behind identifiers.

- [x] **Step 5: Verify and commit**

Run full Web tests, typecheck and build. Commit:

```bash
git add apps/web/src/features/account apps/web/src/features/audit apps/web/src/features/roadmap apps/web/src/platform/resources/resource-states.tsx apps/web/src/app.test.tsx
git commit -m "feat(web): migrate device and audit workbench surfaces"
```

### Task 8: Remove legacy CSS and add a visual contract gate

**Files:**
- Replace: `apps/web/src/styles.css`
- Delete: `apps/web/src/devices/device-list.tsx`
- Delete: `apps/web/src/organizations/organization-switcher.tsx`
- Create: `scripts/check-web-brand-contract.mjs`
- Create: `scripts/check-web-brand-contract.self-test.mjs`
- Modify: `scripts/verify-phase0.sh`

- [x] **Step 1: Prove legacy components are unused**

Run:

```bash
rg -n 'DeviceList|OrganizationSwitcher' apps/web/src --glob '!devices/device-list.tsx' --glob '!organizations/organization-switcher.tsx'
```

Expected: no production imports. Delete both files only after this result.

- [x] **Step 2: Replace styles.css with imports only**

The final file must be exactly:

```css
@import "./design-system/brand-tokens.css";
@import "./design-system/global.css";
@import "./design-system/primitives.css";
@import "./design-system/workspace-shell.css";
@import "./design-system/resource-surfaces.css";
@import "./design-system/access.css";
```

- [x] **Step 3: Write the visual gate and negative self-test**

The gate checks reviewed asset hashes, required CSS imports/tokens, absence of remote preview hotlinks, absence of `--ink`, `--paper`, `--red`, provisional `--org-primary`, and global serif families. Self-test must mutate one checksum, remove one CSS import, insert one legacy token and insert one remote hotlink; each mutation must fail.

- [x] **Step 4: Wire the gate**

Add production and self-test invocations to `verify-phase0.sh`. `check-gate-self-tests.mjs` must report 16 gates.

- [x] **Step 5: Verify and commit**

Run formatting, lint, Web tests, typecheck, build, brand gate/self-test and gate discovery. Commit:

```bash
git add apps/web/src/styles.css apps/web/src/design-system scripts/check-web-brand-contract* scripts/verify-phase0.sh
git add -u apps/web/src/devices/device-list.tsx apps/web/src/organizations/organization-switcher.tsx apps/web/src/design-system/tokens.css
git commit -m "ci(web): enforce homepage-v2 visual system"
```

### Task 9: Browser acceptance and final verification

**Files:**
- Create: `docs/verification/homepage-v2-workbench-redesign.md`
- Modify: `docs/superpowers/plans/2026-08-28-homepage-v2-workbench-redesign.md`

- [x] **Step 1: Run complete automated verification**

```bash
pnpm --filter @tashan/web test
pnpm --filter @tashan/web typecheck
pnpm --filter @tashan/web build
ORGSPACE_TEST_CLEANUP_VOLUMES=1 bash scripts/verify-phase0.sh
```

Record unit, distribution, brand gate, production-stack and E2E counts separately.

- [x] **Step 2: Run real browser journeys**

Through the loopback production Compose stack, exercise login/register/reset tabs, organization switch/create drawer, member add/detail drawer, device detail/revoke dialog, operation list/deep-link drawer, coming-soon page, forbidden organization and keyboard navigation.

- [x] **Step 3: Inspect required widths**

Capture and inspect `1440×900`, `1024×900`, `768×900` and `390×844`. Require no horizontal overflow, no clipped labels, usable drawers, visible focus, safe-area bottom navigation and a stable title band.

- [x] **Step 4: Compare against approved visual artifacts**

Check login, organization home, members, member drawer, devices, operation records and mobile home against the approved A mockups. Specifically reject black/red/paper remnants, global serif type, flat utility-only cards, repeated coming-soon labels and forms under lists.

- [x] **Step 5: Record evidence and commit**

Write the report with exact commit, screenshot paths, automated evidence, browser evidence and any remaining visual debt. Mark all plan boxes complete and commit:

```bash
git add docs/verification/homepage-v2-workbench-redesign.md docs/superpowers/plans/2026-08-28-homepage-v2-workbench-redesign.md
git commit -m "docs(verification): record workbench redesign acceptance"
```
