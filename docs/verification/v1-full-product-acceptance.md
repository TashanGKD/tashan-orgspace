# OrgSpace v1 生产验收记录

- 日期：2026-08-31
- 最终版本：`1.0.2`
- 发布提交：`968ce996c30bdc7cce3675cb34df150391668c86`
- 分支：`main`
- 生产地址：`https://orgspace.tashan.chat`
- 文件地址：`https://orgspace-files.tashan.chat`
- GitHub Release：`https://github.com/TashanGKD/tashan-orgspace/releases/tag/v1.0.2`
- 结论：Phase 1–5 当前范围通过本地、隔离生产形态和真实生产验收

## 完整门禁

在干净的最终发布提交上运行：

```bash
ORGSPACE_TEST_CLEANUP_VOLUMES=1 bash scripts/verify-phase0.sh
```

命令以退出码 0 结束，最终输出 `verify-phase0: PASS`。GitHub Release run `33325295076` 在同一提交上再次运行完整 verifier，并在 macOS arm64、macOS x64 和 Linux x64 原生 runner 构建发布资产。

```text
check-v1-product-contract: PASS (109 capabilities, 22 modules, 6 DomainEvents)
check-capability-coverage: PASS (0 violations, 109 capabilities)
check-resource-surface-coverage: PASS (0 violations, 13 resources)
check-gate-self-tests: PASS (0 violations, 19 gates)
production-stack: PASS
E2E: 11 files / 11 journeys passed
```

## AUP 与公网

- AUP `.deployed-commit`、`current` 与 Git tag 均指向 `968ce996c30bdc7cce3675cb34df150391668c86`。
- 公网 `/v1/health` 返回 `status=ok, version=1.0.2`。
- API、Worker、Realtime、Gateway 镜像摘要分别为：
  - `sha256:cfd0b4457be23216c461afb208319945eaf13a3a7b4c21377d8e8cb88574a308`
  - `sha256:834e8826db35b11f631b7aadf7ab3b5eca83dceb04d23bd6e2150ba1e643a4f4`
  - `sha256:959809d8e4420f1755d85a5d8a7374a7dc7c8699a9a48dcd234b4d80d6a17783`
  - `sha256:86f39f7a91a8e43305bf67e3ad2324fc299f283461076fa09fd53fcef6a5e729`
- AUP—ECS 隧道完成真实 stop/start 恢复，恢复后 HTTPS 健康通过。
- `orgspace-files.tashan.chat` 受 `*.tashan.chat` 证书覆盖，MinIO live 端点返回 200；旧的二级域名不再出现在生产 vhost。

## 恢复与数据

- 生产 PostgreSQL 备份：`/home/aup/tashan-orgspace/backups/orgspace-20260830T154442Z.dump`，权限 `0600`，SHA-256 `b8165c5186b183373f93650bdfbeac153c115445351c5d338d222956da529a56`。
- 备份恢复到隔离数据库 `orgspace_restore_drill`，核对 21 条迁移后删除临时数据库。
- 最终生产计数：21 条迁移、2 个测试账号、1 个验收组织、1 条任务、1 条站内通知、1 条 delivered 短信投递。
- MinIO `orgspace-files` bucket 存在、匿名策略为 private；验收时对象数为 0。
- 应用回滚提交保留为 `5eb0cf281c0f4baac912db5c8e75ba5a66478096`；文件入口回滚需同时恢复对应 ECS vhost。

## 真实账号、浏览器与短信

- 两个用户授权的测试手机号分别完成验证码发送、运营商 `DELIVERED` 回执、注册、登录和 `whoami`；文档不记录完整号码、验证码、密码或 token。
- 创建 `他山组织空间 v1 验收组织`，第二个账号以普通成员身份加入。
- 创建紧急任务 `v1 生产通知验收` 并指派给第二个账号；站内 `emergency` 通知和 My Work 均可读。
- 固定通知模板 `SMS_512420111` 使用签名“他山青年”，运营商在 00:16:46 返回 `DELIVERED`。
- 首次真实回执暴露 UTC 跨午夜和 BizId/OutId 匹配缺陷；`v1.0.1` 修复后数据库投递状态从 `unknown` 自动收敛为 `delivered`，没有重复发送。
- 真实浏览器完成桌面登录、组织首页和任务列表检查；390×844 生产登录页无横向溢出，登录后移动布局由 120 项 Web 测试和生产路由共同覆盖。应用内浏览器的登录后 viewport 截图覆盖不稳定，未把截图本身作为通过依据。

## CLI 与 Skill 分发

- `v1.0.2` GitHub Release 不是 draft 或 prerelease，包含 Skill、三个原生 CLI 归档与一份 `SHA256SUMS`。
- AUP 官方镜像完成四归档公网重下载、Content-Length、immutable/no-cache、SHA-256 和未知资产 404 检查。
- 全新临时用户从稳定安装器安装 `tashan-orgspace 1.0.2` 与自带 Node 24 的 `torg 1.0.2`；版本、109 项能力 JSON 和生产 smoke 均通过。

## 发布中发现并修复的问题

1. AUP 生产环境缺少 MinIO、S3、Partner 与通知模板字段；部署器新增当前 HEAD 环境契约预检，在同步前拒绝缺失、空值和重复键。
2. 固定短信模板原先仍发送空 `TemplateParam`；Worker 新增 `none` 模式并完全省略模板参数。
3. 北京时间跨午夜时使用 UTC 日期，且回执 DTO 没有 BizId；新增北京时间日期、OutId 匹配和无 DTO fallback。
4. `files.orgspace.tashan.chat` 不受 `*.tashan.chat` 证书覆盖；文件入口迁移到 `orgspace-files.tashan.chat` 并加入生产与文件契约门禁。
5. 两个分发/部署测试把升级版本硬编码为当前补丁号；改为从发布清单派生，确保负例真正到达目标分支。

通用计算、用户数据库、常驻进程和用户网站部署仍显示“即将上线”，不属于本次 v1 验收范围。
