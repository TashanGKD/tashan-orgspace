# OrgSpace 公网控制面验证报告

日期：2026-08-26  
范围：Phase 0.5 公网控制面、AUP 独立生产栈、ECS HTTPS 入口、CLI/Skill alpha.2 发布候选。

## 结论

OrgSpace Phase 0 控制面已部署到 AUP，并通过 ECS 反向隧道由 `https://orgspace.tashan.chat` 提供公网 HTTPS。最终用户链路不需要 Tailscale；Tailscale 仅用于运维 SSH。API、Web、Worker、PostgreSQL、Redis、隧道和 ECS vhost 均使用 OrgSpace 独立目录、Compose project、端口与配置。

`torg 0.1.0-alpha.2` 与 Skill 的本地发布候选已通过完整验证和无系统 Node.js 的新用户安装测试。GitHub PR、标签、三平台 Release 资产及真实公开安装仍需在本报告之后完成。真实手机号注册/登录/设备撤销需要用户提供测试手机号并输入短信验证码，当前未执行，不得标记为通过。

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

部署器在 Tailscale SSH 多次握手不稳定后新增了 10 秒连接超时、keepalive 和单次部署 ControlMaster 复用。中断部署未写 `.deployed-commit`；成功后才原子切换 `current`。2026-08-26 生产指针曾验证为：

```text
481a665cd6af975a40fe7d863a16abf08b5f5fe2
```

本报告提交后需再部署最终提交，使生产指针与发布候选完全一致。

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

## 其他项目隔离证据

OrgSpace 上线前 Panshi 首页为 200。验证期间 Panshi 后续返回带 `Retry-After: 4200` 的定制维护页。只读调查确认这是另一维护流程在 2026-08-26 03:49 主动完成的操作：

- Panshi vhost 被替换为显式 `return 503` 的维护配置；
- 数据库被设为只读并执行 `pg_dump`；
- Panshi API/PostgreSQL 以 Exit 0 正常停止；
- Panshi 前端本地仍为 200，专用 autossh `13200 -> 3200` 持续运行；
- OrgSpace 使用 `14010 -> 44110`，无端口、vhost、目录或 Compose project 重叠。

因此不应由 OrgSpace 流程撤销 Panshi 的有意维护状态。部署前还发现 `ask.tashan.chat` 证书已过期；本次未修改 Ask。

## 未完成验收

以下项目必须保持未通过状态，直到获得真实证据：

1. `v0.1.0-alpha.2` 尚未合并、打标签并生成三平台公开 Release 资产。
2. 尚未从无源码、无 Node、无 Tailscale 的临时用户环境安装公开 alpha.2 Skill/CLI。
3. 尚未使用真实手机号完成验证码注册、登录、设备列表、当前设备撤销和旧会话拒绝。
4. 文件、任务/OKR、通知、聊天、代码运行、Docker build、常驻服务与动态用户域名属于 Phase 1+，尚未实现。
