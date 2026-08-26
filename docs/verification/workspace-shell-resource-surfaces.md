# Workspace Shell and Resource Surfaces Verification

Date: 2026-08-26

Branch: `codex/full-product-blueprint`

## Automated evidence

- Web tests: 15 files, 79 tests passed after independent review follow-up.
- Repository pre-commit gate: format, lint, workspace typecheck, workspace tests, 14 gate registrations and all negative self-tests passed.
- Production Web build completed; the known Vite chunk-size warning remains non-blocking.
- `ORGSPACE_TEST_CLEANUP_VOLUMES=1 bash scripts/verify-phase0.sh` passed after the final browser-tested review-fix commit `285c2e4`.
- Complete verifier evidence: 79 Web tests, 29 distribution tests, fresh-user installation without system Node.js, 17 capability surfaces, 4 resource surfaces, 14 registered gates and negative self-tests, 4 isolated production-stack tests and 4 end-to-end tests.

## Real browser journey

The browser exercised the locally built production Compose stack at `http://127.0.0.1:44110` with generated test identities and no production data.

| Journey                | Evidence                                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password login         | Test account reached an authenticated organization home.                                                                                                                     |
| Organization switch    | Header switcher navigated from 研究小组 to 他山协会 using the server organization list.                                                                                      |
| Sidebar preference     | Explicit collapse changed the sidebar from 216px to 64px and remained 64px after reload.                                                                                     |
| Member list/detail     | Added a generated test member, opened the UUID detail route and verified role/activity fields.                                                                               |
| Audit list/detail      | Five organization events loaded; detail showed request, device, source IP and a redaction notice without rendering raw before/after payloads.                                |
| Device list/detail     | Two devices loaded; revoke confirmation opened and cancelled, then the device UUID detail route opened. The destructive final revoke was not executed in browser acceptance. |
| Global shell           | Account and device routes retained the same sidebar and top header after a browser-discovered correction.                                                                    |
| Forbidden organization | A valid but unauthorized organization UUID rendered `无法访问该组织`.                                                                                                        |
| Mobile navigation      | 390px viewport showed four primary links plus More; the named dialog opened and closed with Escape.                                                                          |
| List/grid control      | Search placeholder was visible; switching to grid produced three computed desktop columns and switching back restored list mode.                                             |

## Responsive and visual evidence

|  Width | Result                                                                                           |
| -----: | ------------------------------------------------------------------------------------------------ |
|  390px | document width 390px; no horizontal overflow; desktop sidebar hidden; mobile navigation visible. |
|  768px | document width 768px; 216px sidebar and 552px main region; no horizontal overflow.               |
| 1024px | document width 1024px; 216px sidebar and 808px main region; no horizontal overflow.              |
| 1440px | document width 1440px; 216px sidebar and 1224px content region; fixed shell height 900px.        |

Local acceptance screenshots (not committed to the repository):

- `orgspace-desktop-1440.png`
- `orgspace-members-1440.png`
- `orgspace-mobile-390.png`

## Findings corrected during acceptance

1. Global account/device routes initially left the unified workspace shell. They now use the same shell and organization switcher.
2. Search had no visible placeholder. It now displays the resource-specific search label.
3. List/grid appeared actionable but did not change layout. It now changes the resource surface `data-view` and computed grid columns, with a regression test.

## Independent review follow-up

A read-only reviewer reported three P1 and three P2 findings. Each was verified against source before implementation:

1. Organization creation and member addition now use a synchronous submission lock plus pending-disabled controls, preventing two distinct idempotency keys from a rapid duplicate submit.
2. Audit detail deep links now page with `limit=100` until the target is found, stop at the final page and terminate safely on a repeated cursor.
3. `/organizations` is now a real list route. React Router consumes each `resourceSurface(...)` entry, and the resource gate has a negative self-test that removes the registry mount token.
4. The legacy 5.5rem workspace header override was removed; browser-computed height is 60px with the T1 white surface.
5. The unavailable suspended-member filter was removed because the current server contract returns active memberships only.
6. Device revoke confirmation now uses the Radix modal primitive with initial focus, focus containment, Escape close and focus restoration behavior.

## Boundaries

- The acceptance stack bound its gateway only to loopback and used generated test data.
- No real SMS was sent.
- No production deployment is claimed by this report.
