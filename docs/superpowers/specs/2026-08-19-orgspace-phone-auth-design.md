# OrgSpace 手机号账号与短信验证设计

日期：2026-08-19
状态：待用户书面复核
适用仓库：`tashan-orgspace`
实现分支：`codex/web-platform`

## 1. 决策摘要

OrgSpace 使用手机号作为人类账号的唯一登录标识，移除用户名注册和用户名登录。未登录页面采用“登录 / 注册账号 / 忘记密码”三态界面；交互方式参考当前磐石实训营账号页，但在 OrgSpace 仓库中独立实现。

OrgSpace 与实训营不共享源码包、数据库、Cookie、token、账号记录或运行服务。实训营项目仅作为只读参考，不能因本项工作发生代码、配置、数据或部署变化。

OrgSpace 继续独立拥有：

- 人类账号与手机号唯一性；
- 密码哈希；
- 验证码挑战及消费记录；
- Web、CLI、Skill 的设备与会话；
- 权限、组织成员身份和审计；
- 阿里云短信配置与发送记录。

## 2. 目标与非目标

### 2.1 目标

1. Web 提供一致的手机号登录、注册和忘记密码入口。
2. 注册流程为“手机号 → 获取验证码 → 输入验证码和密码 → 创建账号并自动登录”。
3. 密码重置成功后撤销该账号的全部旧 Web、CLI 和 Skill 会话，再返回登录页。
4. CLI 和 Skill 覆盖相同的发送验证码、注册、登录和密码重置能力。
5. 验证码使用阿里云短信发送，并具备用途隔离、过期、尝试次数和多维限流。
6. 保留现有设备 token、组织边界、幂等和审计模型。

### 2.2 非目标

- 不共享或读取实训营的 `panshi_session`。
- 不调用实训营账号 API，不读取实训营用户数据库。
- 不修改实训营页面、后端、短信配置或部署。
- 不建立共享组件仓库或共享 npm 包。
- 不在本项工作中实现账号资料编辑；新账号的初始展示名由后端生成，后续资料能力独立设计。
- 不在本项工作中部署 AUP、配置 `tashan.chat` 域名或发送真实生产短信。

## 3. 用户体验

### 3.1 未登录页面

OrgSpace 保留自己的品牌、说明和布局，只把访问面板改造成三态组件：

1. **登录**：手机号、密码、登录按钮。
2. **注册账号**：手机号、发送验证码、六位验证码、密码、注册按钮。
3. **忘记密码**：手机号、发送验证码、六位验证码、新密码、重置按钮。

切换状态不得丢失已输入的手机号，但必须清空密码和验证码。发送成功后显示倒计时；倒计时结束只代表允许再次发送，不代表旧验证码仍有效。

### 3.2 注册

注册提交成功后，API 在同一受控流程中创建账号、主体、当前设备和会话。Web 通过 HttpOnly refresh Cookie 自动进入组织空间；CLI/Skill 获得并安全保存当前设备的 token。

手机号在所有入口规范化为 E.164。中国大陆手机号界面可接受 `13800138000`，合同层规范化为 `+8613800138000`。

### 3.3 登录

登录仅接受手机号和密码。每台机器继续使用稳定的 device ID；同一真实人员在多台机器登录时产生不同设备会话，不创建子账号。

### 3.4 忘记密码

密码重置成功后：

1. 消费本次 `password_reset` 验证码挑战；
2. 更新密码哈希；
3. 撤销该账号所有未撤销会话，包括发起重置的浏览器；
4. 写入一条不含手机号、验证码、密码或 token 的审计事件；
5. Web 返回登录页，CLI/Skill 清理本地凭据并要求用新密码重新登录。

设备记录本身不标记为永久撤销。用户可以在同一台机器上用新密码重新建立会话。

## 4. 前后端边界

### 4.1 Web 组件

在 OrgSpace 内新增独立的访问组件，不引用实训营目录：

- `AccessPanel`：三态切换和表单布局；
- `LoginForm`：手机号与密码；
- `RegisterForm`：手机号、验证码、密码和发送倒计时；
- `PasswordResetForm`：手机号、验证码、新密码和发送倒计时；
- `VerificationCodeControl`：发送状态、倒计时、重发和无障碍提示。

组件只调用 OrgSpace session actions，不拼接 API URL、不操作 token、不理解阿里云响应。

### 4.2 API 能力

新的公开合同为：

| Capability | Method and path | Authentication | Purpose |
|---|---|---|---|
| `auth.verification.send` | `POST /v1/auth/verification/send` | anonymous or authenticated | 发送 `register` 或 `password_reset` 验证码 |
| `auth.register` | `POST /v1/auth/register` | anonymous | 验证手机号、创建账号并建立当前设备会话 |
| `auth.login` | `POST /v1/auth/login` | anonymous | 手机号密码登录并建立当前设备会话 |
| `auth.password.reset` | `POST /v1/auth/password/reset` | anonymous | 验证手机号、更新密码并撤销全部旧会话 |

`auth.phone.start` 和 `auth.phone.confirm` 的“登录后绑定手机号”语义被上述能力替代。人类账号创建时手机号已经完成验证，不再存在“已注册但手机号未验证”的正常状态。

### 4.3 合同形状

发送验证码请求包含：

```text
phone
purpose: register | password_reset
```

响应包含 `challengeId` 和 `expiresAt`，不返回验证码。

注册请求包含：

```text
phone
challengeId
code
password
device
```

注册响应使用登录响应形状，包含账号、主体、session ID、device ID 和 token；Web refresh token 仍由 HttpOnly Cookie 承载。

登录请求将 `username` 替换为 `phone`，保留 `password` 和 `device`。密码重置请求包含 `phone`、`challengeId`、`code` 和 `newPassword`。

### 4.4 SDK、CLI 与 Skill

SDK 为四个新合同提供严格解析方法。CLI 命令为：

```text
torg auth code-send --phone <e164> --purpose register|password-reset
torg auth register --phone <e164> --challenge <uuid>
torg auth login --phone <e164>
torg auth password-reset --phone <e164> --challenge <uuid>
```

密码和验证码只允许通过隐藏交互输入或标准输入读取，不作为命令参数。结构化输出不得包含密码、验证码、access token 或 refresh token。Skill 说明用户如何在需要时完成安全输入，但不能把秘密写入 prompt、命令历史或日志。

## 5. 数据模型

### 5.1 账号

人类账号使用：

- `phone_e164`：非空、唯一、规范化；
- `phone_verified_at`：非空；
- `password_hash`：Argon2 哈希；
- `display_name`：非空展示字段；初始值为不泄露完整手机号的 `用户` 加末四位；
- `status`、创建时间和更新时间保持现有语义。

公开 `AccountSummary` 将 `username` 替换为 `displayName`，`phone` 和 `phoneVerifiedAt` 对人类账号不再为空。组织成员列表相应使用 `displayName`。

AI 员工和服务账号未来仍通过 principal 类型扩展，不通过伪造手机号创建人类账号。

### 5.2 验证码挑战

验证码记录包含：

- challenge ID；
- `phone_e164`；
- `purpose`；
- HMAC 后的验证码；
- 过期时间；
- 失败尝试次数；
- 消费时间；
- 创建请求 ID、IP 摘要和发送结果。

验证码明文不进入数据库、日志、审计、错误对象或队列。`register` 与 `password_reset` 用途严格匹配，挑战最多成功消费一次。

### 5.3 会话撤销

密码重置与会话撤销在同一数据库事务中完成。服务端按 account ID 撤销所有未撤销 session；现有 access token 即使尚未过期，也会因每次请求检查 session 状态而失败。设备表保留，便于用户重新登录和管理员审计历史。

## 6. 阿里云短信适配器

OrgSpace 在自身仓库内实现 `AliyunVerificationCodeSender`，接口继续遵循 `VerificationCodeSender`。实现方式可以参考实训营对阿里云 SDK 的封装，但不得导入或修改实训营源码。

生产启用 `aliyun` provider 时，以下配置全部必填并在启动时校验：access key ID、access key secret、签名、验证码模板、模板参数键、endpoint 和 region。缺项必须阻止服务启动。开发和测试默认使用 `disabled` 或显式注入的 fake sender，绝不因缺少配置自动发送真实短信。

供应商响应只有明确接受才算成功；未知、缺字段或非成功响应均失败关闭。日志只保留供应商请求 ID、脱敏手机号、模板和结果，不保留验证码与密钥。

## 7. 限流、错误与审计

发送验证码至少按手机号、来源 IP 和用途三维限流。登录同时按手机号和来源 IP 限流。发送验证码接口对“账号存在”和“账号不存在”返回相同的公开结果；验证码失败采用统一外部错误，不能暴露验证码是否接近正确或账号内部状态。只有提交了该手机号有效注册挑战后，注册接口才可以返回 `ACCOUNT_EXISTS`，因为调用方此时已经证明对手机号的控制。

稳定错误至少包括：

- `AUTH_INVALID_CREDENTIALS`；
- `ACCOUNT_EXISTS`；
- `VERIFICATION_INVALID`；
- `VERIFICATION_EXPIRED`；
- `VERIFICATION_RATE_LIMITED`；
- `PHONE_PROVIDER_UNAVAILABLE`；
- `PASSWORD_RESET_FAILED`。

所有错误保留 request ID。审计记录 capability、结果、服务器观察到的 IP、设备和调用来源，但对手机号脱敏，且禁止记录密码、验证码和 token。

所有写操作继续要求幂等键。重复的注册或密码重置请求必须返回第一次已提交的结果，不得创建第二个账号、重复消费挑战或产生并行有效会话。

## 8. 迁移与兼容策略

当前项目尚未正式上线，因此不长期保留用户名登录兼容层。迁移采用前向数据库迁移和显式数据检查：

1. 添加 `display_name`、挑战用途和新约束；
2. 检查现有账号是否已有唯一且已验证手机号；
3. 对不满足条件的账号输出 account ID 报告并拒绝继续迁移；
4. 由操作者选择补录映射，或显式重置仅限本地开发的数据；
5. 条件满足后切换唯一索引和非空约束，再移除用户名认证路径。

迁移脚本不得默认删除账号或猜测手机号。任何本地数据重置必须是独立、显式、带确认的命令。

CLI 凭据文件中的 `username` 投影改为 `displayName` 和脱敏 phone；已有旧格式在读取时给出明确的重新登录提示，不自动伪造新凭据。

## 9. 测试和一致性门禁

测试分层包括：

1. 合同测试：手机号规范化、用途枚举、严格对象、秘密字段拒绝。
2. UI 测试：三态切换、倒计时、注册自动登录、重置后返回登录、request ID。
3. 服务测试：用途隔离、过期、五次失败、单次消费、手机号/IP 限流。
4. 阿里云适配器测试：明确成功、供应商拒绝、缺字段、异常和配置缺失。
5. 数据库 E2E：并发注册唯一性、注册事务回滚、密码重置原子撤销全部会话。
6. 多设备 E2E：旧 Web、CLI、Skill token 在密码重置后全部失效，新密码可在原设备重新登录。
7. 负向安全测试：跨用途验证码、挑战与手机号不匹配、重放、错误账号枚举、日志秘密扫描。

能力门禁必须同步核对 API、contracts、SDK、CLI、Web route/action/test 和 Skill。删除用户名路径后，仓库级搜索门禁拒绝重新出现 `--username` 登录参数或用户名认证查询。

## 10. 实训营零影响约束

实现和验证过程中：

- 不在实训营工作树执行写操作；
- 不改其实训营分支、依赖、数据库、容器、端口、环境变量或浏览器会话；
- 不停止当前 `127.0.0.1:5173` 服务；
- 只允许读取已存在的界面和源码以理解交互；
- OrgSpace 的测试、短信 fake 和数据库均在自身仓库及本地隔离环境运行。

最终验证报告必须单独声明实训营目录 `git status` 在本项工作前后未因 OrgSpace 操作增加任何修改。

## 11. 完成标准

只有同时满足以下条件，手机号认证改造才可称为完成：

- Web、CLI 和 Skill 均能完成发送验证码、注册、登录和密码重置；
- 注册自动登录，密码重置撤销全部旧会话；
- 阿里云适配器通过供应商响应负向测试，但未在未授权环境发送真实短信；
- 用户名认证代码、合同和 CLI 参数已移除；
- 全仓验证、数据库 E2E、能力门禁和门禁 self-test 通过；
- 实训营项目没有发生任何修改；
- 未把本地验证误报为 AUP 或生产部署。
