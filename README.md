# Tashan OrgSpace

他山组织空间（Tashan OrgSpace）是一个独立的组织协作与安全计算平台。

当前仓库已经进入按阶段执行的实现期；Phase 0 首先建立认证、权限、审计与 CLI/Web 一致性基础。

- 产品与技术总设计：[`docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md`](docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md)
- Phase 0 实施计划：[`docs/superpowers/plans/2026-08-18-phase0-security-foundation.md`](docs/superpowers/plans/2026-08-18-phase0-security-foundation.md)
- Phase 0 安全架构：[`docs/architecture/phase0-security-foundation.md`](docs/architecture/phase0-security-foundation.md)
- 本地基础设施运行手册：[`docs/runbooks/local-development.md`](docs/runbooks/local-development.md)

## 当前能力

Phase 0 已实现账号注册与登录、手机号验证、设备会话与单设备撤销、组织创建与成员隔离、追加式审计、可恢复 Outbox Worker、共享 SDK、覆盖全部 17 个能力的 `torg` CLI，以及登录/组织/设备 Web 工作台。

文件空间、OKR/任务、审批、聊天、代码运行、常驻服务、通用通知短信、自动 HTTPS 域名和 AI 员工尚未进入实现范围。账号验证码已接入阿里云短信，独立 Phase 0 后端已部署到 AUP。

## 为 Codex 安装 Skill

`v0.1.0-alpha.3` 发布后，推荐直接对任意一台电脑上的 Codex 说：

> 请把 `https://orgspace.tashan.chat/downloads/orgspace/install-skill.sh` 下载到临时文件，先查看帮助并运行 `--check`，再用 `--install` 安装 OrgSpace Skill。不要使用 `curl | sh`。

官方安装器会从他山 HTTPS 主源下载固定版本 Skill，验证 SHA256 和归档布局后原子安装到 Codex Skill 目录；新 Skill 从下一轮对话开始生效。随后只需说“使用 `$tashan-orgspace` 查看我的组织”，Skill 就会在用户目录中安装或检查带校验和的独立 `torg` CLI，不使用 `sudo`，也不要求本机预装 Node.js。CLI 主源传输失败时才会完整切换到 GitHub Release；校验和或归档异常会直接失败，不会用备用源掩盖。

GitHub 备用入口是固定 tag `v0.1.0-alpha.3` 下的 `skill/tashan-orgspace`，可由 Codex 内置 `skill-installer` 安装。macOS arm64/x64 与 Linux x64 受支持；Windows 暂不支持。

## 本地验证

### 前置条件

需要 Node.js 24.14.0、pnpm 10.32.1 和 Docker Compose。复制 `.env.example` 为 `.env`，本地 E2E 会自行使用隔离配置，不需要填写生产凭据。

### 启动与验证

```bash
pnpm install --frozen-lockfile
bash scripts/verify-phase0.sh
```

验证器会在 loopback 启动临时 E2E 服务，并在结束时停止容器；不会删除 PostgreSQL/Redis 命名卷。开发环境的启动、停止及破坏性清理边界见本地运行手册。

CLI 默认连接 `http://127.0.0.1:4110`，无参数运行只显示帮助且不读取凭据、不访问网络：

```bash
pnpm --filter @tashan/cli start --
```

## 常用命令

| 命令                            | 用途                            |
| ------------------------------- | ------------------------------- |
| `pnpm format:check`             | 检查格式                        |
| `pnpm lint`                     | 静态检查                        |
| `pnpm typecheck`                | 全仓严格类型检查                |
| `pnpm test`                     | 各 workspace 单元测试           |
| `pnpm test:distribution`        | 独立 CLI 构建、安装与空用户测试 |
| `pnpm test:e2e`                 | loopback Docker E2E             |
| `bash scripts/verify-phase0.sh` | 完整提交/CI 验证                |

## 目录结构

```text
apps/       API、CLI、Web 和 Outbox Worker
packages/   契约、能力注册表、SDK 和测试基础设施
skill/      可独立安装的 tashan-orgspace Codex Skill
release/    CLI 发布真源
scripts/    一致性门禁、发布构建和验证脚本
tests/      分发测试与 Docker E2E
docs/       架构、运行手册、产品设计与实施计划
```

## 关键文档

| 文档                                                                                                                                       | 用途                   |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| [`docs/architecture/phase0-security-foundation.md`](docs/architecture/phase0-security-foundation.md)                                       | 已实现的安全与分发边界 |
| [`docs/runbooks/local-development.md`](docs/runbooks/local-development.md)                                                                 | 本地基础设施运行手册   |
| [`docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md`](docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md)               | 产品与技术总设计       |
| [`docs/superpowers/specs/2026-08-18-skill-cli-distribution-design.md`](docs/superpowers/specs/2026-08-18-skill-cli-distribution-design.md) | Skill/CLI 分发设计     |

## 环境变量

`.env.example` 是本地配置真源。`DATABASE_URL`、JWT 密钥和阿里云短信凭据默认为空，禁止把真实值提交到 Git。`NODE_ENV=production` 时，服务端会拒绝 loopback 数据服务、占位密钥和不完整短信配置。完整字段见 [`.env.example`](.env.example)。

## 部署状态

仓库正在准备 `v0.1.0-alpha.3` 的双源安装发布；在合并、部署、打标签和公网 smoke 完成前，生产仍运行 `v0.1.0-alpha.2`。独立 Phase 0 后端位于 `https://orgspace.tashan.chat`；文件、协作、聊天和安全计算等 Phase 1+ 能力仍未发布。现有 `org.tashan.chat` 属于其他项目，不在本仓库的部署范围内。
