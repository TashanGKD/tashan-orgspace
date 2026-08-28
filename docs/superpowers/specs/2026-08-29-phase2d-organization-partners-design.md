# Tashan OrgSpace Phase 2D 合作方目录与跟进设计

> 日期：2026-08-29
> 状态：用户已确认设计
> 适用范围：组织合作方联系人、负责人、敏感联系方式、跟进记录和关联工作
> 前置依赖：Phase 0 身份与组织、Phase 1 文件、Phase 2A 协作内核、Phase 2B 任务/会议/审批

## 1. 目标

为每个组织提供合作方联系人列表。普通成员创建并管理自己负责的合作方，组织管理员查看和管理全部合作方。

该模块用于验证统一架构的扩展性：Partner 保持独立领域模型，同时复用组织、Principal、列表/详情、ResourceLink、文件、WorkItem、事件、审计、API/Web/CLI/Skill 一致性门禁。

## 2. 对象粒度

一条 `Partner` 记录代表一个具体联系人，不代表整个机构。

```text
张三｜某某研究院｜科研处处长
李四｜某某研究院｜合作办公室
```

同一单位允许多个联系人。第一版不创建 `PartnerOrganization`；未来如需要机构级合同、多个地址和联系人树，再单独增加机构对象并把 Partner 归入机构。

## 3. 数据模型

### 3.1 Partner

字段：

- `id`、`organization_id`；
- `owner_account_id`：当前负责人；
- `created_by_account_id`；
- 姓名（必填）；
- 单位、部门、职务；
- 地址；
- 手机、微信号、邮箱；
- `cooperation_stage`：合作阶段；
- 标签；
- 备注；
- 最近联系时间；
- 下次跟进时间；
- `record_state`：`active | archived | awaiting_owner`；
- 乐观锁版本、创建时间和更新时间。

合作阶段：

```text
lead       潜在线索
contacting 联系中
active     合作中
paused     暂停
ended      结束
```

归档不删除历史。归档后的记录默认只读，管理员或负责人可以恢复。

### 3.2 PartnerInteraction

跟进记录字段：

- `id`、`partner_id`、`organization_id`；
- 联系时间；
- 联系方式：`phone | wechat | email | in_person | meeting | other`；
- 跟进摘要；
- 记录人 Principal；
- 是否需要后续动作；
- 关联任务或会议；
- 关联文件；
- `corrects_interaction_id`；
- 创建时间。

跟进记录追加后不可原地覆盖。修正错误时创建新记录并引用被修正记录；普通列表显示最新解释，活动历史保留原文和更正链。

### 3.3 标签

第一版标签是组织内可复用的规范化文本标签。标签不承载权限。管理员和普通成员均可使用已有标签并创建新标签；管理员可以合并同义标签。

第一版不建设任意自定义字段或动态表单系统。

## 4. 共享所有权策略

新增通用 `OwnedOrganizationRecordPolicy`，用于合作方以及未来嘉宾、讲师和供应商。

```text
owner
  查看和管理自己的记录

org_admin / org_owner
  查看、管理、转移和导出组织全部记录

other member
  完全不可见
```

### 4.1 防推断

其他成员访问真实 Partner ID、搜索他人姓名、查询统计数量或触发重复检测时，不能知道记录存在。API 对越权读取返回与不存在一致的安全语义。

普通成员列表、筛选和统计只在自己的授权集合内计算。管理员才有组织总数和负责人维度统计。

### 4.2 负责人转移

- 创建者默认成为负责人。
- 负责人不能把记录转给非本组织有效成员。
- 普通成员不能通过转移接口读取他人的记录。
- 管理员可以单条或批量转移负责人。
- 成员离开组织时，其 Partner 进入 `awaiting_owner`。
- 待接管记录仅管理员可见和操作。
- 转移产生 DomainEvent、ActivityEvent 和 AuditEvent。

## 5. 敏感联系方式

敏感字段包括手机、微信号、邮箱和详细地址。

使用共享 `SensitiveFieldCipher` 做应用层认证加密。密钥只在 API/Worker 受限 secret 中，不能进入数据库、Git、Web、CLI、Skill 或日志。

每个密文字段保存密钥版本和随机 nonce，以支持以后轮换。普通列表返回掩码值；负责人和管理员在详情页可以读取完整值。完整读取、导出和批量查看都写审计。

### 5.1 Blind index

手机号、微信号和邮箱使用规范化值的 HMAC blind index 支持精确匹配。blind index 使用独立密钥，不能用加密密钥替代。

不支持敏感字段模糊搜索，不把明文写入全文索引。

### 5.2 重复记录

不对整个组织强制手机号、微信号或邮箱唯一。不同负责人可以录入同一联系人，避免通过唯一冲突泄漏他人记录。

普通成员只在自己的记录中获得重复提示。管理员可以查看组织级重复候选，人工合并、归档或转移。第一版不自动合并跟进历史。

## 6. 页面与交互

路由：

```text
/org/:organizationId/partners
/org/:organizationId/partners/:partnerId
```

### 6.1 列表

普通成员默认显示“我的合作方”。管理员可以切换全部合作方、负责人、待接管、合作状态、标签、单位和下次跟进时间。

列表列包含姓名、单位、职务、掩码联系方式、状态、负责人、最近联系和下次跟进。列表不展示完整手机号、微信、邮箱或详细地址。

### 6.2 详情

统一详情页分区：

```text
基础信息
联系方式
合作状态与标签
跟进记录
关联任务 / 会议 / 文件 / 聊天
活动与审计
```

动作：新增、编辑、归档、恢复、转交负责人、添加跟进、设置下次跟进、创建跟进任务/会议、关联文件和消息、管理员导出。

## 7. 工作与事件集成

Partner 通过 `ResourceLink` 关联 `FileEntry`、任务 WorkItem、会议 WorkItem、Phase 4 Message 和其他 Partner。

添加跟进时可以在同一受控流程中创建后续任务或会议。PartnerInteraction 与 WorkItem 通过双向 ResourceLink 关联。幂等键保证重复提交只创建一个工作项。

主要 DomainEvent：

```text
partner.created
partner.updated
partner.archived
partner.restored
partner.owner_transferred
partner.awaiting_owner
partner.interaction_added
partner.interaction_corrected
partner.follow_up_scheduled
```

Phase 3 消费 `partner.follow_up_scheduled` 生成站内提醒。第一版不会自动给合作方联系人发送短信或微信。

## 8. API、CLI、Web 与 Skill

### 8.1 Capability 族

- 合作方：list、read、create、update、archive、restore；
- 负责人：transfer、bulk-transfer；
- 跟进：list、add、correct；
- 关系：link、unlink；
- 管理：duplicate-candidates、export、awaiting-owner list；
- 敏感读取：contact read、bulk contact export。

每项 capability 声明授权、确认、幂等、审计和 Web/CLI/Skill 映射。

### 8.2 CLI

```text
torg partner list|get|create|update|archive|restore
torg partner transfer
torg partner interaction list|add|correct
torg partner link file|task|meeting|message
torg partner unlink
torg partner export
```

普通成员 `partner list` 只返回自己的记录。管理员必须显式提供 `--owner all` 才查询全部。导出需要管理员权限、确认和幂等键；输出文件权限默认 `0600`。

### 8.3 Skill

Skill 先读取 capability 清单。不得通过搜索、统计或错误差异探测其他成员记录；不得在聊天输出中展开批量完整联系方式；导出前必须展示范围和敏感性并获得确认。

## 9. 审计与保留

审计覆盖创建、编辑、归档、恢复、完整联系方式读取、导出、负责人转移、待接管、跟进新增/更正、关系变化和管理员重复候选处理。

审计和应用日志只保存掩码联系方式或不可逆摘要。Partner 归档不删除 Interaction。永久删除不在第一版用户能力中；组织关闭后的保留按平台合规规则执行。

## 10. 阶段位置

```text
Phase 1   文件与附件
Phase 2A  协作内核
Phase 2B  任务 / 会议 / 审批
Phase 2C  OKR
Phase 2D  合作方目录与跟进
Phase 3   通知 / 短信 / 定时提醒
Phase 4   聊天 / 搜索 / 我的工作 / 管理
```

Phase 2D 首次上线文件、任务和会议关联。聊天关联和全局搜索在 Phase 4 扩展，不阻塞合作方模块先上线。

## 11. 先行拒绝测试

- 普通成员读取、搜索、计数或导出他人的合作方；
- 猜测真实 Partner ID；
- 利用重复检测推断他人联系人；
- 从 ResourceLink 绕过 Partner、文件或 WorkItem 权限；
- 成员离开组织后继续使用旧 token 访问原负责记录；
- 非管理员转移负责人、查看待接管或导出全部；
- 列表、日志、错误和审计泄漏完整手机号、微信、邮箱或地址；
- 使用 blind index 做未授权组织级查询；
- 修改跟进记录覆盖原始历史；
- 重复提交跟进任务产生两个 WorkItem；
- 把负责人转移给无效或其他组织成员；
- 管理员导出未经过确认或未写审计。

## 12. 验收定义

使用三个普通成员和一个管理员：

1. 每个成员只看到自己的合作方。
2. 管理员看到全部、负责人筛选和待接管。
3. 真实 Partner ID、搜索、统计和重复提示均不泄漏他人记录。
4. 敏感字段数据库密文、列表掩码、详情授权读取和导出审计正确。
5. 成员离开后记录进入待接管，管理员可批量转交。
6. 跟进新增、更正和活动历史不可覆盖。
7. 跟进可以幂等创建任务或会议并双向关联。
8. 文件关联保持原文件权限。
9. Web、CLI 和 Skill 返回一致授权结果。
10. 删除任一 capability 绑定时 CI 门禁稳定失败。

## 13. 非目标

- 机构级 `PartnerOrganization`；
- 任意自定义字段和动态表单；
- 自动合并重复联系人；
- 自动向合作方发送短信或微信；
- CRM 销售漏斗、合同、报价和财务回款；
- 跨组织共享合作方；
- AI 自动联系或自动跟进。
