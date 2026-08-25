# OrgSpace 可靠 Skill/CLI 分发设计

日期：2026-08-26  
状态：已选择方案 A，待用户审阅书面规范  
范围：公开 Skill 与 `torg` CLI 的无 Tailscale 安装可靠性；不新增业务 capability。

## 1. 背景与目标

`v0.1.0-alpha.2` 的公开 Skill 已能从 GitHub 安装，CLI 安装器会从 GitHub Release 下载 `SHA256SUMS` 和三平台资产并校验。但是两个互不知情、只读公开 Skill 的新用户智能体均在下载 `SHA256SUMS` 时失败，未能获得 CLI，也没有进入健康、能力或短信注册步骤。单次成功不能证明安装链路稳定。

本轮目标是建立两层可靠分发：

1. `orgspace.tashan.chat` 作为他山官方 HTTPS 主源，发布 Skill 包、CLI 包和统一校验和；
2. GitHub 的固定 tag/Release 作为 Skill 和 CLI 备用源；
3. 用户不需要 Node.js、pnpm、源码、sudo 或 Tailscale；
4. 任何来源都必须通过固定版本、严格归档布局和 SHA256 校验；
5. 修复后由两个全新的零上下文智能体分别完成真实用户验收。

## 2. 方案选择

采用方案 A：AUP 官方静态镜像加 GitHub 备用。

不采用仅增加 GitHub 重试，因为它不能解决持续网络不可达。不在本轮引入阿里云 OSS/CDN，因为这会新增 bucket、RAM 权限、账单和域名运维；本设计把存储与公开 URL 分离，未来可在不改变安装契约的情况下把静态目录迁移到 OSS/CDN。

## 3. 公开路径与不可变资产

版本目录固定为：

```text
https://orgspace.tashan.chat/downloads/orgspace/v<semver>/
```

每个版本目录只包含白名单文件：

```text
SHA256SUMS
tashan-orgspace-skill-v<semver>.tar.gz
torg-v<semver>-darwin-arm64.tar.gz
torg-v<semver>-darwin-x64.tar.gz
torg-v<semver>-linux-x64.tar.gz
```

稳定入口：

```text
https://orgspace.tashan.chat/downloads/orgspace/install-skill.sh
```

版本目录一经发布不可覆盖、不可追加、不可删除。`install-skill.sh` 是唯一可更新的稳定入口，必须明确显示当前固定版本；它默认只显示帮助或检查状态，只有显式 `--install` 才写入用户目录。

## 4. Skill 安装边界

零上下文用户或本地 AI 获得稳定安装器后按以下顺序操作：

1. 下载稳定 `install-skill.sh` 到临时文件，不使用 `curl | sh`；
2. 读取帮助并执行 `--check`；
3. 用户或 AI 明确执行 `--install`；
4. 安装器下载固定版本的 `SHA256SUMS` 与 Skill 归档；
5. 校验归档哈希、顶层目录、允许文件清单以及普通文件类型；
6. 原子安装到 `${CODEX_HOME:-$HOME/.codex}/skills/tashan-orgspace`；
7. 如果目标已存在且不受本安装器管理，拒绝覆盖。

Skill 安装器只依赖 POSIX shell、`curl`、`tar` 和 `shasum`/`sha256sum`。安装完成后提示重新启动 Codex，使新 Skill 被发现。

公开安装说明同时提供 GitHub 固定 tag 的 Codex `skill-installer` 路径作为备用入口。官方安装器发生传输失败时可以提示该备用入口，但不得在脚本内部静默写入来自另一个来源的 Skill；两条安装路径各自完成独立的来源与布局验证。

## 5. CLI 双源安装状态机

Skill 内的 `scripts/install-cli.sh` 从发布元数据读取：

- 固定版本；
- 官方主源 `https://orgspace.tashan.chat/downloads/orgspace`；
- GitHub 仓库备用源；
- 三个平台的精确资产名。

对每个来源，安装器必须把 `SHA256SUMS` 和目标资产视为一个不可拆分的来源事务：

1. 使用 HTTPS、连接超时、总超时和有限重试下载到新的临时目录；
2. 只有 DNS、连接、超时或 HTTP 非成功等传输失败，才允许尝试下一个来源；
3. 如果来源返回畸形 `SHA256SUMS`、重复条目、未知哈希格式、哈希不匹配或非法归档，立即失败，不允许切换来源；
4. 不得用主源的校验和验证备用源资产，也不得保留上一次来源的临时文件；
5. 所有来源均传输失败时，报告尝试过的来源名称和错误类别，不输出凭据或本机敏感路径；
6. 完整验证通过后才原子切换 `current`，失败时保持旧版本可用。

测试专用 URL 覆盖仍由 `TORG_INSTALL_TESTING=1` 保护；生产模式拒绝环境变量改变官方来源、禁用 TLS 或跳过校验。

## 6. AUP 静态服务边界

生产文件位于：

```text
/home/aup/tashan-orgspace/shared/public-downloads
```

gateway 容器只读挂载到：

```text
/usr/share/nginx/html/downloads/orgspace
```

Nginx 为 `/downloads/orgspace/` 使用独立精确规则：

- 只允许 `GET` 和 `HEAD`；
- `try_files $uri =404`，绝不回退到 SPA `index.html`；
- 禁止目录列表；
- 版本路径发送 immutable cache header；
- 稳定 `install-skill.sh` 使用短缓存或 no-cache；
- 保留 `X-Content-Type-Options: nosniff`；
- 静态目录无法访问 API、PostgreSQL、Redis、Docker socket、宿主机其他目录或用户空间。

该共享目录独立于代码 release 目录，因此应用回滚不会删除已发布的安装资产。

## 7. 发布器与原子发布

新增发布器只负责静态分发，不修改数据库或账号：

```text
scripts/publish-public-distribution.sh
```

安全默认：

- 无参数或 `--preflight` 只读检查；
- 只有 `--apply --confirm-production` 才上传；
- 要求干净工作树、精确 tag、release manifest 和构建版本一致；
- 本地先验证所有归档、白名单布局和统一 `SHA256SUMS`；
- 远端拒绝符号链接、非常规文件、非法版本名和已存在版本目录；
- 上传到同文件系统 staging，完成后原子改名为版本目录；
- 版本目录存在即失败，不提供覆盖参数；
- 最后才原子更新稳定 `install-skill.sh`。

发布顺序：

1. 合并并部署支持只读下载挂载的代码；
2. 创建 `v0.1.0-alpha.3`，由 GitHub Actions 生成 Skill 归档、三平台 CLI 资产和覆盖全部四个归档的统一校验和；
3. 发布器获取 GitHub Release 资产、构建 Skill 归档并在本地验证；
4. 原子上传 alpha.3 版本目录和稳定 Skill 安装器；
5. 公开 HTTPS smoke 验证每个文件、长度、哈希、缓存和 404 行为；
6. 再进行零上下文用户验收。

如果主源尚未完成发布，alpha.3 CLI 安装器可以因主源 HTTP 失败转到 GitHub；主源一旦返回内容完整性错误则必须失败，防止掩盖镜像损坏。

## 8. 测试与强制门禁

### 安装器负例

至少覆盖：

1. 主源成功，备用源不得被访问；
2. 主源传输失败，备用源完整重新下载并成功；
3. 主源校验和畸形，立即失败且不得访问备用源；
4. 主源资产哈希不匹配，立即失败且不得访问备用源；
5. 两个来源都传输失败，不创建 `current` 或目标命令；
6. 备用源成功但归档含符号链接、嵌套逃逸或多余文件，拒绝安装并清理 staging；
7. 升级失败时旧版本仍可运行；
8. 无参数行为只显示帮助，不联网、不写文件。

### 发布器负例

至少覆盖非法 semver、tag/manifest 不一致、缺少资产、重复 checksum、符号链接、已存在远端版本、非 loopback/错误远端根目录以及没有显式生产确认。每个新 gate 必须附同名自测并包含真实失败形状。

### 生产形状与公网验收

- production-stack 测试必须从 gateway 读取一个静态 fixture，并证明未知路径返回 404 而不是 SPA；
- CI 强制 release metadata、Skill、CLI、静态路径和发布器契约一致；
- 公网 smoke 必须逐项验证 `SHA256SUMS` 与四个归档；
- 创建两个新的 `fork_turns=none` 子智能体，每个只知道一个手机号和稳定 Skill 安装入口；安装完成后只能读取已安装 Skill 及其直接引用文件；
- 两个智能体必须分别完成 Skill 安装、CLI 安装、健康、能力、短信注册、登录和独立设备状态；
- 验收不得使用源码、系统 Node.js、Tailscale、原始 HTTP 或另一个智能体的状态。

## 9. 可观测性与隐私

安装器输出当前阶段、来源名称、错误类别、版本和资产名，但公开日志与验收报告不得输出手机号、验证码、密码、token、challenge、设备 ID或完整 HOME 路径。发布器可输出公开文件哈希和远端版本路径，不读取或输出生产 secret。

短信网关接受与手机实际收到必须分别记录。只有两个新用户都完成完整设备会话流程，才可把公开安装与真实账号验收标记为通过。

## 10. 非目标与后续演进

本轮不实现文件、任务/OKR、聊天、代码执行、Docker、常驻服务或动态域名，也不把 alpha prerelease 宣称为完整产品。

未来迁移到 OSS/CDN 时保持公开 URL、版本目录、校验和和安装器状态机不变，只替换 gateway 后面的静态存储实现。稳定 URL 不允许直接指向可变的未版本化 CLI 资产。
