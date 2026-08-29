# Phase 5 组件恢复矩阵

- 日期：2026-08-29
- 范围：本地隔离生产 Compose；不包含 AUP 真实隧道切换

## 结果

`ORGSPACE_TEST_CLEANUP_VOLUMES=1 pnpm test:production-stack` 通过。

在同一生产形态栈中依次重启：

1. Worker
2. API
3. Realtime
4. Redis
5. PostgreSQL
6. Gateway
7. MinIO

每次重启均执行 `docker compose up -d --wait`，随后重新运行 6 项网关检查：Web、API 健康、CORS、HTTP 安全头、只读分发文件、MinIO 私有访问和 WebSocket 缺凭证拒绝。

## 活跃状态恢复

重启前插入一条归属于 `dead-worker` 且 lease 已过期的 Outbox 记录。Worker 重启后该记录最终为 `done:1`：只认领一次，没有丢失，也没有重复处理。

Realtime 的历史补发、Redis gap repair、重复 hint 去重和成员撤权关闭由真实 PostgreSQL + Redis + WebSocket 集成测试覆盖；完整 E2E 还验证了 CLI stream、消息撤回搜索和跨组织拒绝。

## 隧道边界

本地矩阵不伪造 AUP—ECS 真实网络恢复。`configure-orgspace-ingress.self-test.sh`、`start-tunnel.sh` 与生产契约门禁验证了精确 loopback reverse forward、失败回滚和安全参数；真实隧道重启只能在 Phase 5 获得部署授权后执行并记录。
