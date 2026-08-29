# Phase 2 工作、审批与 OKR 验收记录

- 日期：2026-08-29
- 已验证代码提交：`0a13cd1d9f2b7e73379c9191df3e60bfe6bd8c40`
- 已验证 Git tree：`2054c28f249e4db0e391db153d90f0ba9a9a5098`
- 分支：`main`

## 结果

对上述提交运行 `ORGSPACE_TEST_CLEANUP_VOLUMES=1 bash scripts/verify-phase0.sh`，最终输出 `verify-phase0: PASS`。

- 常规测试：49 个测试文件、321 项测试通过；其中 Web 21 个文件、111 项测试。
- 分发测试：4 个文件、29 项测试通过；空用户安装仍覆盖无系统 Node.js。
- 能力注册表：69 个能力，API/CLI/Skill 差异为 0；19 个 Phase 2 Web capability 已有真实页面 surface。
- 资源表面：10 个，任务、会议、审批、OKR 均有独立 list/detail 深链接。
- E2E：8 个文件、8 条旅程通过；生产形态 Compose 和 MinIO 重启前后各 5 项通过。
- 延期范围：个人/组织运行与服务共 4 个模块继续为 `coming_soon`，未被 Phase 2 误开放。

## 协作内核与工作事项

- `ResourceRef`、`ResourceLink`、评论、ActivityEvent、DomainEvent/Outbox 共用组织边界；跨组织和重复链接被拒绝。
- DomainEvent 与 decision/progress event 为 append-only；领域写入与 Outbox 同事务提交或回滚。
- 普通成员可创建并立即指派任务。异议只改变 assignment 状态，不解除责任。
- 转派申请保留原负责人，创建者或管理员确认后才切换；所有转换使用 optimistic version。
- task、meeting、approval、change_request 共用 WorkItem，组织成员均可查看，移除成员即时失权。

## 流程审批

- 定义版本支持 `single`、`sequence`、`any`、`all`；已发布版本及其步骤不可修改。
- 实例固定启动时版本。顺序审批拒绝越序操作；any 并发决策只接受一个；all 必须全部通过。
- 支持 approve、reject、return、withdraw、transfer，决策事件只追加。
- CLI 提供流程定义、版本发布、启动、读取和决策；Web 审批入口使用统一 approval/change_request 工作列表。

## OKR

- Objective/KR 属于组织和真实成员；组织全员可读。
- numeric、manual、linked_tasks 公式均受契约校验；KR 权重总和必须为 100。
- linked_tasks 只接受同组织 WorkItem。每次进度更新保存 formula version、输入快照和计算结果。
- 进度更新立即生效；成员修改标题/周期必须生成并指派 `change_request`，管理员批准后应用。
- 管理员直接修改和批准变更都写入同一种 `okr.objective.changed` DomainEvent，并标记来源。

## 前端与 CLI

- 任务、会议、审批复用同一 WorkPage 列表—详情实现；OKR 使用相同 ResourceListPage/Sheet 结构。
- Web 可创建、指派、异议、申请/确认转派、完成、重开、取消；审批详情可直接批准 OKR change request。
- OKR Web 可创建目标、更新进度、提交修改申请；管理员可显式直接修改。
- `task create`、`meeting create`、`approval create` 各有独立服务端 capability；没有无能力身份的额外 CLI 叶子命令。

## 本轮门禁发现

1. CLI alias 最初没有独立 capability，命令集合门禁拒绝额外叶子；补成三条强制类型的 API/capability。
2. 能力总数更新后，精确 ID 集合和 Web 操作标签分别阻止只改数量、漏改用户文案。
3. 模块 JSON 的顺序替换误开放了延期模块；按模块 ID 修正，并由 deferred-product-scope gate 复核 4 个延期模块。
4. 完整 verifier 首轮在 lint 发现未使用类型导入；删除后从头重跑并通过。

## 剩余边界

- Phase 2 尚未部署到 AUP，也未发布新的 Skill/CLI 版本；留到 Phase 5 并在执行前请求授权。
- 全局“我的工作”和跨组织聚合属于 Phase 4，目前仍为 `coming_soon`。
- 实时短信提醒属于 Phase 3，本阶段只产生可供通知投影消费的 DomainEvent/Outbox。
