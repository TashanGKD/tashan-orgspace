# OrgSpace 独立手机号认证验收记录

日期：2026-08-19
分支：`codex/web-platform`

## 验收结论

OrgSpace 已在自身仓库内完成手机号注册、手机号密码登录、用途绑定短信验证码、短信验证码重置密码、全部旧设备会话撤销，以及 Web、SDK、CLI、Skill 的同一能力覆盖。账号、数据库、Cookie、token、短信配置与实训营项目不共享。

本次没有发送真实阿里云短信，没有连接或部署 AUP，没有配置域名，没有推送、合并或创建 PR。

## 静态检查与门禁

`bash scripts/verify-phase0.sh` 最终输出 `verify-phase0: PASS`，其中包括：

- 工具链、Prettier、ESLint、全仓 TypeScript 检查；
- `check-capability-coverage: PASS (0 violations, 17 capabilities)`；
- `check-phone-auth-surface: PASS (0 violations, 4 auth capabilities)`；
- `check-gate-self-tests: PASS (0 violations, 7 gates)`；
- 发布契约与提交证据门禁自测。

专项门禁拒绝真实形状的旧 `--username` 认证选项、`WHERE username =` 查询、缺失的 Web 密码重置表面、缺失的 CLI 绑定，以及 Skill 命令中的明文密码或验证码参数。门禁同时接入 `.githooks/pre-commit` 和 CI 使用的 `scripts/verify-phase0.sh`。

## 单元与拒绝测试

完整验证中的包测试结果：

- Contracts：31 项通过；
- Capabilities：12 项通过；
- Testkit：15 项通过；
- API：44 项通过；
- SDK：9 项通过；
- CLI：27 项通过；
- Web：46 项通过。

API 测试包括验证码用途隔离、过期、尝试次数、并发注册、未知账号与错误密码统一错误、重置后旧会话撤销、阿里云返回值失败关闭，以及幂等响应密封。幂等注册响应使用 AES-256-GCM 保存；篡改密文、错误密钥和畸形密封包均被拒绝，数据库响应缓存中不保留明文 access token 或 refresh token。

## 数据库与真实 API 集成

在仅回环的 PostgreSQL/Redis 容器上运行：

- API integration：10 个文件、41 项通过；
- CLI 对真实 API integration：1 个文件、1 项通过。

迁移测试证明：存在未绑定手机号的旧账号或未清理的旧验证码挑战时，`006_phone_identity.sql` 失败关闭；正常迁移后账号手机号和显示名为数据库必填约束，旧 `username` 列不存在。

## Docker E2E

完整验证运行 4 个 E2E 文件、4 项通过。手机号生命周期覆盖：

1. 验证手机号并注册；
2. 同一真实人员在两台设备登录；
3. 两台设备的 access token 均可使用；
4. 发送并完成密码重置；
5. 两台设备的旧 access token 与 refresh token 全部失效；
6. 旧密码登录失败，新密码登录成功；
7. 审计记录包含脱敏手机号、服务器 IP、设备元数据、调用来源和请求 ID；
8. 审计中不存在完整手机号、验证码、密码、access token 或 refresh token。

测试验证码只写入权限 `0600` 的临时文件，测试进程在 `finally` 中递归删除临时目录。

## 发布包和新用户安装

分发测试 15 项通过；`test-fresh-user-install.self-test` 与本地构建安装均通过。新用户场景验证了 macOS arm64、`torg 0.1.0-alpha.1`、无系统 Node.js 的启动路径。此前独立公开入口黑盒验收仍表明生产 health 返回畸形 JSON，因此本记录不把本地功能完成误报为生产服务可用。

## Web 生产构建

`pnpm --filter @tashan/web build` 通过，生成：

- `apps/web/dist/index.html`；
- `apps/web/dist/assets/index-EsOWM6LN.css`；
- `apps/web/dist/assets/index-DWP1WE8a.js`。

登录、创建账号、重置密码由独立 `AccessPanel` 组件承载，前端只调用 SDK，不导入后端或实训营源码。

## 实训营隔离核验

实施前实训营工作树状态指纹为 `b2ce3195c7982c0d1ec918d65bbb22b8d7aca96e1b9e20e2a49658e4998e1a2b`。最终只读复核时指纹变为 `cd7348ba369930438c828321ea10d4784acfb51ebb0e0e33141191b1d6955ad2`，新增状态仅为：

- `packages/contracts/src/admin-capabilities.test.ts`；
- `packages/contracts/src/capabilities.ts`。

两文件修改时间为 02:28 与 02:27，内容属于实训营管理员 capability 类型和冻结测试。调查同时发现另一个自 01:46 起以 `/Users/boyuan/aiwork/Tashan-Org` 为工作目录的 Codex 进程，并在实训营目录运行 Node 测试。OrgSpace 工作树与这两文件 inode 不同，本任务没有对实训营目录执行写入、格式化、测试、恢复或清理操作。

因此不能声称外部工作树指纹保持不变；可以确认本任务的变更清单不包含实训营路径，且没有覆盖或清理并行任务的改动。

## 门禁机制复盘

任务结果：手机号认证全表面和敏感响应保护已完成，生产部署与真实短信明确未执行。

本轮实际触发的机制：

- 手机认证专项门禁首次运行拒绝缺失的 Web `auth.verification.send` 表面；补齐后门禁及其六类病理自测通过。
- 完整验证先后因 `pnpm-lock.yaml` 格式和门禁自测未使用变量被 Prettier/ESLint 拒绝；修复后才进入后续测试。
- 跨设备 E2E 首次准确失败于缺少脱敏手机号审计字段；补齐安全审计字段后通过。

未及时触发的机制：原有 capability coverage 只比较能力清单和测试文件存在性，不能发现 Skill 代码块传递秘密参数，也不能发现注册 token 明文进入幂等响应缓存。前者由 `check-phone-auth-surface` 及同名自测补齐；后者由幂等响应密封单元测试和真实数据库集成断言补齐。
