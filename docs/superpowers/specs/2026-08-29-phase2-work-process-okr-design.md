# Tashan OrgSpace Phase 2 工作、流程与 OKR 设计

> 日期：2026-08-29
> 状态：用户已确认设计
> 前置依赖：Phase 0 身份组织、Phase 1 文件附件

## 1. 目标与边界

Phase 2 建立可供任务、会议、审批、OKR、合作方和未来制度共同使用的组织协作内核。业务对象独立建模，但复用 Principal、Membership、ResourceLink、Comment、ActivityEvent、DomainEvent、Outbox 和 AuditEvent。

Phase 2 分为：2A 协作内核；2B 任务/会议/审批；2C OKR。合作方使用独立 Phase 2D 规格。

## 2. 共享对象

- `WorkItem`：`task | meeting | approval | okr_change_request`，包含组织、标题、描述、创建者、负责人、可见性、优先级、紧急标记、开始/截止时间、状态和乐观锁版本。
- `Assignment`：记录人或角色在某节点上的责任、状态、异议和转派。
- `ProcessDefinition`/`ProcessDefinitionVersion`：发布版本不可修改。
- `ProcessInstance`/`ProcessStep`：固定使用启动时定义版本。
- `ResourceLink`：跨文件、消息、OKR、Partner 和工作项的授权关系。
- `Comment` 与 `ActivityEvent`：用户协作时间线；不替代安全审计。
- `DomainEvent`：同事务写入 Outbox，供通知、实时和搜索消费。

## 3. 状态与权限

任务支持 draft/active/disputed/completed/cancelled/reopened；会议支持 scheduled/in_progress/completed/cancelled；审批支持 pending/approved/rejected/returned/withdrawn。

普通成员可以创建和立即指派任务。负责人可以更新进度、完成和提出异议；创建者修改任务定义；管理员查看全部组织待办并处理争议/转派。受限对象正文按参与者授权，读取进入审计。

所有转换使用 `expectedVersion`，重复或过期动作返回稳定冲突。

## 4. 流程

节点支持单人审批、多人会签、任一通过、顺序审批、退回、撤回、转派、超时和管理员干预。扩展制度只增加表单 schema、校验器和流程模板，不复制执行器。

## 5. OKR

组织 Objective → 组织 KR → 个人 Objective/KR → 任务。全员可见；进度更新立即生效。标题、指标、权重、算法和周期等修改生成 `okr_change_request`，管理员审批后应用。支持 numeric/linked_tasks/manual，并保存公式版本和输入快照。

## 6. 操作面与验收

Web、CLI、Skill 全覆盖列表、详情、创建、指派、异议、转派、完成、重开、审批、会议和 OKR。验收使用创建者、负责人、管理员和无关成员，覆盖并发、跨组织、受限对象、附件权限、流程版本和事件审计。

## 7. 非目标

不实现报销等专属字段、视频会议网络、AI 审批人或跨组织工作项。
