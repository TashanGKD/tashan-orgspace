# Tashan OrgSpace Phase 5 v1 收口与发布设计

> 日期：2026-08-29
> 状态：用户已确认设计
> 原则：不新增业务能力，只验证和发布 Phase 1–4

## 1. 一致性

最终门禁核对 capability、route/schema、SDK、CLI、Web 列表/详情/动作、Skill、权限负例、Audit action、DomainEvent/消费者、迁移/恢复和模块状态。每个 gate 有同名 self-test，删除真实绑定时必须失败。

## 2. 完整旅程

两名以上真实形状用户完成：注册设备 → 组织成员 → 文件 → 任务指派/争议/转派 → 会议审批 → OKR → Partner 跟进 → 通知短信 → 聊天 → 消息转任务 → 搜索/我的工作 → 撤销设备/成员 → 审计。

## 3. 恢复

分别重启 API、Worker、Realtime、PostgreSQL、Redis、MinIO 和反向隧道；验证 Outbox、提醒、文件校验、消息游标和索引投影不丢失、不重复。完成数据库/对象/secret 备份恢复演练。

## 4. 发布

精确部署提交、数据库迁移版本、Skill/CLI 版本和 Web 产物一致。新设备通过公开 Skill 安装 CLI。发布记录包含 SHA、健康、回滚目标、短信真实 smoke 和浏览器旅程。

## 5. v1 边界

计算、构建、用户网站、服务、数据库、daemon 和用户域名继续 coming_soon；最终门禁阻止它们进入 capability 或验收。
