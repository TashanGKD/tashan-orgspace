# Homepage-v2 Workbench Redesign Verification

Date: 2026-08-28

Result: PASS

Verified implementation commit: `f88724ec55f39d8d599414afbd04f51965f61d0e`

## Scope verified

- Login, registration and password-reset entry surfaces use the same homepage-v2 brand system.
- Desktop uses the 208px/64px workspace sidebar and 60px header.
- Mobile uses four core destinations plus More in a 70px + safe-area bottom bar.
- Organization, member, device and operation-record resources retain the list while opening detail routes in drawers.
- Create organization and add member use right-side forms rather than forms below lists.
- Technical IDs, request IDs, IP and device evidence remain available under `技术信息`.
- Backend, SDK, CLI and Skill capability contracts were not changed by the visual redesign.

## Automated verification

The final command was run from the repository root:

```bash
ORGSPACE_TEST_CLEANUP_VOLUMES=1 bash scripts/verify-phase0.sh
```

Final output: `verify-phase0: PASS`.

Evidence within that run:

- format and ESLint: PASS;
- repository typecheck: PASS;
- Web: 18 test files, 93 tests passed;
- distribution: 4 test files, 29 tests passed;
- fresh-user installation: PASS on `darwin-arm64` without system Node.js;
- capability, phone-auth, release, resource-surface, user-copy, production and brand contracts: PASS;
- brand contract: 3 reviewed assets, 7 stylesheets, 0 violations;
- gate discovery: 16 gates, every gate has a self-test;
- isolated production stack: 4 tests passed;
- end-to-end suite: 4 tests passed.

The production build emits one non-blocking performance warning for a JavaScript chunk around 621 kB. It does not affect this visual acceptance and remains future code-splitting work.

## Brand and safety gates

`scripts/check-web-brand-contract.mjs` now enforces:

- the exact reviewed homepage-v2 asset paths, sources and SHA-256 values;
- rejection when an asset and its manifest checksum are changed together;
- no absolute paths, traversal paths or symbolic-link escapes;
- exact modular `styles.css` imports;
- no legacy tokens, black/red/paper colors, serif root fonts or remote brand hotlinks;
- scanning of the Web source and root `index.html`;
- WCAG AA 4.5:1 contrast for secondary and tertiary text on primary and secondary surfaces.

Its self-test constructs and rejects every corresponding violation.

## Real browser acceptance

The browser exercised the built production Compose stack at `http://127.0.0.1:44110` with a synthetic local account and organization. No real phone number or SMS provider was used. The stack bound only to loopback and was deleted after acceptance, including its containers, network, two test volumes and temporary key directory.

Journeys exercised:

- login entry and the three account tabs;
- authenticated organization list and organization detail drawer;
- sidebar collapse from complete logo to square logo;
- member list, member detail drawer and add-member form drawer;
- device list and device detail drawer;
- operation-record list and detail drawer with the full list retained behind it;
- coming-soon module state;
- keyboard-visible focus;
- 1440, 1024, 768 and 390 widths.

Width evidence:

| Viewport   | Result                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| 1440 × 900 | 208px sidebar, 60px header, 480px drawer, no horizontal overflow                                              |
| 1024 × 900 | 208px sidebar, 768px work area, no horizontal overflow                                                        |
| 768 × 900  | account text collapses to the avatar before the mobile breakpoint; no clipping or overflow                    |
| 390 × 844  | sidebar hidden, five mobile navigation actions, 70px bar without a safe-area inset and no horizontal overflow |

Key measurements from the page:

- collapsed sidebar: approximately 64px and `/media/brand/logo-square.webp`;
- desktop drawer: 480px;
- mobile content bottom padding: 86px with zero simulated safe-area inset;
- final body stack: `Inter`, Chinese system fallbacks and system sans-serif;
- tertiary text token: `#5b7080`;
- operation-record detail retained 12 background rows in the exercised session;
- no raw before/after secret payload appeared in the operation-record UI.

## Screenshot evidence

All screenshots below are final-state evidence. Earlier screenshots that exposed the stretched 620px drawer and the 768px vertical account-name defect were removed after the fixes were verified.

- [Login desktop](/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-workbench-acceptance/login-1440.png)
- [Login mobile](/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-workbench-acceptance/login-390.png)
- [Organization home](/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-workbench-acceptance/home-1440.png)
- [Organization drawer, fixed](/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-workbench-acceptance/organization-drawer-fixed-1440.png)
- [Member list](/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-workbench-acceptance/members-list-1440.png)
- [Member detail drawer](/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-workbench-acceptance/member-drawer-1440.png)
- [Add-member drawer](/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-workbench-acceptance/member-form-1440.png)
- [Member page at 1024](/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-workbench-acceptance/members-1024.png)
- [Member page at 768, fixed](/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-workbench-acceptance/members-768-fixed.png)
- [Member page at 390](/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-workbench-acceptance/members-mobile-390.png)
- [Device list](/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-workbench-acceptance/devices-list-1440.png)
- [Device detail](/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-workbench-acceptance/device-detail-1440.png)
- [Operation records](/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-workbench-acceptance/audit-list-1440.png)
- [Operation detail](/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-workbench-acceptance/audit-detail-1440.png)
- [Coming-soon state](/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-workbench-acceptance/coming-soon-1440.png)

## Independent audit closure

An independent read-only audit originally found asset-lock, contrast, audit-list context, authenticated boundary, safe-area, scan-scope, drawer-width, typography and breakpoint gaps. A second read-only pass confirmed the asset lock, contrast, audit list, safe-area and visual-dimension fixes. Its remaining code findings—root `index.html` scanning and the account-only shell on `/account`—were then closed with additional negative and route tests before the final `verify-phase0` run.

No acceptance blocker remains for the homepage-v2 workbench redesign.
