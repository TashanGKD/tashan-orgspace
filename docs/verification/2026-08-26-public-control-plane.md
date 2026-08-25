# OrgSpace 公网控制面验证报告

日期：2026-08-26  
范围：Phase 0.5 公网控制面、AUP 独立生产栈、ECS HTTPS 入口、CLI/Skill alpha.2 公开发布。

## 结论

OrgSpace Phase 0 控制面已部署到 AUP，并通过 ECS 反向隧道由 `https://orgspace.tashan.chat` 提供公网 HTTPS。最终用户链路不需要 Tailscale；Tailscale 仅用于运维 SSH。API、Web、Worker、PostgreSQL、Redis、隧道和 ECS vhost 均使用 OrgSpace 独立目录、Compose project、端口与配置。

`torg 0.1.0-alpha.2` 与 Skill 已通过 GitHub PR 合并并发布为公开 prerelease。三平台 Release 资产、校验和、无系统 Node.js 的公开安装、重复安装、生产健康和能力发现均已通过。真实手机号注册/登录/设备撤销仍需要用户提供测试手机号并输入短信验证码，当前未执行，不得标记为通过。

## 本地验证

执行：

```bash
bash scripts/verify-phase0.sh
```

结果：`verify-phase0: PASS`。覆盖：

- format、lint、全仓 typecheck；
- contracts 31、capabilities 12、testkit 15、API 45、SDK 9、CLI 27、Web 46；
- 分发测试 15，空用户安装报告 `torg 0.1.0-alpha.2, no system Node.js`；
- 17 个 capability 与 11 个强制 gate；
- production contract、部署器、入口配置器、production smoke 的负例自测；
- 生产形状 Docker 栈：Web、同源 API、版本、CORS、安全响应头 3/3；
- Phase 0 Docker E2E 4/4。

生产形状测试发现并修复了三项真实问题：Docker Hub 不可达、Corepack 目标目录未创建、非 root Nginx 的 tmpfs 所有权错误。生产 contract 现强制使用经验证可达的 DaoCloud Docker Hub mirror、固定 Node/Nginx/PostgreSQL/Redis 版本、loopback 端口和 Nginx UID/GID 101。

## AUP 独立部署

生产边界：

```text
remote root: /home/aup/tashan-orgspace
Compose project: tashan-orgspace-prod
AUP gateway: 127.0.0.1:44110
ECS tunnel listener: 127.0.0.1:14010
public origin: https://orgspace.tashan.chat
```

OrgSpace secret 位于 `/home/aup/tashan-orgspace/shared/.env.production`，目录权限 `0700`、文件权限 `0600`。PostgreSQL 密码、验证码 pepper 与 Ed25519 JWT 密钥均为 OrgSpace 独立生成。阿里云短信账号、签名、模板与 endpoint 从现有受限生产配置按键名只读复制；全过程未输出值，未修改来源文件。

部署器在 Tailscale SSH 多次握手不稳定后新增了 10 秒连接超时、keepalive 和单次部署 ControlMaster 复用。中断部署未写 `.deployed-commit`；成功后才原子切换 `current`。

发布 PR #1 的合并提交、公开标签解引用结果和 AUP `.deployed-commit` 三者一致：

```text
65efc4f96b0bf5dbf313149e674ea1e8394d2c7e
```

验证报告后续的纯文档提交不会改变 alpha.2 标签或已部署运行代码；运行版本仍以以上已发布提交为准。

## 公网与运行状态

真实 HTTPS 观测：

```text
GET /                         -> 200，HTML 含 <div id="root"></div>
GET /v1/health                -> 200，status=ok，version=0.1.0-alpha.2
GET /v1/capabilities          -> 200，17 capabilities
POST /v1/auth/login with {}   -> 400（端点存在且执行校验，不是 404）
```

AUP 观测：

```text
api       running healthy
gateway   running
postgres  running healthy
redis     running healthy
worker    running
127.0.0.1:44110 LISTEN
```

未发现 `0.0.0.0:44110` 或 `[::]:44110` 监听。ECS `nginx -t` 成功。ECS 上其他站点已有的 Nginx warning 未被本次修改。

## 故障恢复

执行：

```bash
scripts/smoke-production.sh --recovery-check --confirm-production
```

结果：真实 autossh 进程被专属 PID 文件安全停止并重新启动，随后公网 `/v1/health` 恢复，报告 `PASS (tunnel stop/start recovery)`。脚本不使用可能误杀其他项目的 `pkill -f`。

## GitHub 发布

GitHub PR #1 已合并，Release workflow `32895241663` 完成。公开 prerelease：

```text
tag: v0.1.0-alpha.2
tag commit: 65efc4f96b0bf5dbf313149e674ea1e8394d2c7e
draft: false
prerelease: true
```

Release 地址：<https://github.com/TashanGKD/tashan-orgspace/releases/tag/v0.1.0-alpha.2>

公开资产：

```text
SHA256SUMS                                      313 bytes
torg-v0.1.0-alpha.2-darwin-arm64.tar.gz   38,494,617 bytes
torg-v0.1.0-alpha.2-darwin-x64.tar.gz     39,708,604 bytes
torg-v0.1.0-alpha.2-linux-x64.tar.gz      43,750,434 bytes
```

## 公开新用户安装

从 GitHub 标签 `v0.1.0-alpha.2` 的 `skill/tashan-orgspace` 安装 Skill，再由 Skill 脚本从公开 Release 安装 CLI。验收使用临时 `HOME`、`CODEX_HOME`、`XDG_DATA_HOME` 和 `TORG_BIN_DIR`，执行路径仅含系统基础目录，确认无系统 Node.js、pnpm、源码目录或 Tailscale 依赖。

```text
version=0.1.0-alpha.2
capabilities=17
no_system_node=true
health_status=ok
health_version=0.1.0-alpha.2
torg 0.1.0-alpha.2 is installed
torg 0.1.0-alpha.2 is already installed
```

CLI 的 `--version`、无参数安全帮助、JSON 健康检查、17 项能力发现和幂等重复安装均通过；输出未发现 token、密码或验证码。GitHub 源码归档不保留 shell 可执行位，因此 Skill 明确通过 `bash scripts/install-cli.sh --install` 调用安装器，不依赖归档的可执行权限。

## 其他项目隔离证据

OrgSpace 上线前 Panshi 首页为 200。验证期间 Panshi 后续返回带 `Retry-After: 4200` 的定制维护页。只读调查确认这是另一维护流程在 2026-08-26 03:49 主动完成的操作：

- Panshi vhost 被替换为显式 `return 503` 的维护配置；
- 数据库被设为只读并执行 `pg_dump`；
- Panshi API/PostgreSQL 以 Exit 0 正常停止；
- Panshi 前端本地仍为 200，专用 autossh `13200 -> 3200` 持续运行；
- OrgSpace 使用 `14010 -> 44110`，无端口、vhost、目录或 Compose project 重叠。

因此不应由 OrgSpace 流程撤销 Panshi 的有意维护状态。部署前还发现 `ask.tashan.chat` 证书已过期；本次未修改 Ask。

## 未完成验收与产品边界

以下项目必须保持未通过状态，直到获得真实证据：

1. 尚未使用真实手机号完成验证码注册、登录、组织列表、设备列表、当前设备撤销和旧会话拒绝；这也是 Task 9 Step 4 与 Task 10 Step 4 仍未勾选的原因。
2. 文件、任务/OKR、通知、聊天、代码运行、Docker build、常驻服务与动态用户域名属于 Phase 1+，尚未实现。alpha.2 是公网控制面 prerelease，不代表完整产品已经完成。

## alpha.3 双源分发修复

随后按真实新用户方法创建两个 `fork_turns=none` 子智能体；每个只知道自己的手机号和已经公开安装的 alpha.2 Skill，禁止读取仓库、服务器、历史对话或另一个用户状态。两者均在 Skill 官方 CLI 安装器下载 GitHub Release `SHA256SUMS` 时失败，未获得 CLI、未发送新短信、未创建账号。该结果推翻了“单次公开安装成功足以证明一键安装可靠”的结论。

`v0.1.0-alpha.3` 因此引入：

- `orgspace.tashan.chat/downloads/orgspace` 官方 HTTPS 主源；
- GitHub 固定 tag/Release 备用源；
- Skill 与三平台 CLI 的统一校验和；
- 仅传输失败才回退、完整性失败立即停止的来源状态机；
- AUP 只读静态挂载、不可变版本目录、原子发布器与公网 smoke。

本节记录的是修复动机和实现范围，不是上线结论。只有 alpha.3 合并、部署、发布、镜像 smoke 和两个全新用户完整账号流程都取得真实证据后，才能标记为通过。
