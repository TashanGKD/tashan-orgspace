# Phase 0 验证记录

- 日期：2026-08-18
- 已验证候选提交：`6dbb31bc9d584e0f7775b591014fbd6e8ca53388`
- 分支：`codex/phase0-plan`

## 最终结果

在干净工作树上运行 `bash scripts/verify-phase0.sh`，结果为 `verify-phase0: PASS`。

- 工具链、Prettier、ESLint、TypeScript：通过。
- 单元测试：117 项通过。
- 能力一致性：17 个能力，0 个违规。
- 门禁清单：5 个门禁，0 个缺失自测。
- 门禁负向自测：能力覆盖、门禁清单、提交证据均通过。
- 真实 E2E：3 项通过；使用 loopback Docker Compose、隔离数据库、真实 HTTP、CLI 子进程和 Worker，结束后容器与网络已停止。
- Phase 0 verifier 负向自测：删除 `device.revoke` CLI 绑定时，内层验证器以 `missing CLI binding: device.revoke` 失败，外层自测通过；真实树随后重新验证通过。

## 终审证据

- `git diff main...HEAD` 的实现范围仅包含 Phase 0 身份、设备、组织隔离、审计、Outbox、SDK、CLI、Web 外壳与验证基础；Phase 1 及以后能力只作为文档中的非目标出现。
- 所有 `scripts/check-*.mjs` 与 `scripts/verify-*.sh` 都由门禁清单确认有同名 `*.self-test.*`。
- 未跟踪运行时 `.env`、私钥/证书、数据库卷、Redis 数据或本地凭据文件；`.env.example` 只含空值和 loopback 开发默认值。
- 私钥头、常见云访问密钥和长 API token 形状扫描无匹配；手机号形状仅存在于自动化测试夹具和计划示例中，不是生产成员数据。
- CLI 单元测试确认撤销当前设备必须显式提供 `--allow-current-device`；E2E 确认从另一台设备撤销目标设备后，目标会话失效、操作设备会话仍有效。
- 跨组织 E2E 使用双方真实组织 UUID，确认三次访问都返回 `ORG_FORBIDDEN`，并直接查询审计表确认三次拒绝均以 `result = rejected`、`error_code = ORG_FORBIDDEN` 落库。

## 机制观察

- 本轮实际触发一：Phase 0 verifier 负向自测删除 CLI 绑定后，能力绑定加载以明确能力 ID 拒绝，证明门禁能抓住目标业务漂移。
- 本轮实际触发二：门禁清单识别 5 个门禁，并强制新加入的 `verify-phase0.sh` 存在同名负向自测。
- 本轮未触发之处：最初的跨组织 E2E 只断言了 `ORG_FORBIDDEN`，没有断言拒绝审计落库；现有门禁没有发现这层证据缺口。终审补充了真实数据库断言并重新运行 E2E 与完整验证器。
