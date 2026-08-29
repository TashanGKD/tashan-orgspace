# Tashan OrgSpace

<!-- DEFERRED_PRODUCT_SCOPE: general-compute,user-web-hosting -->

他山组织空间（Tashan OrgSpace）是一个独立的组织协作与文件平台。

当前仓库已经完成 Phase 0 安全基础和 Phase 1 空间/文件能力的本地验收，正在按统一计划继续实现组织协作能力。

- 产品与技术总设计：[`docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md`](docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md)
- Phase 0 实施计划：[`docs/superpowers/plans/2026-08-18-phase0-security-foundation.md`](docs/superpowers/plans/2026-08-18-phase0-security-foundation.md)
- Phase 0 安全架构：[`docs/architecture/phase0-security-foundation.md`](docs/architecture/phase0-security-foundation.md)
- 本地基础设施运行手册：[`docs/runbooks/local-development.md`](docs/runbooks/local-development.md)
- 完整前端蓝图：[`docs/superpowers/specs/2026-08-26-full-product-frontend-blueprint.md`](docs/superpowers/specs/2026-08-26-full-product-frontend-blueprint.md)
- 完整产品交付计划：[`docs/superpowers/plans/2026-08-26-full-product-delivery.md`](docs/superpowers/plans/2026-08-26-full-product-delivery.md)
- 工作台与通用列表详情实施计划：[`docs/superpowers/plans/2026-08-26-workspace-shell-resource-surfaces.md`](docs/superpowers/plans/2026-08-26-workspace-shell-resource-surfaces.md)

## 当前能力

Phase 0 已实现账号注册与登录、手机号验证、设备会话与单设备撤销、组织创建与成员隔离、追加式审计、可恢复 Outbox Worker、共享 SDK，以及登录/组织/设备 Web 工作台。

Phase 1 已实现个人与组织文件空间、50 GB 默认个人额度与最高 500 GB 组织授权额度、500 GB 组织额度、公开/受限文件夹、manager/editor/viewer、管理员元数据查看与 manager 恢复、断点续传、版本、下载校验、30 天回收站和 MinIO/Worker 恢复。Phase 2 的任务、会议、指派与版本化审批 API/SDK/CLI 已进入实现分支；Web 尚未开放。当前注册表共有 62 个能力。

OKR/任务、审批、通知短信和聊天仍待实现。运行与构建、用户网站、服务、数据库、daemon 和用户域名作为延期方向保留在导航并标记“即将上线”，不属于当前实现或 v1 验收。账号验证码已接入阿里云短信；公开 AUP 环境当前仍是 Phase 0 版本，Phase 1 尚未部署。

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

验证器会在 loopback 启动隔离的临时 E2E/生产形态服务，结束时只删除本次测试项目的容器、网络和命名卷，不会触碰开发环境的数据卷。开发环境的启动、停止及破坏性清理边界见本地运行手册。

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

| 文档                                                                                                                                               | 用途                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| [`docs/architecture/phase0-security-foundation.md`](docs/architecture/phase0-security-foundation.md)                                               | 已实现的安全与分发边界 |
| [`docs/verification/spaces-files-quotas.md`](docs/verification/spaces-files-quotas.md)                                                             | Phase 1 文件验收证据   |
| [`docs/runbooks/local-development.md`](docs/runbooks/local-development.md)                                                                         | 本地基础设施运行手册   |
| [`docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md`](docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md)                       | 产品与技术总设计       |
| [`docs/superpowers/specs/2026-08-18-skill-cli-distribution-design.md`](docs/superpowers/specs/2026-08-18-skill-cli-distribution-design.md)         | Skill/CLI 分发设计     |
| [`docs/superpowers/specs/2026-08-26-full-product-frontend-blueprint.md`](docs/superpowers/specs/2026-08-26-full-product-frontend-blueprint.md)     | 完整前端与统一对象交互 |
| [`docs/superpowers/plans/2026-08-26-full-product-delivery.md`](docs/superpowers/plans/2026-08-26-full-product-delivery.md)                         | 完整产品全栈交付顺序   |
| [`docs/superpowers/plans/2026-08-26-workspace-shell-resource-surfaces.md`](docs/superpowers/plans/2026-08-26-workspace-shell-resource-surfaces.md) | 工作台基础实施计划     |

## 环境变量

`.env.example` 是本地配置真源。`DATABASE_URL`、JWT 密钥和阿里云短信凭据默认为空，禁止把真实值提交到 Git。`NODE_ENV=production` 时，服务端会拒绝 loopback 数据服务、占位密钥和不完整短信配置。完整字段见 [`.env.example`](.env.example)。

## 部署状态

当前公开 prerelease 为 `v0.1.0-alpha.3`，独立 Phase 0 后端已部署到 `https://orgspace.tashan.chat`，官方 Skill/CLI 镜像和 GitHub 备用 Release 均已发布。Phase 1 文件能力已在提交 `9d31ae527325ff10fc9f35fead2317a77c338dc4` 完成本地与生产形态验收，但尚未部署或发布新版本；协作与聊天仍在后续 Phase。现有 `org.tashan.chat` 属于其他项目，不在本仓库的部署范围内。
