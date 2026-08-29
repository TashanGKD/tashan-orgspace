# OrgSpace v1 候选版本验收记录

- 日期：2026-08-29
- 候选版本：`1.0.0`
- 本地已验证提交：`b3266e713279de4b3d8c95521dacca25be59ceeb`
- 分支：`main`
- 当前结论：本地候选版本通过；AUP 生产部署、公网登录复验、真实短信和公开发布尚未执行

## 本地全量门禁

在干净提交上运行：

```bash
ORGSPACE_TEST_CLEANUP_VOLUMES=1 bash scripts/verify-phase0.sh
```

命令以退出码 0 结束，最终输出 `verify-phase0: PASS`。本次运行覆盖：

- 工具链、格式、Lint、TypeScript 类型检查；
- 全部单元和集成测试；
- CLI/Skill 分发测试与无系统 Node.js 的独立 CLI 安装；
- 隔离生产形态 Compose 栈和组件重启矩阵；
- 11 个文件、11 条真实 PostgreSQL/Redis/MinIO 多用户 E2E 旅程；
- 测试结束后的容器、网络、数据卷和本项目本地镜像清理。

契约门禁单独复核结果：

```text
check-v1-product-contract: PASS (109 capabilities, 22 modules, 6 DomainEvents)
check-capability-coverage: PASS (0 violations, 109 capabilities)
check-resource-surface-coverage: PASS (0 violations, 13 resources)
check-gate-self-tests: PASS (0 violations, 19 gates)
```

## 已覆盖的 v1 范围

自动化旅程覆盖账号与设备、组织与成员、文件空间、任务与会议、审批、OKR、合作方、通知、聊天、搜索、我的工作以及审计。通用计算、用户数据库、常驻进程和用户网站部署仍是“即将上线”，不属于 v1 验收范围。

恢复验证覆盖 PostgreSQL、Redis、MinIO、API、Worker、Realtime 和 Gateway。过期 Worker lease 恢复后结果为 `done:1`，没有丢失或重复处理。数据库与对象备份还在独立目标完成了校验和、checkpoint、key version、逻辑计数和对象哈希比对。

## 尚未完成的生产验收

以下项目涉及外部系统或真实用户影响，不能用本地测试替代，也未在本记录中标记为完成：

1. 将精确候选 SHA 部署到 AUP，并核对远端 `.deployed-commit`、迁移、镜像和回滚目标；
2. 验证 `https://orgspace.tashan.chat` 的公网健康、桌面和移动端登录后旅程，以及 AUP—ECS 隧道重启恢复；
3. 经用户单独批准后发送一条真实阿里云短信，并查询运营商最终状态；
4. 从公开发布地址执行全新 Skill/CLI 安装和幂等重装；
5. 生产证据齐全后再创建稳定 Git tag/Release，并把本文件更新为最终验收记录。

当前 AUP 预检会拒绝部署，因为远端 `SERVICE_VERSION` 尚未与本地发布清单的 `1.0.0` 对齐。修改远端生产配置并部署需要用户明确授权。
