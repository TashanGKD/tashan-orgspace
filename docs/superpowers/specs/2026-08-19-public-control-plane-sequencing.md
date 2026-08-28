# OrgSpace 公网控制面前置规格

<!-- DEFERRED_PRODUCT_SCOPE: general-compute,user-web-hosting -->

日期：2026-08-19  
状态：用户已选择方案 1；本文件是对已批准总设计交付顺序的补充，不改变其身份、权限与空间安全模型。

## 目标

让任意用户在自己的电脑上安装 `tashan-orgspace` Skill 与 `torg` CLI 后，不安装 Tailscale、不获得 AUP SSH 权限，也能通过 `https://orgspace.tashan.chat` 登录并操作自己被授权的个人空间和组织空间。

## 已确认的边界

- 运维访问与最终用户访问严格分离：运维可使用 `ssh aup-server` 经 Tailscale 做部署和排障；最终用户、CLI、Web 与未来 AI 只能使用 HTTPS API 和用户设备会话。
- ECS 是公网 TLS 与域名入口；AUP 只接受来自平台级持久反向隧道的请求，不向用户暴露 SSH、宿主机端口、Docker socket 或控制面文件。
- 默认公开地址为 `https://orgspace.tashan.chat`。正式 Release 中 `torg` 指向此地址；源码开发默认仍指向 loopback，避免本地命令意外访问生产。
- 用户注册、登录、组织、文件与协作能力始终经过同一 API、权限、审计和 capability manifest；Web 不拥有独立的业务后端。

## 采用的交付顺序

原总设计把动态服务公网入口放在最后；为满足“无 Tailscale 的真实用户立即可用”，改为先交付一个不含用户运行时的公网控制面。它不提前开放 Docker、任意端口、用户代码执行或服务公开。

### Phase 0.5：公网生产控制面

部署独立 OrgSpace API、Worker、PostgreSQL 与 Redis 到 AUP 的独立目录和独立 Compose project；ECS 为 `orgspace.tashan.chat` 配置 TLS 与唯一上游；AUP 主动建立可监控、可恢复的反向隧道。生产环境只接受 HTTPS，健康检查、反向代理头与 CORS 采用明确 allowlist。

本阶段完成后，外部用户可以通过 Web/CLI 注册、登录、查看设备、创建或加入组织，并使用已完成的 Phase 0 功能；所有操作以用户本人的设备 token 记账。它是后续每项 CLI 能力的真实生产入口。

### Phase 1：空间闭环

在同一公网控制面上交付个人/组织空间、对象存储、50 GiB 个人默认配额与可由管理员调整至 500 GiB、500 GiB 组织配额、分片上传、下载、读取、搜索、回收站和 CLI `file` 命令组。文件 API 只给经过授权的短期上传/下载能力，不允许用户直接取得对象存储凭据。

### Phase 2 至 Phase 4：组织协作闭环

按总设计依次交付 WorkItem/任务/会议/审批/OKR、站内通知与阿里云短信、单聊与群聊。每项能力均同步交付 CLI、API、审计、拒绝测试与 capability gate；Web 可逐步增强，但不得形成只在 Web 可用的业务能力。

### 延期方向：计算执行与用户网站托管

用户运行 Python、Node.js、编译语言、Docker 构建、数据库、daemon、用户服务域名与 `service public` 均不属于当前实现或 v1 验收。导航仅保留四个“即将上线”方向；它们不拥有 capability、CLI/Skill 命令或 API 写入路径。

当前网关只服务 OrgSpace 自己的 Web/API，不代理用户工作负载或用户网站。若未来重新启动本方向，必须重新完成隔离、资源、网络、动态路由和公开访问的设计与验收。

## 公网链路

```text
用户的 Codex / torg / Web
        │ HTTPS + 用户设备 token
        ▼
orgspace.tashan.chat (ECS: TLS, WAF/限流, Nginx)
        │ 平台专用反向隧道
        ▼
AUP: OrgSpace API / Worker / DB / Redis
        │ 受 API 授权的内部控制请求
        ▼
后续的对象存储与协作服务
```

Tailscale 不处在用户数据链路中。它只用于运维人员进入 AUP/ECS 维护上述平台组件。

## 安全与可用性门槛

在 Phase 0.5 上线前必须验证：

1. 外网 HTTPS 访问 API 成功，直接访问 AUP API 端口失败或不可路由。
2. `torg` 生产 Release 的默认地址正确；源码 CLI 无参数与本地开发仍不访问生产。
3. 注册、登录、刷新、登出、设备撤销与密码重置在真实 HTTPS 链路可用；日志不出现密码、验证码、access/refresh token 或完整手机号。
4. ECS→AUP 隧道中断、AUP 重启和 Worker 重启均有健康监控、明确故障语义和恢复步骤；不存在把请求悄悄转发到其他项目的端口的回退。
5. 独立测试账号在未加入组织、加入组织、被撤销设备和跨组织访问时分别得到正确拒绝或授权结果。
6. 生产数据库、Redis、对象存储凭据和短信凭据只保存在服务器受限 secret 配置，不进入 Git、Release、Skill、CLI 配置或审计明文。

## 发布与回滚

- 本仓库的生产部署必须使用独立远端目录、独立 Compose project、独立端口、独立数据库/Redis 命名空间和独立 Nginx server name；不得修改实训营或既有 `ask.tashan.chat` 服务。
- 上线前先执行完整本地验证、部署前检查和针对公网域名的只读健康检查；真实短信发送仅在已配置并批准的阿里云模板下发生。
- 发布记录必须保存提交 SHA、部署时间、配置版本、健康检查结果和回滚目标；回滚只切换 OrgSpace 自己的版本，不能停止其他项目的隧道或容器。

## 验收定义

满足下列条件才视为“无需 Tailscale 的 CLI 接入”完成：

1. 一台未安装 Node.js、pnpm、Tailscale 的新设备可从公开 Skill 安装 `torg`，并通过 `https://orgspace.tashan.chat` 完成账号流程。
2. 两名用户在不同设备上能以本人身份使用 CLI 执行已发布 capability；设备撤销后旧 token 立即不能再调用 API。
3. `torg --help`、默认行为、生产配置、错误信息和审计均不泄漏密钥或把用户引导到 SSH/Tailscale。
4. 公网健康检查、CLI API 集成测试、Web 浏览器流程和故障恢复演练均有可复运行的验证记录。

## 不在 Phase 0.5 提前交付的内容

文件上传、任务、OKR、短信通知和聊天仍按上述阶段逐一实现。计算执行与用户网站托管保持为导航可见的延期方向，不能被 Phase 0.5 的公网接入误解为 AUP 执行权限。
