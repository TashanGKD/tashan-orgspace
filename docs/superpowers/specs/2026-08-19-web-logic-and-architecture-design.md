# Tashan OrgSpace Web 逻辑与架构设计

<!-- DEFERRED_PRODUCT_SCOPE: general-compute,user-web-hosting -->

> 日期：2026-08-19
>
> 状态：用户已于 2026-08-19 批准书面规格
>
> 适用范围：Web 产品逻辑、前后端边界、页面信息架构、客户端数据流、能力门禁与发布边界
>
> 公网入口：`https://orgspace.tashan.chat`

## 1. 目标

OrgSpace Web 是统一 OrgSpace API 的一个独立客户端。它不是后端的一部分，也不是 CLI 的图形外壳。Web、CLI、Codex Skill 和未来客户端以相同身份、权限、业务规则和审计语义调用同一组服务端能力。

本设计解决五个问题：

1. 用户进入网页后从哪里开始工作。
2. 个人空间、组织空间和跨组织聚合视图如何区分。
3. 前端如何在不复制业务逻辑的前提下独立开发和美化。
4. 尚未上线的产品模块与真实可执行能力如何区分。
5. CI 如何证明 API、contracts、SDK、CLI 与 Web 没有漂移。

## 2. 已确认的产品决策

- 登录后默认进入用户上次使用的当前组织；没有历史选择时进入第一个可用组织。
- 组织首页是默认工作台，不以平台管理后台或个人汇总页作为首页。
- “我的工作”跨组织聚合本人事项，但事项始终属于原组织并在原组织权限下操作。
- “个人空间”只承载个人文件、存储用量和未来能力，不承载私人任务、私人 OKR 或私人聊天。
- 任务、OKR、审批、会议和聊天全部属于组织。
- 导航展示完整产品版图；尚未实现的模块显示“即将上线”。
- 无权限的管理员功能完全隐藏，不使用置灰入口暴露管理能力。
- Web 最终覆盖 CLI 的全部用户能力。两端交互形式可以不同，但能力、权限和结果语义一致。
- CLI 全功能覆盖与 CI 强制一致性门禁仍是不可放宽的产品原则。

## 3. 采用的总体方案

采用 **Headless API + 模块化单页 Web 客户端**。

```text
Web / CLI / Skill / future clients
            |
            v
shared contracts + typed SDK + capability registry
            |
            v
unified API control plane
auth + authorization + business rules + idempotency + audit
            |
            v
PostgreSQL / Redis / object storage / Worker / Realtime
```

不采用以下方案：

- Web 专属 BFF：当前阶段会增加一层部署、授权和接口语义，容易使 Web 与 CLI 形成两套业务接口。未来只有在跨服务聚合已经形成可量化性能问题时再评估。
- 微前端：当前团队与产品阶段不需要独立团队发布边界，其构建、路由、状态和版本协调成本过高。模块化前端保留未来拆分可能，但不提前承担复杂度。

## 4. 前后端边界

### 4.1 后端负责

- 身份认证、token 轮换、设备会话和成员状态。
- 组织、角色、对象作用域、ACL 和最终授权判断。
- 任务、OKR、审批、会议、聊天和文件的业务规则。
- 写操作幂等、事务、冲突检测、outbox 和审计。
- 文件对象、短信、Worker 与平台自身部署控制。
- 稳定的请求、响应、错误和事件协议。

### 4.2 Web 负责

- 路由、导航、布局、表单、交互反馈和响应式展示。
- 把用户动作映射为 SDK 调用。
- 页面查询缓存、请求取消和实时事件触发的刷新。
- 根据服务端能力状态和当前权限决定入口展示。
- 把标准错误翻译为用户可理解的提示，同时保留 request ID。

### 4.3 Web 明确不得负责

- 不直接访问 PostgreSQL、Redis、对象存储控制面、AUP、Docker 或宿主机。
- 不把按钮隐藏或客户端判断当成权限控制。
- 不复制一套与 `packages/contracts` 平行的请求和响应类型。
- 不在页面组件中手写 API URL、鉴权头或错误协议。
- 不根据未知响应字段“尽量渲染”；协议校验失败必须作为系统错误处理。

这一边界允许未来重做颜色、排版、组件、页面布局，甚至替换页面技术栈，而不改变后端和 CLI 的业务行为。

## 5. 公网与发布拓扑

生产环境使用同一公网 origin：

```text
https://orgspace.tashan.chat/             -> versioned Web static artifact
https://orgspace.tashan.chat/v1/*         -> API
https://orgspace.tashan.chat/realtime/*   -> future realtime service
```

同域部署减少 Cookie、CORS 和登录跳转的复杂度，但不代表代码或发布耦合：

- Web 与 API 使用独立构建产物、版本号、发布流水线和回滚点。
- Web 默认请求同源 `/v1`，生产 API 地址不编译进前端包。
- 本地开发通过 Vite 将 `/v1` 代理到本地 API；无配置默认不得连接生产。
- API 保持向后兼容；破坏性协议变化使用新的版本路径。
- 静态页面可以公开加载，但业务数据默认必须登录后访问。

## 6. 页面信息架构

### 6.1 全局外壳

Web 使用稳定 App Shell，包含：

- 产品标识。
- 当前组织选择器。
- 全局搜索或命令入口。
- 通知入口。
- 账号、设备与退出入口。
- 左侧主导航。
- 页面内容区域和全局反馈区域。

App Shell 只组织页面和上下文，不承载任务、文件、聊天等领域业务。

### 6.2 导航

```text
全局
├─ 我的工作
└─ 个人空间
   ├─ 概览
   ├─ 文件
   ├─ 运行与构建（即将上线）
   ├─ 服务与数据库（即将上线）
   └─ 用量

当前组织
├─ 组织首页
├─ 任务
├─ OKR
├─ 审批
├─ 会议
├─ 文件
├─ 消息
├─ 运行与构建（即将上线）
├─ 服务与数据库（即将上线）
└─ 组织管理（仅有权限者可见）
   ├─ 成员与角色
   ├─ 空间额度
   ├─ 通知与短信策略
   ├─ 流程制度
   └─ 审计
```

“即将上线”模块可进入只读说明页，说明模块边界和状态；不得展示伪造数据、无效表单或可触发写操作的控件。

### 6.3 组织首页

组织首页按处理优先级展示：

1. 需要立即处理：审批请求、紧急通知、临近截止或会议提醒。
2. 我的待办：今天、本周、逾期、有异议或待转派。
3. 组织工作概览：任务进度、OKR 状态和待处理流程。
4. 今日日程：会议与截止时间。
5. 最近消息：私聊、组织群聊和 @我。
6. 空间状态：组织额度和文件相关告警。

普通成员只看到自己有权读取的数据。管理员拥有更广的组织视图，但不能由此读取成员个人空间。

### 6.4 路由作为上下文真源

推荐的稳定路由形状：

```text
/login
/my-work
/personal/files
/org/:organizationId/home
/org/:organizationId/tasks
/org/:organizationId/okr
/org/:organizationId/approvals
/org/:organizationId/meetings
/org/:organizationId/files
/org/:organizationId/messages
/org/:organizationId/admin/*
```

可见延期路由：

```text
/personal/runtime
/personal/services
/org/:organizationId/runtime
/org/:organizationId/services

Visible deferred routes → ComingSoonPage only → no capability → no write request
```

URL 决定当前页面和组织上下文，使刷新、深链接、浏览器前进后退和问题复现都保持确定。最近组织只用于选择默认跳转目标，不能覆盖 URL 中的显式组织。

## 7. Web 内部模块

### 7.1 稳定平台层

- `app-shell`：布局、导航和全局反馈。
- `routing`：路由解析、登录保护和上下文边界。
- `session`：登录恢复、账号、设备和退出。
- `context`：当前组织、个人空间和跨组织聚合上下文。
- `feature-registry`：模块状态、导航位置、角色可见性和 capability 映射。
- `data`：SDK 实例、查询缓存、mutation 协调、错误翻译和实时事件接入。
- `ui`：无业务含义的可复用展示组件与设计 token。

### 7.2 领域模块

每个领域模块必须可独立理解和测试，固定包含：

```text
features/<domain>/
  routes        URL 与入口声明
  pages         页面组合
  data          SDK 查询、写入和缓存 key
  surfaces      capability 与页面动作映射
  components    领域展示组件
  tests         页面状态、拒绝路径和恢复路径
```

页面层不得直接 `fetch`。纯 UI 组件不得依赖 SDK。领域数据层不得绕过共享 contracts。

## 8. 两类注册表

### 8.1 Product Module Catalog

这是产品导航和路线图的真源，记录：

- 模块 ID、名称、说明、图标和排序。
- 所属上下文：全局、个人或组织。
- 状态：`available` 或 `coming_soon`。
- 路由和所需角色。
- 模块上线后所覆盖的 capability 集合。

Catalog 可以列出未来模块，但 `coming_soon` 模块只能渲染说明页。

### 8.2 Capability Registry

这是可执行服务端能力的真源，只能登记真实 API 能力，记录：

- capability ID 与版本。
- 输入/输出 schema。
- 权限与对象作用域。
- 副作用、幂等和确认要求。
- CLI binding。
- Web 状态：已实现 binding 或显式 `deferred`。
- 稳定错误、审计动作和事件。

产品模块状态与 capability 状态必须分开：未来导航可见不等于 API 已存在。

## 9. 会话、状态与数据流

### 9.1 会话

- access token 只保存在页面内存中。
- refresh token 使用 `Secure`、`HttpOnly` Cookie，页面脚本不可读取。
- 浏览器持久化稳定 device ID；不得把 token 放入 `localStorage`。
- 页面启动先进入明确的 session restoring 状态，不短暂显示登录页。
- API 返回 token 过期时最多自动刷新一次；再次失败则清空内存会话并进入登录页。

### 9.2 状态分类

- URL 状态：当前组织、当前页面、可分享筛选条件。
- 服务端状态：通过 SDK 查询并进入带作用域的缓存。
- 局部界面状态：表单草稿、弹窗、折叠和临时选择。
- 实时状态：连接状态和尚未由 HTTP 确认的事件提示。

不得把服务端业务对象复制到多个全局 store 中长期维护。

### 9.3 作用域隔离

所有组织缓存 key 必须包含 `organizationId`，空间数据还必须包含 `spaceId`。组织切换时：

1. 更新 URL。
2. 取消旧作用域未完成请求。
3. 清除或隔离旧页面的临时状态。
4. 显示新作用域加载骨架。
5. 禁止短暂渲染上一个组织的数据。

### 9.4 写操作

写操作采用统一流程：

1. 表单做用户体验层校验。
2. 领域数据层生成幂等键并调用 SDK。
3. API 重新校验 schema、身份、作用域和权限。
4. 服务端事务写业务数据、outbox 和审计。
5. Web 根据结果刷新受影响查询并显示确定状态。

撤销设备、删除、审批和组织额度变更不得乐观更新。低风险且可撤销的操作只能逐 capability 显式允许乐观更新，不能设为全局默认。

### 9.5 实时数据

WebSocket 或 SSE 只承担变化通知和聊天增量。HTTP API 与持久化游标仍是真源。断线重连后客户端按游标补齐缺口，再刷新受影响查询；不能依赖实时连接保存唯一状态。

## 10. 权限与功能可见性

页面展示由两层信息共同决定：

1. Product Module Catalog / Capability Registry 决定功能是否已上线。
2. 当前身份与组织权限决定用户是否可见、可读或可操作。

前端可用权限信息减少无意义入口，但 API 必须对每次请求独立授权。权限在会话中发生变化时：

- API 拒绝旧操作。
- 客户端刷新身份和权限投影。
- 移除失去权限的导航与缓存。
- 跳转到当前用户仍可访问的安全页面。

管理员功能对无权限成员完全隐藏。管理员权限不得跨越个人空间边界。

## 11. 错误与反馈

- `401`：自动刷新一次；失败则重新登录。
- `403`：提示权限已变化，刷新权限并退出不可访问页面。
- `404`：区分对象不存在与模块尚未上线，不能互相伪装。
- `409`：展示冲突说明和对象当前状态，要求刷新或重新确认。
- `429`：展示可重试时间，不连续自动重试。
- `5xx` 或网络错误：保留当前安全页面，提供受控重试。
- 协议校验失败：视为系统错误，不猜测字段继续执行。

所有错误展示可复制 request ID。所有写操作必须有明确的“提交中、成功、失败”状态；长任务进入可恢复的后台进度视图，不能让关闭页面等同于取消任务。

## 12. 一致性门禁

CI 必须机器核对：

```text
API routes
  <-> capability registry
  <-> contracts and SDK methods
  <-> CLI bindings
  <-> Web capability surfaces
  <-> available routes/actions/tests
```

必须拦截：

- 任一用户 capability 缺少 CLI binding。
- capability 引用不存在的 schema 或 SDK 方法。
- Web 标记为已实现但没有真实路由、页面动作或测试。
- `coming_soon` 模块绑定真实写操作。
- route/action 使用错误 capability ID。
- Product Module Catalog 出现重复模块、重复路由或无效上下文。

每个 gate 必须有同名 self-test，至少构造缺失 CLI、错误 capability ID、重复/嵌套路由和“available 但无页面动作”等真实负例，证明门禁会失败。仅比较 ID 集合不构成完整生产门禁。

## 13. 测试与验收

### 13.1 自动化层次

1. contracts、capability registry 和 SDK 单元测试。
2. 领域数据层、组件与页面状态测试。
3. API 与真实 PostgreSQL/Redis 集成测试。
4. Web 与 API 的端到端登录、刷新、组织切换和权限测试。
5. 桌面与手机尺寸的浏览器 E2E。
6. 键盘、焦点、语义标签和基础无障碍检查。
7. 生产同域代理、Secure Cookie、实时连接与回滚 smoke。

### 13.2 关键负例

- 快速切换两个组织时，慢响应不得把旧组织数据写回当前页面。
- URL 中组织 ID 与缓存对象所属组织不一致时拒绝渲染。
- 普通成员不能通过手写管理 URL 获得管理数据。
- refresh 失败不能形成无限请求循环。
- 重复提交写操作只产生一次业务效果。
- `coming_soon` 页面不能发送真实 mutation。
- 权限被撤销后，已打开页面的下一次请求必须被 API 拒绝并安全退出。

## 14. 当前实现与目标差距

当前仓库已经具备独立 `apps/web`、`apps/api`、`apps/cli`、`packages/contracts`、`packages/sdk` 和 `packages/capabilities`，方向与本设计一致。进入实施前需要定向补齐：

- 将当前单体 Web App 拆为 App Shell、平台层和领域模块。
- 使用共享 contracts/SDK 推导页面数据类型，删除平行手写 view 类型。
- 增加稳定路由、组织上下文隔离和查询缓存层。
- 增加 Product Module Catalog，用于完整导航与 `coming_soon` 页面。
- 将 Web API 地址改为生产同源 `/v1`、本地代理，消除环境变量命名漂移。
- 把现有只比较 capability ID 集合的 Web gate 升级为路由、动作与测试一致性门禁。
- 增加明确 session restoring 页面，消除登录页闪烁。

这些是后续实施计划的范围；本设计本身不授权生产部署或 AUP 变更。

## 15. 实施切片建议

本设计覆盖长期 Web 架构，但实施应拆分为可独立验收的切片：

1. Web 平台层：同源 API、路由、session、App Shell、模块目录和双注册表。
2. Phase 0 页面迁移：登录、手机号、组织、成员、设备和审计。
3. 个人/组织文件与配额页面。
4. 任务、OKR、审批与会议工作台。
5. 通知、短信偏好、聊天与实时补齐。
6. 全 capability Web 覆盖收口与生产部署验收。

每个切片同时交付对应 API/SDK/CLI/Web 映射、拒绝测试、门禁负例和可复核验证证据。

## 16. 完成标准

- 用户可以从组织首页理解当天需要处理的组织工作。
- 个人空间、组织空间和跨组织“我的工作”在 URL、缓存和权限上互不混淆。
- 替换 Web 页面与样式不会要求修改 API、CLI 或 Skill 的业务逻辑。
- 所有真实操作只通过共享 SDK 调用统一 API，并由后端最终授权和审计。
- 未上线模块可见但不可执行；无权限管理员模块不可见。
- Web 与 API 可以独立构建、发布和回滚。
- CI 能用真实负例拦截 API、capability、contracts、SDK、CLI 和 Web 漂移。
- Web 最终覆盖全部用户 capability，同时保持 CLI 全功能覆盖的强制门禁。
