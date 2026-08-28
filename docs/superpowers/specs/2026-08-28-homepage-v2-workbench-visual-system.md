# OrgSpace Homepage-v2 Workbench Visual System

Date: 2026-08-28

Status: visual direction approved; implementation accepted on 2026-08-28

## 1. Objective

Redesign the complete OrgSpace Web interface as a long-lived organization workbench that clearly belongs to the same brand as `preview2.tashan.ac.cn`.

The approved direction is **A · 山水工作台**:

- retain the efficient desktop sidebar and mobile bottom navigation;
- use homepage-v2's navy, pale blue, mint, mountain imagery, spacing, radii and shadows as the visual source of truth;
- keep operational content on quiet white surfaces;
- place mountain imagery only where it adds brand recognition rather than behind dense work content;
- use drawers and dialogs for creation/editing instead of laying forms under lists.

This is a visual-system replacement, not a small polish pass over the current CSS.

## 2. Source of truth and decision record

### Approved visual source

The visual reference is the live homepage-v2 build at `https://preview2.tashan.ac.cn/`, inspected together with its current local source:

- `homepage-v2/frontend/src/styles/App.css`
- `homepage-v2/frontend/src/pages/Home.jsx`
- `homepage-v2/frontend/public/media/bg_horizontal.webp`
- the current homepage-v2 logo assets

The relevant homepage-v2 values are:

| Role | Value |
|---|---|
| Deep navy | `#0E2E4F` |
| Deeper navy | `#0A1F35` |
| Primary blue | `#5B9BD5` |
| Secondary mint | `#9FD4C4` |
| Accent cyan | `#6BC5D6` |
| Light mint | `#B5E5C8` |
| Small shadow | `0 2px 8px rgba(15, 46, 79, 0.08)` |
| Medium shadow | `0 4px 16px rgba(15, 46, 79, 0.12)` |
| Large shadow | `0 8px 32px rgba(15, 46, 79, 0.15)` |
| Radii | `8px`, `12px`, `20px`, `32px` |
| Content container | `1200px`, with `24px` horizontal padding |

### Explicit user override

Earlier OrgSpace work used a provisional T1 teal (`#4FA8AA`) and kept parts of the original black/red/serif Phase 0 theme. The user explicitly rejected the resulting quality and selected homepage-v2 as the visual reference. For OrgSpace Web, this approved homepage-v2 workbench palette replaces the provisional mixed palette.

### Rejected directions

- **Current hybrid:** black/red serif access pages plus teal utility workspace. Rejected because it looks like unrelated products combined.
- **B · 品牌侧栏:** visually coherent, but concentrates too much brand weight in a dark sidebar and weakens the light homepage-v2 feel.
- **C · 官网式工作台:** strongest marketing appearance, but top navigation makes repeated operational work slower.

## 3. Visual model: brand layer and work layer

The product has two coordinated layers.

### Brand layer

Use mountain imagery, blue/mint gradients and larger typography in only four places:

1. login and account-recovery surfaces;
2. page title bands;
3. empty or first-use states;
4. organization switching and welcome moments.

### Work layer

Use quiet white or very pale blue-gray surfaces for:

- lists and tables;
- forms;
- detail drawers;
- audit evidence;
- file and organization-management surfaces;
- long-running administrative work.

Mountain imagery must never sit behind dense text, form controls, audit identifiers or code/output content.

## 4. Typography

The approved Web typography follows the live homepage-v2 implementation rather than the old OrgSpace serif root style.

- Interface and headings: `Inter`, then the system sans-serif stack.
- Chinese fallback: `PingFang SC`, `Microsoft YaHei`, system sans-serif.
- Technical IDs and tabular values: `JetBrains Mono` when available, otherwise a system monospace stack.
- Remove `Noto Serif CJK SC`, `Songti SC` and `STSong` from the global application root.

Type scale:

| Use | Desktop | Mobile | Weight |
|---|---:|---:|---:|
| Login/brand heading | 52–64px | 36–42px | 800 |
| Page title | 32–36px | 26–28px | 750–800 |
| Section heading | 20–24px | 18–20px | 700 |
| Card title | 14–16px | 14–16px | 700–750 |
| Body | 14–16px | 14–16px | 400–500 |
| Metadata | 11–12px | 11–12px | 400–600 |

## 5. Layout

### Desktop shell

- Fixed-height `100dvh` workbench.
- Sidebar: `208px` expanded, `64px` collapsed.
- Top bar: `58–64px`.
- Main canvas: pale blue-gray, one vertical scroll region.
- Main content: maximum `1200px`, centered, `24–32px` horizontal padding.
- Page title band: approximately `120–144px`, using the mountain asset with a strong white overlay.

Sidebar rules:

- use the homepage-v2 logo or a properly derived compact mark;
- group available modules by work context;
- keep the strategic core destinations shown in the approved mockup (首页、任务、文件、消息) even when their first version is not open yet, but never repeat `即将上线` beside every item;
- move other unavailable modules to `更多` or a roadmap surface;
- use Lucide line icons only;
- selected navigation uses a pale blue/mint fill, not a dark solid block.

### Mobile shell

- Breakpoint: `760px`.
- Hide the desktop sidebar.
- Top bar: `56px`.
- Bottom navigation: `70px` plus safe-area inset.
- Five destinations maximum: 首页、任务、文件、消息、更多.
- Page title band remains, with reduced height and a quieter mountain crop.
- Primary action remains near the title rather than becoming a floating corner button.

## 6. Component system

### Color tokens

Create one machine-readable OrgSpace homepage-v2 token layer:

- brand navy, blue, mint and cyan;
- neutral canvas, primary surface, secondary surface and borders;
- success, warning, error and information colors derived for accessibility;
- three shadow levels;
- four radius levels;
- focus ring and reduced-motion values.

Do not retain a parallel red/paper theme or the provisional teal theme.

### Cards and list rows

- List row radius: `16px`.
- Dashboard/summary card radius: `20px`.
- Dense controls: `10–12px`.
- Default list rows use a white surface, an extremely light blue border and navy-tinted shadow.
- Hover: translate upward by at most `2px` and raise shadow one level.
- Status must always include text; color remains secondary.
- Avoid a colored rail on every row unless the rail encodes a meaningful state.

### Buttons

- Primary: homepage blue-to-mint gradient, white label, `12–14px` radius.
- Secondary: white or pale blue-gray with navy text.
- Quiet: transparent with pale hover fill.
- Danger: semantic red only for destructive operations.
- Primary buttons may lift by `1–2px` on hover; no bounce or large scale effects.

### Search, filters and forms

- Search and filters live in one quiet toolbar.
- Inputs use white surfaces, `10–12px` radii and visible focus rings.
- Create/edit forms open in a right drawer or centered dialog.
- List pages never end with a permanently exposed creation form.
- Errors appear next to the affected control and in global feedback when appropriate.

### Drawers and dialogs

- Detail drawer width: `420–480px` on desktop; full width on mobile.
- Drawer header may use a faint mountain background with a white overlay.
- Basic information is shown first.
- Technical IDs are grouped under `技术信息` and remain copyable.
- Sticky footer contains the available actions.
- Continue using Radix behavior for focus containment, Escape close and focus restoration.

## 7. Core screens

### Login and recovery

- Full-page light mountain background.
- Transparent/blurred header with logo and association name.
- Desktop: brand message on the left, one `420px` white glass card on the right.
- Mobile: one centered card with a compact logo header.
- Login/register/reset remain tabs inside the same card.
- Remove the current black field, red seal and oversized `ORG` pseudo-element.

### Organization home

- Mountain title band: `组织首页` plus one short description.
- Organization cards show name, current/access status and useful summary counts when the data exists.
- `创建组织` opens a drawer; the form no longer sits at the bottom of the list.
- Include a recent-work area only when backed by real data; do not invent dashboard metrics in Phase 0.
- Organization IDs remain available on the organization detail surface, not on ordinary cards.

### Members

- Mountain title band with `添加成员` primary action.
- Search/filter toolbar directly below.
- White list rows with avatar, display name, role and state.
- Clicking a row opens the detail drawer while preserving list context.
- Add/edit actions use the drawer; list density remains readable.

### Operation records

- Same list language as members, but optimized for timestamp and result scanning.
- Human-readable operation names remain primary.
- Raw capability ID, request ID, object ID, IP and device evidence remain in the detail drawer under technical information.
- Error/empty/loading language continues to use `操作记录` consistently.

### Devices

- Device rows show device name, operating system, last-active time and state.
- Device details and revoke confirmation use the common drawer/dialog system.
- Destructive confirmation remains explicit and keyboard accessible.

## 8. Motion

- Page content fade/slide: `180–240ms`, maximum `4px` translation.
- Card hover: `200–300ms`.
- Drawer: `220–280ms`.
- Mountain gradient orbs, if used, move slowly and never behind operational content.
- Honor `prefers-reduced-motion` for all animations.
- Initial content must never remain at opacity zero during tests or slow devices.

## 9. Implementation architecture

The current `apps/web/src/styles.css` contains legacy Phase 0 styles and newer workbench styles in one large file. The redesign must replace this accumulation pattern.

Target structure:

```text
apps/web/src/design-system/
  brand-tokens.css
  primitives/
  workspace-shell.css
  resource-surfaces.css
  access.css
```

Rules:

- `brand-tokens.css` is the only source for visual tokens.
- legacy black/red/paper variables and root serif styles are removed, not overridden later;
- page components consume shared primitives rather than adding page-specific card styles;
- copy, API routes, SDK behavior, capability IDs and authorization remain unchanged;
- homepage-v2 assets are copied into OrgSpace's own public asset directory with attribution/source recorded; production must not hotlink `preview2.tashan.ac.cn`.
- deferred modules reuse the branded Coming Soon state and do not require separate operational components.

## 10. Accessibility and states

- Maintain WCAG AA contrast for body text and controls.
- Focus rings must be visible on all interactive elements.
- No state is communicated by color alone.
- Desktop and mobile keyboard navigation remain functional.
- Loading skeletons use stable layout dimensions.
- Empty states use short guidance and optional mountain imagery.
- Forbidden and fatal states provide a safe next action where possible.

## 11. Non-goals

- Do not implement future task, file or chat backends as part of the visual redesign; deferred runtime and service modules remain Coming Soon states.
- Do not change CLI or Skill contracts.
- Do not migrate the frontend framework or introduce Tailwind.
- Do not copy homepage-v2 page content into OrgSpace.
- Do not create decorative analytics or metrics without real backend data.

## 12. Acceptance

### Visual comparison

Capture and inspect at `1440px`, `1024px`, `768px` and `390px`:

- login;
- organization home;
- member list and detail drawer;
- device list and revoke dialog;
- operation record list and detail drawer;
- coming-soon/empty/forbidden states.

### Required outcomes

- Login and authenticated pages clearly look like one product.
- The interface is immediately recognizable as related to homepage-v2.
- No black/red/paper legacy visual remains.
- No provisional teal theme remains as a parallel system.
- Main content uses the approved mountain title band and quiet white work surfaces.
- Create/edit forms no longer sit below resource lists.
- Desktop has no unintended horizontal overflow.
- Mobile bottom navigation and drawers remain usable at `390px`.
- Existing Web/API/CLI/Skill parity and Phase 0 behavior tests remain green.

## 13. Approved visual artifacts

The user approved:

1. A · 山水工作台 as the main direction;
2. the desktop sidebar plus mountain title band;
3. the mobile bottom-navigation variant;
4. the shared homepage-v2 login page;
5. the organization-home composition;
6. the member detail drawer and separation of ordinary/technical information.
