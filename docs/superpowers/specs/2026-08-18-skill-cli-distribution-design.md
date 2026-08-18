# Tashan OrgSpace Skill 与 CLI 分发设计

日期：2026-08-18

## 目标

让一个从未接触过项目源码的用户，只需让自己的 Codex 从公开 GitHub 仓库安装 `tashan-orgspace` Skill，之后由 Skill 检测、安装、升级并调用 `torg` CLI。CLI 使用用户本人登录后保存的设备会话，以用户身份操作 OrgSpace。

公开仓库固定为 `TashanGKD/tashan-orgspace`。正式服务地址固定为 `https://orgspace.tashan.chat`；现有 `org.tashan.chat` 属于旧的 `ai-org-builder`，不得复用或覆盖。

## 方案选择

评估过三种分发方式：

1. 公共 npm 包：实现简单，但要求每台用户电脑预装兼容的 Node.js 24，不满足一键安装。
2. Skill 克隆完整开发仓库并运行 pnpm：下载大、依赖多、会把开发工具链暴露给普通用户，不采用。
3. GitHub Skill 加版本化 Release：Skill 很小，安装器下载匹配平台的自包含 CLI 产物并校验 SHA-256。选择此方案。

## 公开安装入口

Skill 位于 `skill/tashan-orgspace/`，可由 Codex 内置的 Skill installer 从以下公开路径安装：

```text
https://github.com/TashanGKD/tashan-orgspace/tree/main/skill/tashan-orgspace
```

Skill 不复制整棵命令树。它负责：

- 在需要使用 OrgSpace 时检查 `torg` 是否存在且版本是否满足 Skill 的固定版本；
- 明确调用随 Skill 分发的安装脚本执行安装或升级；
- 引导用户通过隐藏输入执行注册、登录与验证码操作；
- 调用 `torg capability list|describe --json` 发现服务器能力；
- 对创建、撤销等有副作用的命令保留 CLI 的确认与幂等要求；
- 不读取、打印或转述 access token、refresh token、密码与验证码。

## CLI Release

开发源码继续保留安全默认：无参数只显示帮助，源码运行默认连接 loopback。Release 包中的启动器显式设置：

```text
TORG_ENV=production
TORG_API_URL=https://orgspace.tashan.chat
```

CLI 代码用 esbuild 打成单个 ESM bundle；Release 产物同时携带对应平台的 Node.js 24 可执行文件，因此用户不需要安装 Node 或 pnpm。第一版支持：

- macOS arm64
- macOS x64
- Linux x64

每个压缩包包含固定布局、版本文件和启动器。GitHub Release 同时发布 `SHA256SUMS`。版本真源是 `release/cli-release.json`，并由门禁保证它与 CLI package、CLI `--version` 和 Skill 固定版本一致。

正式标签使用 `v<semver>`。在 `https://orgspace.tashan.chat/v1/health` 尚未通过真实 HTTPS 健康检查前，只能发布 GitHub prerelease；稳定 Release 必须由发布工作流的生产健康门禁放行。

## 安装与升级

POSIX 安装器默认无参数只显示帮助，不联网、不写文件。Skill 明确执行 `--install` 后，安装器：

1. 检测操作系统和架构，拒绝未知平台。
2. 读取 Skill 内固定的 Release 版本，不追随可变 `latest`。
3. 从固定的 GitHub Releases 地址下载压缩包和 `SHA256SUMS`。
4. 在临时目录校验 SHA-256、归档条目和固定布局。
5. 安装到 `${XDG_DATA_HOME:-$HOME/.local/share}/torg/versions/<version>`。
6. 在 `${TORG_BIN_DIR:-$HOME/.local/bin}/torg` 原子更新一个由安装器管理的启动器。
7. 执行 `torg --version` 和无参数安全烟测；失败则回滚到旧版本。

安装器不使用 `sudo`，不修改 shell rc 文件，不删除凭据和旧版本。若目标 `torg` 已存在但不是本安装器管理的文件，必须拒绝覆盖并给出显式解决办法。

## 对抗输入与失败恢复

实现前必须先编码以下拒绝测试：

- `--version ../../tmp/pwn` 等版本路径穿越输入；
- 不支持的 OS/CPU 组合；
- SHA-256 不匹配或校验清单没有精确目标文件；
- 归档包含绝对路径、`..`、额外顶层目录或符号链接；
- 目标 `torg` 是用户自有文件或指向安装根目录之外；
- 下载、解压或烟测中途失败时，不得破坏已有可用版本，也不得遗留部分安装。

测试专用 Release 源只能在 `TORG_INSTALL_TESTING=1` 时覆盖；普通运行忽略测试覆盖变量，避免 Skill 被诱导到任意下载源。

## CI 与防漂移

CI 在现有 Phase 0 验证之外增加：

- Release 元数据、CLI package、Skill 固定版本和产物名称一致性门禁；
- 门禁同名负向自测；
- 安装器对抗输入测试；
- 本地构建产物后，在空 HOME、空 PATH 补充目录中安装并运行 CLI 的新用户测试；
- Skill `quick_validate.py` 校验；
- GitHub Release workflow 的 tag/version 一致性检查。

任何新增 Web/API 能力仍必须通过现有 17 项 capability 一致性门禁。Skill 只消费机器可读能力，不成为第二份 API 真源。

## 真实新用户验收

发布 prerelease 后，由独立子智能体获得且只获得公开 Skill URL和用户任务。它在临时 `HOME`、临时 `CODEX_HOME`、不引用本地源码的环境中完成：

1. 从 GitHub 安装 Skill。
2. 由 Skill 安装 CLI。
3. 验证安装目录、版本、无参数安全行为和 `--help`。
4. 连接隔离测试 API，执行 `capability list`，确认输出为单个 JSON 值。
5. 确认日志和终端输出不含 token、密码或验证码。
6. 再次安装，验证幂等；注入损坏校验和，验证旧版本仍可用。

根代理必须独立复核子智能体证据。只有公开 GitHub URL、Release 资产和上述流程均真实通过，才能声称“一键安装闭环已完成”。生产登录能力需要另行以真实 `orgspace.tashan.chat` 账号流程验收。

## 本阶段非目标

- 不在本阶段复用或迁移旧 `ai-org-builder`。
- 不在本阶段上线文件空间、任务、聊天、代码运行等 Phase 1+ 能力。
- Windows 安装器与 Windows 持久凭据存储不在第一版支持范围；Skill 必须明确提示不支持，不能静默退化为不持久的内存 Token。

