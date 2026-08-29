# Phase 2D 合作方目录验收记录

- 日期：2026-08-29
- 已验证代码提交：`66c08ccae74e12123cbb718e2d25292ee25d84e6`
- 已验证 Git tree：`6706ba2b9e56d455923f3fb7dc92837fe146e942`
- 分支：`main`

## 结果

对上述提交运行 `ORGSPACE_TEST_CLEANUP_VOLUMES=1 bash scripts/verify-phase0.sh`，最终输出 `verify-phase0: PASS`。

- 常规测试：56 个文件、337 项测试通过；Web 22 个文件、113 项。
- 能力注册表：86 个 capability，API/CLI/Skill 差异为 0。
- Web：11 个资源表面；合作方模块使用 `/org/:organizationId/partners` 列表和详情深链接。
- E2E：9 个文件、9 条旅程通过；生产形态 Compose、Partner 密钥配置、MinIO 重启均通过。
- 延期范围：4 个运行/服务模块继续 `coming_soon`。

## 所有权与防推断

- 普通成员只列出自己负责的 Partner；管理员必须显式使用 all scope。
- 其他成员访问真实 Partner ID 与随机 ID 均得到 `PARTNER_NOT_FOUND`。
- 普通成员不能用 all、重复候选、待接管或导出推断他人记录。
- 三成员+管理员 E2E 中，每个成员自己的列表为 1 条，管理员 all 为 3 条。
- 成员移除后旧会话失权，其记录进入 `awaiting_owner`，管理员可批量转交。

## 敏感字段

- 手机、微信、邮箱、详细地址使用 AES-256-GCM 版本化信封，随机 96-bit nonce 和资源/字段 AAD。
- 手机、微信、邮箱 exact lookup 使用独立 HMAC-SHA256 blind index；加密密钥与索引密钥不可复用。
- 列表只返回掩码；负责人和管理员详情才解密完整字段。
- 数据库 E2E 明文扫描为 0；更新联系方式后新值同样不出现在数据库序列化文本中。
- 管理员导出必须显式确认，CLI 拒绝覆盖并创建 `0600` 文件。

## 生命周期与跟进

- 支持创建、更新、归档、恢复、单条/批量负责人转移和乐观锁。
- PartnerInteraction 追加后不可修改或删除；修正创建新记录并引用原记录。
- 同一幂等键只创建一条 Interaction 和一个后续 WorkItem。
- 跟进可创建任务/会议，并与 PartnerInteraction 建立双向 ResourceLink。
- 文件关联执行真实文件权限；跨组织工作或受限文件失败时整笔事务回滚。

## 页面与命令

- Web 提供我的/全部/待接管切换、掩码列表、完整详情、创建、归档恢复、转交、跟进、关联、重复候选和导出。
- CLI 覆盖 17 个 partner capability，包括 CRUD、互动、更正、link/unlink、重复、待接管、批量转交和导出。
- Skill 明确禁止通过 ID、搜索、计数或重复检测探测他人记录，也禁止把批量完整联系方式粘贴到聊天。

## 门禁发现

1. 两个 capability 最初使用连字符，注册表正则拒绝；改为点分 ID，CLI 名称保持连字符。
2. Partner 生产必填密钥先后暴露了 production gate fixture、环境清单和 Buffer 显式导入缺口；三层均补齐并重跑完整 verifier。
3. Web 测试首次运行发现当前 lucide 版本没有 `AddressBook`；换为已存在的 `ContactRound`，避免 undefined 组件。
4. 完整 verifier 依次发现格式、lint 和生产契约问题；每次修复后都从头运行，最终通过。

## 剩余边界

- Phase 2D 尚未部署 AUP，也未发布新的 CLI/Skill；留到 Phase 5 并在执行前请求授权。
- Partner follow-up 已产生 DomainEvent/Outbox，自动站内通知和短信由 Phase 3 消费。
- 聊天关联与全局搜索由 Phase 4 扩展。
