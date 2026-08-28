# 延期产品范围验证记录

> 验证基线：`97f06d2d8fae2f3c161192e37783cdb06ef32183` 加上本记录提交前的工作树
> 日期：2026-08-28

## 自动化验证

已运行并通过：

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`（Web 18 个测试文件、95 个测试）
- `node scripts/check-deferred-product-scope.mjs`：4 个延期模块、4 份范围声明、0 个违规
- `node scripts/check-deferred-product-scope.self-test.mjs`
- `node scripts/check-gate-self-tests.mjs`：17 个门禁、0 个违规
- `ORGSPACE_TEST_CLEANUP_VOLUMES=1 pnpm test:production-stack`：4 个生产栈测试通过
- `pnpm test:e2e`：4 个隔离端到端测试通过

`scripts/verify-phase0.sh` 也已启动并依次完成工具链、格式、lint、类型、全仓单测和安装分发阶段；其生产栈与 E2E 子步骤随后以独立命令重新运行并通过，见本记录的完整命令列表。

## 延期模块与路由

| 模块 ID                 | 路由                            | 状态          |
| ----------------------- | ------------------------------- | ------------- |
| `personal.runtime`      | `/personal/runtime`             | `coming_soon` |
| `personal.services`     | `/personal/services`            | `coming_soon` |
| `organization.runtime`  | `/org/:organizationId/runtime`  | `coming_soon` |
| `organization.services` | `/org/:organizationId/services` | `coming_soon` |

门禁同时检查这四个模块没有 capability，并拒绝 `runtime.`、`run.`、`build.`、`service.`、`database.`、`domain.` 和 `deployment.` 前缀重新进入服务端注册表、CLI 绑定或 Skill 引用。Web 对应路由只映射到 `ComingSoonPage`，无表单、写请求、上传、终端、日志、域名、数据库凭据或 public/private 动作。

## 浏览器验收

已在隔离的本地 Postgres、Redis、API 和 Vite Web 环境中启动浏览器流程。注册页、验证码发送和倒计时可见；但用合成手机号完成注册时，Web 显示“请求没有完成，请稍后重试”，未能进入认证后的工作台。因此本轮尚未记录 1440px/390px 的四条延期入口截图，也没有把浏览器验收标为通过。

这不改变延期范围门禁、导航组件测试或生产栈/E2E 的结果；它是后续需要单独诊断的 Web 注册旅程问题。测试环境、合成手机号和验证码均不是真实用户数据。

## 范围边界

OrgSpace 自身继续使用 AUP、Docker Compose、Nginx、PostgreSQL、Redis、TLS 和反向隧道部署 Web/API。它们是平台基础设施，不等于向用户提供计算执行、数据库、用户网站、daemon 或用户域名托管。

## 余项

- 完成真实浏览器注册旅程的错误诊断后，补做 1440px 与 390px 截图、键盘焦点和四条状态页检查，并再标记实施计划的 Task 7 浏览器步骤。
