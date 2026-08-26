# User-facing Copy Verification

Date: 2026-08-26

Code commit: `100fc2c`

## Automated verification

- Web: 16 test files, 83 tests passed.
- Distribution: 4 files, 29 tests passed.
- Fresh-user installation passed on macOS arm64 without system Node.js.
- User-copy gate passed with 17 capability labels and 0 violations.
- Gate discovery passed with 15 production gates and their self-tests.
- Isolated production stack passed 4 tests.
- End-to-end suite passed 4 tests.
- Full command: `ORGSPACE_TEST_CLEANUP_VOLUMES=1 bash scripts/verify-phase0.sh` returned `verify-phase0: PASS`.

The user-copy self-test proves the gate rejects a prohibited phrase, a missing audit label and a technical capability ID used as its own display label.

## Browser acceptance

The final Web build was exercised through the loopback-only production Compose stack. Test identities and preserved local acceptance data were used; no real SMS or production data was involved.

| Surface            | Evidence                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Login              | Shows `他山组织空间`, `登录后查看你加入的组织`, `手机号登录`, `管理登录设备`, and `加入多个组织`. No prohibited architecture phrase appeared. |
| Organization       | Shows `查看和创建组织`; organization list text contains no UUID.                                                                              |
| Members            | Shows `查看和添加组织成员`; member list contains names, roles and status without account UUIDs.                                               |
| Devices            | Shows `查看和管理登录设备`; the revoke dialog says `撤销后，这台设备需要重新登录。`                                                           |
| Operation records  | Page title is `操作记录`; list uses labels such as `添加组织成员`, `查看组织成员` and source `网页`; list contains no request ID.             |
| Operation detail   | Keeps raw capability ID, request ID, object ID, device and network evidence; shows `部分敏感信息已隐藏`.                                      |
| Search             | Searching `添加组织成员` returned the matching operation.                                                                                     |
| Unavailable module | Shows the direct module description and `此功能暂未开放`; no product-boundary or server-operation explanation appeared.                       |
| Mobile             | At 390×844, document width remained 390px, direct organization copy was visible and no UUID appeared.                                         |

## Local screenshots

- `/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-copy-login-1440.png`
- `/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-copy-members-1440.png`
- `/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-copy-audit-1440.png`
- `/Users/boyuan/.codex/visualizations/2026/08/25/01a0378e-d66e-71f0-9185-cba3540bc622/orgspace-copy-mobile-390.png`

## Boundary

This pass changes Web presentation only. API capability IDs, audit evidence, CLI commands, Skill references and database fields remain unchanged.

No production deployment is claimed by this report.
