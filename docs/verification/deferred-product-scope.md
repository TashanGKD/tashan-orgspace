# 延期产品范围验证记录

> 验证基线：`20dc04b`
> 日期：2026-08-29

## 自动化验证

已运行并通过：

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`（Web 18 个测试文件、96 个测试）
- `node scripts/check-deferred-product-scope.mjs`：4 个延期模块、4 份范围声明、0 个违规
- `node scripts/check-deferred-product-scope.self-test.mjs`
- `node scripts/check-gate-self-tests.mjs`：17 个门禁、0 个违规
- `ORGSPACE_TEST_CLEANUP_VOLUMES=1 pnpm test:production-stack`：4 个生产栈测试通过
- `pnpm test:e2e`：4 个隔离端到端测试通过

`ORGSPACE_TEST_CLEANUP_VOLUMES=1 bash scripts/verify-phase0.sh` 已运行并完成其静态、分发与门禁阶段；随后也再次独立运行生产栈和 E2E，均通过。

## 延期模块与路由

| 模块 ID                 | 路由                            | 状态          |
| ----------------------- | ------------------------------- | ------------- |
| `personal.runtime`      | `/personal/runtime`             | `coming_soon` |
| `personal.services`     | `/personal/services`            | `coming_soon` |
| `organization.runtime`  | `/org/:organizationId/runtime`  | `coming_soon` |
| `organization.services` | `/org/:organizationId/services` | `coming_soon` |

门禁同时检查这四个模块没有 capability，并拒绝 `runtime.`、`run.`、`build.`、`service.`、`database.`、`domain.` 和 `deployment.` 前缀重新进入服务端注册表、CLI 绑定或 Skill 引用。Web 对应路由只映射到 `ComingSoonPage`，无表单、写请求、上传、终端、日志、域名、数据库凭据或 public/private 动作。

## 浏览器验收

已在隔离的本地 Postgres、Redis、API 和 Vite Web 环境中完成浏览器流程。此前的通用错误来自不符合契约的合成密码；换用同时包含小写、大写和数字的密码后，注册 API 返回 `201`，浏览器登录进入组织工作台。

在 1440px 桌面侧栏中，“未来能力”含四条指定入口及可见“即将上线”。四条路由逐一打开后均显示模块标题、“即将上线”和“此功能暂未开放”；状态页内表单与按钮计数均为 0。390px 移动端的“更多导航”也包含相同四条入口。浏览器使用隔离账号与合成手机号/验证码，未使用真实用户数据。

## 范围边界

OrgSpace 自身继续使用 AUP、Docker Compose、Nginx、PostgreSQL、Redis、TLS 和反向隧道部署 Web/API。它们是平台基础设施，不等于向用户提供计算执行、数据库、用户网站、daemon 或用户域名托管。

## 余项

本轮无阻塞余项。浏览器验收使用应用内浏览器会话，未将截图作为仓库二进制资产保存；可复运行的路由与状态断言已由 Web 回归测试覆盖。
