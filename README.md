# Tashan OrgSpace

他山组织空间（Tashan OrgSpace）是一个独立的组织协作与安全计算平台。

当前仓库已经进入按阶段执行的实现期；Phase 0 首先建立认证、权限、审计与 CLI/Web 一致性基础。

- 产品与技术总设计：[`docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md`](docs/superpowers/specs/2026-08-18-tashan-orgspace-design.md)
- Phase 0 实施计划：[`docs/superpowers/plans/2026-08-18-phase0-security-foundation.md`](docs/superpowers/plans/2026-08-18-phase0-security-foundation.md)
- Phase 0 安全架构：[`docs/architecture/phase0-security-foundation.md`](docs/architecture/phase0-security-foundation.md)
- 本地基础设施运行手册：[`docs/runbooks/local-development.md`](docs/runbooks/local-development.md)

## 当前能力

Phase 0 已实现账号注册与登录、手机号验证、设备会话与单设备撤销、组织创建与成员隔离、追加式审计、可恢复 Outbox Worker、共享 SDK、覆盖全部 17 个能力的 `torg` CLI，以及登录/组织/设备 Web 工作台。

文件空间、OKR/任务、审批、聊天、代码运行、常驻服务、短信生产发送、自动 HTTPS 域名、AI 员工和 AUP 生产部署尚未进入实现范围。

## 本地验证

需要 Node.js 24、pnpm 10 和 Docker Compose。安装依赖后，可运行完整 Phase 0 验证：

```bash
pnpm install --frozen-lockfile
bash scripts/verify-phase0.sh
```

验证器会在 loopback 启动临时 E2E 服务，并在结束时停止容器；不会删除 PostgreSQL/Redis 命名卷。开发环境的启动、停止及破坏性清理边界见本地运行手册。

CLI 默认连接 `http://127.0.0.1:4110`，无参数运行只显示帮助且不读取凭据、不访问网络：

```bash
pnpm --filter @tashan/cli start --
```
