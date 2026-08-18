# Phase 0 安全基础架构

本文档记录 Phase 0 已实现且由测试验证的边界。服务端能力注册表、Zod 契约和 SQL migration 仍是机器可执行的真源；本文不替代它们。

## 系统边界

Phase 0 由一个 Fastify 控制面 API、PostgreSQL、Redis、可恢复 Outbox Worker、共享 TypeScript SDK、`torg` CLI 和最小 Web 工作台组成。CLI 与 Web 使用同一 SDK；所有授权判断均在服务端完成。

源码 checkout 默认只连接 loopback。生产配置拒绝 loopback 数据服务、通配 CORS、占位 pepper、缺失 JWT 密钥和未配置完整凭据的短信提供商。

## 身份、角色与渠道

- Principal 类型：`human`、`system`、预留的 `ai_employee`、`service_account`；Phase 0 只允许创建 `human` 与 `system`。
- 平台/组织角色：`platform_superadmin`、`platform_operator`、`org_owner`、`org_admin`、`member`；组织 Membership 只能使用后三种。
- 已认证客户端渠道：`web`、`cli`。
- 审计 actor source：`web`、`cli`、`ai_via_cli`、`system`。只有已认证 CLI 会话配合请求声明时才能记为 `ai_via_cli`。
- 一个账号对应一个真实人员；设备用稳定 UUID 区分。撤销一个设备会撤销该设备的会话，不影响同账号其他设备。
- 未验证手机号的账号不能创建组织，也不能被加入有效 Membership。

## Token 生命周期

密码以 Argon2id 摘要保存。登录创建绑定账号、Principal、设备和客户端渠道的 Session，并签发短期 EdDSA access token 与单次轮换 refresh token。Refresh token 只以摘要形式入库；旧 token 被重用时整条 Session 被撤销。

CLI 将 token 保存到 macOS Keychain、Linux Secret Service、进程内存，或用户显式选择的 AES-256-GCM 加密文件。CLI 不接受明文 `--password` 参数。

Web 只把 access token 留在内存。refresh token 由 API 写入 `__Host-torg_refresh` Cookie，属性为 `HttpOnly; Secure; SameSite=Strict; Path=/`；页面启动时通过 Cookie 静默轮换并恢复会话。Web fetch 明确使用 `credentials: include`，不会把 refresh token写入 localStorage/sessionStorage。

## HTTP 路由与能力 ID

| HTTP   | 路由                                        | Capability ID              |
| ------ | ------------------------------------------- | -------------------------- |
| GET    | `/v1/health`                                | `system.health.read`       |
| GET    | `/v1/capabilities`                          | `capability.list`          |
| GET    | `/v1/capabilities/:capabilityId`            | `capability.describe`      |
| POST   | `/v1/phone-verifications`                   | `auth.phone.start`         |
| POST   | `/v1/phone-verifications/confirm`           | `auth.phone.confirm`       |
| POST   | `/v1/auth/register`                         | `auth.register`            |
| POST   | `/v1/auth/login`                            | `auth.login`               |
| POST   | `/v1/auth/refresh`                          | `auth.refresh`             |
| POST   | `/v1/auth/logout`                           | `auth.logout`              |
| GET    | `/v1/auth/whoami`                           | `auth.whoami`              |
| GET    | `/v1/devices`                               | `device.list`              |
| DELETE | `/v1/devices/:deviceId`                     | `device.revoke`            |
| GET    | `/v1/organizations`                         | `organization.list`        |
| POST   | `/v1/organizations`                         | `organization.create`      |
| GET    | `/v1/organizations/:organizationId/members` | `organization.member.list` |
| POST   | `/v1/organizations/:organizationId/members` | `organization.member.add`  |
| GET    | `/v1/audit-events`                          | `audit.list`               |

所有 17 个能力必须存在 CLI 叶子命令和 Skill 引用；标记为 `web: required` 的能力还必须存在 Web surface。CI 的 capability gate 对三侧做集合一致性检查。

## PostgreSQL 表

- `accounts`：登录名、密码摘要、已验证手机号和账号状态。
- `principals`：统一行为主体，为未来 AI 员工与 service account 保留类型。
- `phone_verifications`：短期验证码摘要、尝试次数、过期和消费状态。
- `organizations`：组织状态与默认 500 GB 空间额度。
- `memberships`：组织、账号、角色和成员状态的唯一关系。
- `devices`：设备 ID、名称、OS、架构、客户端版本和撤销时间。
- `sessions`：设备绑定会话、token version、渠道和有效期。
- `session_refresh_tokens`：refresh token 家族、轮换和重用检测状态。
- `idempotency_records`：行为主体、能力、幂等键、请求摘要和响应快照。
- `outbox_events`：事务性事件、lease、重试和 dead-letter 状态。
- `audit_events`：追加式、哈希链接的账号级或组织级审计证据。
- `schema_migrations`：已应用 migration 清单，由迁移器管理。

Mutation Coordinator 在同一 PostgreSQL 事务中完成领域写入、成功审计、Outbox 和幂等结果。Worker 使用 `FOR UPDATE SKIP LOCKED` 领取事件；过期 lease 可恢复，未知事件进入 dead letter。

## 组织隔离与审计

组织资源的授权依据是服务端从 token 得到的账号与数据库中的有效 Membership，不接受客户端自报角色或组织身份。使用另一个组织的真实 UUID 仍返回 `ORG_FORBIDDEN`。设备撤销是账号级安全事件，因此其 `organization_id` 为空；成员变更等组织工作进入相应组织审计链。

每条审计记录包含服务端观察到的 IP、可信代理链、账号/Principal/Session/设备、设备名、OS、架构、客户端版本、入口渠道、请求 ID、幂等键、结果和错误码。密码、token、Cookie、验证码、secret 和完整手机号在进入审计状态前被删除或脱敏。数据库触发器拒绝审计记录的 UPDATE/DELETE。

只有直接网络 peer 落在显式 `TRUSTED_PROXY_CIDRS` 时才解析 `X-Forwarded-For`。链长度受限，地址逐个解析；不可信 peer、畸形地址或畸形链一律忽略转发头。请求上下文在 Cookie/CORS 等插件之前初始化，避免早期错误绕过审计错误处理。

## 验证层

`bash scripts/verify-phase0.sh` 依次执行工具链、格式、lint、严格类型、单元测试、能力一致性、门禁清单、负向自测试和完整 E2E。E2E 使用 loopback Compose、隔离测试数据库、随机 API 端口、真实 HTTP、真实 CLI 子进程和 Worker；每次运行都在 `finally` 中停止子进程与容器，但不删除命名卷。

## 明确不在 Phase 0

文件上传下载、个人/组织文件系统、OKR、任务、审批、短信生产发送、聊天、代码执行、Docker 构建、常驻服务、数据库产品、动态 `tashan.chat` HTTPS 域名、AI 员工、独立 Skill 的完整命令说明和 AUP 生产部署均属于后续阶段。本阶段只提供它们所依赖的身份、授权、审计、能力与客户端基础。
