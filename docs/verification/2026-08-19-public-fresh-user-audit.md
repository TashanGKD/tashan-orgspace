# `v0.1.0-alpha.1` 公开新用户验收

日期：2026-08-19（Asia/Shanghai）

## 结论

公开 Skill 与 CLI 的新用户安装链路通过；生产后端尚未上线，不能登录或调用组织能力。

- 公开仓库：<https://github.com/TashanGKD/tashan-orgspace>
- 预发布：<https://github.com/TashanGKD/tashan-orgspace/releases/tag/v0.1.0-alpha.1>
- Release 流水线：<https://github.com/TashanGKD/tashan-orgspace/actions/runs/32156792526>

Release 流水线在 macOS arm64、macOS x64 和 Linux x64 原生 runner 上构建，汇总三个资产并验证 `SHA256SUMS` 后发布。独立测试员与主代理分别使用不同的临时 HOME 从公开 GitHub 重新安装，没有从本地工作区复制 Skill 或 CLI。

## 独立黑盒验收

| 场景                                         | 结果 | 证据摘要                                                  |
| -------------------------------------------- | ---- | --------------------------------------------------------- |
| 官方 Codex `skill-installer` 从公开 tag 安装 | PASS | 退出 0，安装到空 CODEX_HOME                               |
| Skill 文件与 `quick_validate.py`             | PASS | `SKILL.md`、`release.json`、安装器存在；`Skill is valid!` |
| 安装器无参数                                 | PASS | 退出 0，只显示帮助，不创建 CLI                            |
| 未安装状态 `--check`                         | PASS | 退出 1，明确报告尚未安装                                  |
| 从真实 GitHub Release 首次安装               | PASS | 安装 `torg 0.1.0-alpha.1`                                 |
| 无系统 Node 的 PATH 启动                     | PASS | `command -v node` 退出 1；`torg --version` 退出 0         |
| CLI 无参数帮助                               | PASS | 列出 health/capability/auth/device/org/audit              |
| 安装器检查与重复安装                         | PASS | `--check` 退出 0；第二次安装报告 already installed        |
| 非托管 `~/.local/bin/torg`                   | PASS | fail-closed，拒绝覆盖；文件前后 SHA-256 相同              |
| 公开资产独立 SHA-256                         | PASS | darwin-arm64 实算值与 `SHA256SUMS` 一致                   |
| 默认生产 `health`                            | FAIL | 退出 1：`OrgSpace API returned malformed JSON`            |

生产 `health` 的 HTTP 入口当前返回 404。因此“Skill 可安装”“CLI 可启动”和“生产后端可用”是三个不同结论；本次只确认前两项。

## 主代理独立复核

主代理再次使用新的 HOME/CODEX_HOME，从公开仓库 `main` 安装 Skill，然后由安装后的脚本下载正式 Release。结果：

- Skill 系统校验通过；
- `torg 0.1.0-alpha.1` 安装与 `--check` 通过；
- PATH 中没有系统 Node 时，`--version` 和无参数帮助通过；
- 默认生产 `health` 同样退出 1，并返回相同的 malformed JSON 错误；
- 公开 `SKILL.md` HTTP 200，生产 `/v1/health` HTTP 404。

## 机制复盘

### 任务评估

分发、公开发布和新用户安装目标已完成。生产 API、账号登录和 Phase 1 之后的文件/任务/执行能力没有部署，因此不在本次完成结论内。

### 本轮发现与修复

1. 真正从 `~/.local/bin/torg` 符号链接启动时，旧 launcher 会把内置 Node 定位到错误目录。新增符号链接启动测试后修复 launcher，再由空用户测试验证。
2. CLI 版本从开发值进入预发布后，E2E 对审计设备版本仍硬编码旧值。现改为直接读取 CLI package 版本，避免再次漂移（`tests/e2e/audit-evidence.test.ts:3-4,25-33`）。
3. 发布矩阵、Skill 固定版本、安装器平台白名单和生产域名现在由同一发布门禁比较，不再依赖人工同步（`scripts/check-release-contract.mjs:105-145`）。

### 机制可观测性

本轮实际触发的机制：

- 安装器负向测试真实覆盖校验和篡改、缺项、额外目录、归档链接、smoke 失败和部分安装清理（`tests/distribution/install-cli.test.ts:190-205`）。
- 非托管命令保护在单元测试和独立黑盒测试中都拒绝覆盖（`tests/distribution/install-cli.test.ts:207-217`）。
- Release job 要求恰好三个资产并逐一验证 SHA-256 后才发布（`.github/workflows/release-cli.yml:97-104`）；公开 run 32156792526 全部成功。

没有及时触发的机制：

- commit-time hook 只运行 workspace 单测和静态门禁，没有运行 Docker E2E（`.githooks/pre-commit:4-15`），所以旧的 E2E 版本常量未在首次版本提交时被拦截；完整验证器随后在发布前运行 E2E 并捕获它（`scripts/verify-phase0.sh:14-27`）。该具体漂移已通过从 package 真源读取版本修复，而不是再维护第二个常量。
