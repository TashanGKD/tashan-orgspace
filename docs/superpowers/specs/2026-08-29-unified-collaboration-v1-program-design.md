# Tashan OrgSpace v1 统一协作架构与总执行设计

> 日期：2026-08-29
> 状态：用户已确认设计
> 适用范围：Phase 1–5 当前 v1
> 不在范围：计算、构建、用户网站、服务、数据库、daemon 和用户域名

## 1. 目标

在开始大规模实现前，统一规划 OrgSpace 当前 v1 的跨阶段架构、共享对象、依赖关系、门禁和执行顺序。

规划完成后，开发从 Phase 1 开始连续推进，但仍按阶段测试、提交和验收，不采用一次性大爆炸交付。

```text
Phase 1  空间 / 文件 / 配额
Phase 2  WorkItem / 任务 / 会议 / 审批 / OKR
Phase 3  通知 / 短信 / 定时提醒
Phase 4  对话 / 搜索 / 我的工作 / 管理
Phase 5  全功能一致性 / 恢复 / 安全 / v1 发布
```

计算和用户托管只保留架构扩展位，延期范围门禁继续阻止相关 capability、CLI、Skill 和 Web 动作进入当前 v1。

## 2. 规划与执行方法

采用“统一架构 + 分阶段可执行计划”：

1. 总规格固定跨阶段对象、事件、权限和依赖。
2. 每个 Phase 有独立设计规格和实施计划。
3. 一份总执行图记录阶段依赖、提交顺序、部署和验收门槛。
4. 实施中如真实代码改变后续前提，必须提交计划修订，不能在执行时静默偏离。

不采用一份超大型单体实施计划。单体计划无法隔离领域变化，也无法保证执行到后半段时仍符合真实代码。

## 3. 统一协作内核

系统采用“领域对象独立、共享控制面统一”，不建立万能业务对象表。

```text
身份层
Account → Principal → Membership → Organization

领域事实层
Space / FileEntry / WorkItem / Objective / KeyResult / Partner
Notification / Conversation / Message

共享关系层
Assignment / ResourceLink / AttachmentRef / Comment / ActivityEvent

可靠执行层
DomainEvent → Outbox → Worker / Realtime → Delivery / AuditEvent
```

### 3.1 身份与组织

- `Account` 代表真实人员账号。
- `Principal` 是所有可授权行为主体的统一抽象。
- v1 只启用 `human` 与 `system`。
- `ai_employee` 和 `service_account` 只保留 schema 演进位，不创建真实主体、不授予权限。
- `Membership` 是账号在组织中的唯一成员身份。
- 所有组织工作对象必须包含 `organization_id`。
- 个人空间文件可以不属于组织；任务、OKR、审批、会议、通知和聊天必须属于组织。

### 3.2 领域对象与关系

文件、任务、OKR、通知和聊天分别拥有自己的表、状态机和领域服务。

跨领域关系使用 `ResourceLink`：

- 任务关联文件；
- 消息转成任务、会议或审批；
- OKR 关联任务；
- 会议关联文件和后续待办；
- 审批关联申请材料。

`AttachmentRef` 只引用 Phase 1 的 `FileEntry`，不会复制文件内容或新建平行上传系统。资源被引用后仍执行原资源权限，不因出现在消息、任务或审批中而扩大可见性。

### 3.3 事件与活动

每个成功状态变化产生不可变 `DomainEvent`。事件至少包含：

- 事件 ID、类型和 schema 版本；
- 组织、对象类型和对象 ID；
- actor Principal、设备、入口渠道和请求 ID；
- 发生时间；
- 允许下游使用的最小 payload。

业务状态、DomainEvent、Outbox 和审计摘要在同一 PostgreSQL 事务中提交。Worker、通知和 WebSocket 消费 Outbox，不通过轮询或比较整表来猜测变化。

`ActivityEvent` 是面向用户的对象活动投影；`AuditEvent` 是安全与合规真源。两者不能互相替代。

### 3.4 个人负责的组织记录

合作方、未来嘉宾、讲师和供应商等对象复用 `OwnedOrganizationRecordPolicy`：

- 记录属于组织，并有唯一当前负责人；
- 负责人查看和管理自己的记录；
- `org_admin` 与 `org_owner` 查看和管理组织全部记录；
- 其他成员不能通过 ID、搜索、统计或重复检测推断记录存在；
- 成员离开组织时，记录进入待接管状态，由管理员转移负责人。

手机号、微信号、邮箱和详细地址等敏感字段使用共享 `SensitiveFieldCipher` 加密保存。精确匹配使用 HMAC blind index；列表、日志、错误和普通审计默认掩码。

## 4. 通用控制面规则

### 4.1 权限

- 前端隐藏入口只改善体验，不构成授权。
- API 每次请求重新验证账号、设备、Membership、组织、对象和当前状态。
- 所有跨对象动作同时验证来源和目标对象权限。
- 管理员能力按领域显式定义，不存在自动读取全部个人空间或私聊正文的万能管理员。
- 高风险恢复和合规读取必须填写理由并产生不可篡改审计。

### 4.2 幂等与并发

- 所有 mutation 都声明幂等合同。
- 客户端幂等键与 actor、capability、规范化输入绑定。
- 状态对象使用乐观版本；重复点击只允许一次有效转换。
- Worker 使用租约、重试、退避和死信状态。
- 外部服务超时后先查询实际状态，再决定重试或补偿。

### 4.3 API、Web、CLI 与 Skill

每项用户能力注册唯一 capability，并声明：

- 输入、输出和错误 schema；
- 权限和对象作用域；
- 副作用、幂等和确认等级；
- CLI 绑定；
- Web 列表、详情和动作；
- Skill 引用；
- Audit action 和 DomainEvent。

Web、CLI 与 Skill 使用共享 SDK。CLI 保持全功能覆盖；任何服务端能力缺少 CLI 绑定时 CI 失败。

所有模块沿用：

```text
空间 → 模块 → 对象列表 → 对象详情 → 状态允许的动作
```

## 5. 阶段依赖图

```text
Phase 0：身份 / 组织 / 设备 / 审计 / 公网安装
  ↓
Phase 1：空间 / 文件 / 配额
  提供 Space、FileEntry、附件引用、MinIO
  ↓
Phase 2A：协作内核
  提供 WorkItem、Assignment、Process、ResourceLink、Comment、DomainEvent
  ↓
Phase 2B：任务 / 会议 / 审批
  提供截止时间、审批节点、责任和提醒事件
  ↓
Phase 2C：OKR
  复用任务、审批和 change request
  ↓
Phase 2D：合作方目录与跟进
  复用 WorkItem、文件、ResourceLink 和个人负责记录策略
  ↓
Phase 3：通知 / 短信 / 定时提醒
  消费前面全部 DomainEvent
  ↓
Phase 4A：单聊 / 群聊 / 实时消息
  复用文件附件和 WorkItem 转换
  ↓
Phase 4B：我的工作 / 搜索 / 管理
  聚合所有已授权真实对象
  ↓
Phase 5：一致性 / 恢复 / 安全 / v1 发布
```

硬依赖：

- 任务和聊天附件依赖 Phase 1 文件权限。
- OKR 实质性修改依赖 Phase 2 审批流程。
- 合作方跟进任务和会议依赖 Phase 2B；合作方提醒进入 Phase 3。
- 强制和定时提醒依赖任务、会议和审批事件。
- 消息转工作项依赖 WorkItem。
- 搜索依赖每个领域提供授权过滤查询。
- 我的工作依赖前面所有领域的责任投影。
- Phase 5 不增加新业务能力。

## 6. Phase 1：空间、文件与配额

Phase 1 已有独立设计和实施计划：

- `2026-08-29-spaces-files-quotas-design.md`；
- `2026-08-29-spaces-files-quotas-implementation.md`。

它提供：

- 个人和组织空间；
- MinIO/S3 文件数据面；
- 文件夹公开/受限和 manager/editor/viewer；
- 分片上传、版本、回收站和配额；
- 可供后续模块引用的 `FileEntry` 和附件权限。

后续 Phase 不得另建文件上传或附件 Blob 系统。

## 7. Phase 2：工作、流程与 OKR

### 7.1 WorkItem

第一版类型：

```text
task
meeting
approval
okr_change_request
```

通用字段：

- 组织、标题、描述、创建者和负责人；
- 状态、优先级和紧急标记；
- 开始时间和截止时间；
- `organization` 或 `restricted` 可见性；
- 关联文件、消息、OKR 和父子工作项；
- 当前流程版本、乐观锁版本和不可变事件序列。

所有普通组织待办对组织管理员可见。受限正文读取仍按领域规则授权并审计。

### 7.2 Assignment

- 普通成员可以创建并立即指派任务给其他组织成员。
- 被指派人可以提出异议或申请转派。
- 争议处理前原责任继续有效。
- 负责人可以更新进度和完成状态。
- 创建者可以修改任务定义。
- 管理员处理转派、争议和组织级调整。
- 所有状态变化记录理由和事件。

### 7.3 Process

- `ProcessDefinition` 发布后不可原地修改。
- `ProcessInstance` 固定使用启动时版本。
- 节点支持单人审批、多人会签、任一通过、顺序审批、退回、撤回、转派、超时和管理员干预。
- 报销、项目申请和在线会议等未来制度只增加表单 schema、校验器和流程模板。
- 扩展制度不复制身份、权限、事件、通知和审计。

### 7.4 OKR

层级：组织 Objective → 组织 KR → 个人 Objective/KR → 任务。

- 个人 OKR 必须归属于组织。
- 组织内全员可见。
- 本人和管理员可以更新。
- 进度更新立即生效并保留历史。
- 目标、指标、权重、算法和周期等实质修改创建 `okr_change_request`。
- 管理员审批后实质修改生效。
- 每次进度计算保存公式版本和输入快照。
- 支持 `numeric`、`linked_tasks`、`manual`。

Phase 2 拆为四份计划：协作内核；任务/会议/审批；OKR；合作方目录与跟进。

### 7.5 合作方目录

一条 `Partner` 记录代表一个具体联系人。同一单位可以有多个联系人。

核心信息包括姓名、单位、部门、职务、地址、手机、微信号、邮箱、合作状态、标签、负责人、备注、最近联系时间和下次跟进时间。

`PartnerInteraction` 追加保存联系时间、联系方式、摘要、记录人、关联文件/会议和后续动作。原记录不能被静默覆盖，更正以新事件保留历史。

普通成员只查看和管理自己负责的合作方；管理员查看全部、转移负责人、处理待接管和导出。合作方通过 `ResourceLink` 关联文件、任务、会议和后续聊天消息。

Phase 2D 使用独立规格与实施计划，不把 Partner 塞进 WorkItem 或通用 JSON 表。

## 8. Phase 3：通知、短信与定时提醒

```text
DomainEvent
  → NotificationPolicy
  → Notification
  → DeliveryAttempt
  → 站内通知 / 阿里云短信
```

### 8.1 通知策略

| 事件 | 站内通知 | 短信 | 用户可关闭 |
|---|---:|---:|---:|
| 新审批请求 | 立即 | 默认立即 | 否 |
| 明确标记为紧急 | 立即 | 默认立即 | 否 |
| 普通任务创建 | 立即 | 创建时可选择 | 单次选择 |
| 未完成任务截止前 1 小时 | 立即 | 自动 | 否 |
| 会议开始前 1 小时 | 立即 | 自动 | 否 |
| 每日汇总 | 每日 | 默认发送 | 是 |

只有每日汇总可以取消。

### 8.2 可靠投递

- 业务模块不直接调用短信供应商。
- Notification Worker 根据事件和策略创建确定通知实例。
- 定时提醒保存 `ScheduledReminder`，不每分钟扫描全部业务表。
- 事件、接收人、模板和提醒窗口组成短信幂等键。
- 阿里云 `Code=OK` 只表示 accepted。
- Worker 使用 BizId 查询 `delivered` 或 `failed`。
- 超时后先查询发送记录，再判断是否重试。
- 手机号和短信内容在日志与审计中掩码。
- 一个真实短信 smoke 与模拟全量回归分开。

## 9. Phase 4：聊天、搜索与全局工作

### 9.1 Conversation 与 Message

- `direct` 会话双方必须至少共同属于一个组织，并选择归属组织。
- `group` 会话属于一个组织，只有群成员可读。
- 组织管理员不会自动加入所有群。
- v1 拒绝跨组织私聊。
- 客户端生成 `client_message_id`，服务端分配会话内递增 `server_seq`。
- 同一 client ID 重发返回原消息。
- 编辑、撤回和回应是新事件，不覆盖历史。
- HTTP 历史和持久游标是真源；WebSocket 只分发增量。
- 断线后按游标补齐缺口。

### 9.2 附件和工作转换

- 消息附件引用 Phase 1 文件。
- 引用不会扩大文件权限。
- 消息可以转为任务、会议、审批或文件条目。
- 新对象与来源消息保存双向 `ResourceLink`。
- 消息撤回不删除已创建工作项，但工作项标记来源已撤回。

### 9.3 合规读取

- 私聊正文默认只有双方可见。
- owner 发起合规读取必须提交原因、目标会话和时间范围。
- 产生高风险审计并通知相关成员。
- 不能用管理员身份批量导出整个组织聊天。

### 9.4 搜索

- 各领域提供授权过滤查询和索引投影。
- 搜索聚合任务、文件、OKR、审批、会议、成员和聊天。
- 搜索结果和计数都不能泄漏受限对象。
- Membership 失效后，缓存和索引授权必须失效。

### 9.5 我的工作与管理

- 我的工作聚合本人跨组织任务、审批、会议、提醒和 @消息。
- 聚合项仍引用原组织对象，不复制状态。
- 打开项目时切换到原组织上下文。
- 管理中心负责成员、角色、空间额度、通知制度、流程模板和审计。
- 管理中心不自动获得个人空间或受限聊天正文。

Phase 4 拆为聊天/实时，以及搜索/我的工作/管理两份计划。

## 10. Phase 5：v1 收口

Phase 5 不创建新业务模块。

### 10.1 全功能门禁

CI 机器核对：

- capability registry；
- API route 与 schema；
- SDK 方法；
- CLI binding；
- Web 列表、详情和动作；
- Skill 引用；
- 权限负例；
- Audit action；
- DomainEvent 与消费者；
- 数据库迁移与恢复；
- 模块 `available/coming_soon` 状态。

每个门禁必须有同名 self-test，删除任一真实绑定时稳定失败。

### 10.2 完整用户旅程

```text
注册与设备
→ 创建组织和添加成员
→ 个人/组织文件
→ 创建并指派任务
→ 异议和转派
→ 会议与审批
→ OKR 更新和变更审批
→ 站内通知与短信
→ 单聊和群聊
→ 消息转任务
→ 我的工作和搜索
→ 撤销设备和成员权限
→ 审计、备份与恢复
```

### 10.3 恢复与安全

- PostgreSQL、MinIO、Redis 和 secret 备份恢复演练。
- API、Worker、Realtime、MinIO 和反向隧道逐项重启。
- Outbox、提醒、消息游标和文件调和不能重复产生副作用。
- 两个账号、两个组织、多设备和跨组织负例。
- 一个真实短信 smoke，网关接受与运营商送达分开记录。
- 新用户从公开 Skill 安装 CLI 并完成真实 capability。

## 11. 计划产物

规格目录：

```text
docs/superpowers/specs/
  2026-08-29-unified-collaboration-v1-program-design.md
  2026-08-29-spaces-files-quotas-design.md
  2026-08-29-phase2-work-process-okr-design.md
  2026-08-29-phase2d-organization-partners-design.md
  2026-08-29-phase3-notifications-sms-reminders-design.md
  2026-08-29-phase4-chat-search-global-work-design.md
  2026-08-29-phase5-v1-release-closure-design.md
```

计划目录：

```text
docs/superpowers/plans/
  2026-08-29-spaces-files-quotas-implementation.md
  2026-08-29-phase2-work-process-okr-implementation.md
  2026-08-29-phase2d-organization-partners-implementation.md
  2026-08-29-phase3-notifications-sms-reminders-implementation.md
  2026-08-29-phase4-chat-search-global-work-implementation.md
  2026-08-29-phase5-v1-release-closure-implementation.md
  2026-08-29-v1-program-execution-map.md
```

## 12. 执行规则

1. 所有 Phase 的设计和实施计划先完成并确认。
2. 从 Phase 1 开始按依赖顺序连续执行。
3. 每个任务先写失败测试，再写实现。
4. 每个任务形成聚焦提交，提交前运行相关测试。
5. 每个 Phase 完成后运行全仓门禁、生产形状 smoke 和真实用户旅程。
6. `main` 始终保持可测试、可部署。
7. 后续计划因真实实现变化而修订时，必须单独提交修订和原因。
8. 延期范围门禁持续阻止计算和用户托管进入当前 v1。

## 13. v1 完成定义

只有同时满足以下条件才能称为 v1：

- Phase 1–4 所有已声明 capability 在 API/Web/CLI/Skill 中一致可用；
- 用户可以完成文件、任务、审批、会议、OKR、通知、短信和聊天闭环；
- 所有个人、组织、受限对象和跨组织边界通过负例；
- 定时、异步、实时和文件数据面在重启后恢复；
- AUP/ECS 公网入口、公开安装和回滚经过验证；
- 全部门禁自测可以证明真实漂移会被拦截；
- 计算和用户托管仍明确标记为延期。
