# Tashan OrgSpace 空间、文件与配额设计

> 日期：2026-08-29
> 状态：用户已确认设计
> 适用范围：Phase 1 个人空间、组织空间、文件、文件夹权限、配额、版本和回收站
> 前置基础：Phase 0 身份、组织、设备、审计、CLI/Skill 分发与公网控制面

## 1. 目标

Phase 1 交付第一个可供真实用户使用的业务闭环：用户通过 Web、CLI 或调用 CLI 的 Skill，在不获得 AUP SSH、Tailscale 或 MinIO 长期凭据的前提下，管理个人和组织文件。

完成后，以下模块可从 `coming_soon` 切换为 `available`：

- `personal.overview`；
- `personal.files`；
- `personal.usage`；
- `organization.files`。

运行、构建、用户网站、服务、数据库、daemon 和用户域名继续保持延期，不进入本设计的 capability、CLI、Skill 或验收。

## 2. 已确认的产品规则

### 2.1 空间与额度

- 每个账号恰好有一个个人空间，默认额度 50 GiB。
- 组织管理员可以为本组织成员设置个人额度 entitlement，平台上限为 500 GiB。
- 同一用户加入多个组织时，个人空间有效额度取所有有效 entitlement 的最大值。
- 成员退出签发 entitlement 的组织后，该 entitlement 失效。
- 额度下降且实际占用已超额时，空间变为只读；系统不自动删除文件。
- 每个组织恰好有一个组织空间，固定额度 500 GiB。
- 历史版本和回收站内容继续占用额度。
- 上传中的 `StorageReservation` 计入预留占用，防止并发超卖。

### 2.2 文件和版本

- 不限制文件类型，不设置独立于空间额度的单文件大小上限。
- 同一文件夹出现同名文件时默认拒绝，不静默覆盖。
- 用户只有明确指定目标文件 ID，才能把上传提交为新版本。
- 新版本成为当前版本，旧版本保留并可以恢复。
- 第一版不允许单独永久删除一个历史版本。
- 删除文件时，文件及全部版本一起进入回收站。

### 2.3 回收站

- 回收站固定保留 30 天，第一版不提供组织级自定义保留时间。
- 用户可以在到期前恢复或永久删除。
- 到期后由 Worker 自动永久清理数据库记录和 MinIO 对象。
- 重复执行清理必须幂等，不得重复扣减用量或误删已恢复对象。

### 2.4 搜索和预览

- 第一版搜索文件名、文件夹名、路径、创建者和更新时间。
- 第一版不做文件正文全文检索，也不运行服务端内容解析流水线。
- 图片、PDF 和纯文本可以在 Web 中安全预览。
- 其他格式显示元数据并提供下载。
- CLI 可以读取或下载任意获授权文件。

## 3. 总体架构

采用“PostgreSQL 控制面 + MinIO 数据面 + 预签名传输面”。

```text
Web / torg / Skill
        │ 用户 token：创建会话、权限、配额、提交
        ▼
OrgSpace API ─────────────── PostgreSQL
        │                    元数据、权限、版本、配额、审计
        │ 短期预签名地址
        ▼
files.orgspace.tashan.chat ─ MinIO
                             临时分片、正式文件 Blob
        ▲
        │ 内部调和、SHA-256 校验、到期清理
OrgSpace Worker
```

本地开发和 AUP 都部署 MinIO。应用只依赖标准 S3 接口，不依赖 MinIO 私有业务 API。以后迁移到阿里云 OSS 时，保持对象 key、上传会话和 API 契约不变。

`files.orgspace.tashan.chat` 是 OrgSpace 自身的平台文件入口，不是用户网站托管功能。

## 4. 数据模型

### 4.1 Space

`Space` 是授权与配额边界：

- `id`；
- `type`：`personal | organization`；
- `account_id` 或 `organization_id`，两者恰有一个；
- `quota_bytes`；
- `used_bytes`；
- `reserved_bytes`；
- `write_state`：`writable | quota_readonly`；
- 根文件夹 ID、创建时间和更新时间。

数据库唯一约束保证每个账号一个个人空间、每个组织一个组织空间。用量字段是事务性账本的汇总，不以 MinIO bucket 扫描结果作为实时授权依据。

### 4.2 PersonalQuotaEntitlement

组织为成员签发的个人额度授权：

- 组织、账号、额度、签发管理员；
- 生效状态和撤销时间；
- 额度必须在 50–500 GiB 之间；
- 只有有效 Membership 对应的 entitlement 参与额度计算。

### 4.3 FileEntry

`FileEntry` 表示文件或文件夹：

- `id`、`space_id`、`parent_id`；
- `kind`：`file | folder`；
- 展示名称和规范化名称；
- 创建者、当前版本 ID；
- 状态：`active | trash`；
- 乐观锁版本和时间字段。

路径由父子关系计算，只用于界面和搜索。授权基于不可猜测 ID、`space_id` 与文件夹权限，不把用户字符串拼成对象存储路径。

同一父目录下，规范化名称在活动状态中唯一。Unicode 规范化采用 NFC；大小写冲突规则在所有客户端保持一致。

### 4.4 FileVersion

每个文件至少有一个版本：

- `id`、`file_entry_id`、顺序版本号；
- 服务端生成的 object key；
- 字节数、声明和探测到的内容类型；
- canonical SHA-256；
- 状态：`verifying | available | corrupt`；
- 创建者和创建时间。

MinIO object key 使用随机 ID，不包含账号、组织、文件夹或文件名。

### 4.5 文件夹权限

`FolderAccessPolicy`：

- `folder_id`；
- `scope`：`organization_public | restricted`；
- 权限版本号和修改者。

`FolderGrant`：

- 文件夹、账号和角色；
- 角色：`manager | editor | viewer`；
- 授予者和时间；
- 同一文件夹与账号唯一。

个人空间不使用组织 Grant；账号本人拥有完整权限。

### 4.6 UploadSession 与 StorageReservation

`UploadSession` 保存：

- 目标空间、文件夹和可选目标文件 ID；
- 文件名、预期字节数和内容类型；
- 临时 object key、S3 upload ID；
- 分片大小、已登记分片和过期时间；
- 状态：`created | uploading | verifying | completed | cancelled | expired | failed`；
- 创建者、幂等键和完成后的版本 ID。

`StorageReservation` 保存空间、上传会话、预留字节数和释放/提交状态。上传会话和预留一一对应。

### 4.7 TrashEntry

回收记录保存：

- 被删除的入口；
- 原父文件夹；
- 删除者、删除时间和到期时间；
- 清理状态和幂等清理键。

文件夹进入回收站时，整棵子树从普通列表和搜索中消失，但数据库仍保留原层级关系，便于原位恢复。

## 5. 文件夹权限模型

### 5.1 组织根目录

- 所有有效组织成员可以进入组织文件空间。
- 根目录固定为组织内公开，所有有效成员拥有等价 `editor` 权限，不能改为受限。
- 所有成员可以在根目录创建一级文件夹。
- 创建一级文件夹时必须选择 `组织内公开` 或 `指定成员`。
- 创建者自动成为该文件夹首位 `manager`。

直接放在根目录的文件继承根目录公开权限。受限内容必须放入显式设为 `restricted` 的文件夹。

### 5.2 公开与受限

`organization_public`：

- 所有有效组织成员自动获得等价 `editor` 权限；
- 管理者通过显式 `manager` Grant 维护；
- 公开改受限需要确认并写高风险审计。

`restricted`：

- 只有有效 Grant 中的账号可以访问；
- `manager` 可以读写内容、调整公开范围、增加或移除成员、修改角色；
- `editor` 可以查看、上传、下载、创建、修改、移动和移入回收站；
- `viewer` 只能查看、预览、搜索和下载。

### 5.3 继承、移动和删除

- 文件和子文件夹继承最近一级设置过策略的文件夹。
- 子文件夹可以建立新的权限边界。
- 移动对象后立即采用目标位置权限。
- 移动操作要求来源位置和目标位置都有写权限。
- `editor` 可以管理边界内普通内容，但不能删除权限边界文件夹本身。
- 删除权限边界文件夹需要 `manager`。
- 任何变更都不能使文件夹失去最后一名有效管理者。

### 5.4 组织管理员

组织管理员不自动获得受限文件夹内容权限。

管理员可以查看：

- 文件夹名称、创建者和占用空间；
- 公开/受限状态；
- 是否存在有效管理者。

管理员不能查看、预览或下载受限内容。文件夹失去全部有效管理者时，管理员可以指定一名新管理者；恢复不读取内容，并记录高风险审计。

成员离开组织后，其 Grant 立即失效，新的控制面请求立即拒绝。已签发但尚未使用的下载地址最长 5 分钟、分片上传地址最长 15 分钟；客户端续期时必须重新通过控制面授权。

## 6. 上传与版本流程

### 6.1 创建上传会话

1. 客户端提交目标空间、文件夹、文件名、预期大小和可选目标文件 ID。
2. API 验证账号、设备、Membership、空间写状态和继承后的权限。
3. API 规范化名称并检查同名冲突或目标版本关系。
4. PostgreSQL 事务锁定空间用量，确认 `used + reserved + requested <= quota`。
5. 同一事务创建 `UploadSession` 和 `StorageReservation`。
6. API 在 MinIO 创建临时 multipart upload，并返回短期预签名地址。

默认分片大小为 16 MiB；对于大文件，服务端自动增大分片，确保不超过 S3 的 10,000 分片限制。客户端不能自行改变服务端确定的 object key、upload ID 或分片范围。

### 6.2 分片上传与续传

- 客户端直接上传到 `files.orgspace.tashan.chat`。
- 每个分片提交 SHA-256 transport checksum，MinIO/S3 校验传输完整性。
- 客户端向 API 登记分片号、ETag 和 checksum。
- API 可以从 S3 `ListParts` 复核，不把客户端清单当作唯一真源。
- 上传会话支持查询缺失分片，因此 Web、CLI 和另一台已授权设备可以继续未过期上传。
- 预签名 URL 只允许操作指定临时对象和分片，不能列举 bucket。

MinIO 官方支持为 multipart 上传添加 SHA-256 checksum；本设计仍把 canonical 全文件 SHA-256 与 transport checksum 分开，避免把 multipart ETag 当成文件哈希。[MinIO checksum 文档](https://min.io/docs/minio/linux/reference/minio-mc/mc-put.html)

### 6.3 完成与校验

1. 客户端请求完成上传。
2. API 从 MinIO 复核分片、大小和 upload ID。
3. MinIO 完成临时对象后，会话进入 `verifying`。
4. Worker 通过 AUP 内网流式读取临时对象，计算 canonical SHA-256；不经公网 API 转发。
5. 校验成功后，数据库事务创建 `FileEntry`/`FileVersion` 或新版本，提交预留并增加实际占用。
6. 版本状态变为 `available`，客户端才能下载。

重复完成请求返回同一版本，不生成重复对象。校验失败时版本不可发布，会话进入 `failed`，Worker 清理临时对象并释放预留。

### 6.4 调和

- 对象存在但数据库未完成：按上传会话和 TTL 清理孤立对象。
- 数据库版本存在但对象缺失：版本标记 `corrupt`，禁止下载并告警。
- Worker 中断：租约到期后由另一 Worker 继续校验或清理。
- 所有清理与调和操作使用确定幂等键。

## 7. 下载、预览和搜索

### 7.1 下载

API 每次下载前重新校验身份、Membership 和权限，生成只读、短期预签名 URL。URL 绑定唯一 object key，不能改写为同 bucket 其他对象。

下载申请写审计；MinIO 访问日志用于传输排障。预签名 URL 不替代权限真源，因此有效期保持较短。

下载 URL 最长有效 5 分钟。大文件下载续期必须重新调用 API；API 会再次校验当前权限。

### 7.2 预览

- PDF、图片和纯文本使用受控预览响应。
- 响应包含严格 Content-Type、`X-Content-Type-Options: nosniff` 和限制性 CSP。
- HTML、SVG、JavaScript 等主动内容不以内联同源页面执行，默认作为附件下载或使用隔离预览 origin。
- 文件不会被服务器执行。

### 7.3 搜索

搜索只索引 PostgreSQL 元数据：规范化名称、祖先路径、创建者和更新时间。每个结果在返回前再次应用空间与文件夹权限，计数也不能泄漏受限对象存在性。

## 8. 回收站与恢复

- 删除操作把入口和子树标记为 `trash`，记录原位置和 30 天到期时间。
- 回收站内容继续占用额度。
- 恢复需要原位置写权限；原名称已占用时返回冲突，由用户选择新名称或新位置。
- 永久删除需要强确认；组织权限边界文件夹还需要 `manager`。
- Worker 按确定批次永久删除 MinIO 对象，再事务性扣减 `used_bytes` 并完成数据库清理。
- 删除对象失败时不提前扣减额度；重试不能重复扣减。

## 9. API、CLI、Web 与 Skill

### 9.1 Capability 族

实施计划必须为以下能力族定义精确 schema、权限、幂等、确认和审计：

- 空间：列表、读取、用量、个人额度 entitlement；
- 文件：列表、读取、搜索、创建文件夹、移动、移入回收站、恢复、永久删除；
- 版本：列表、创建、恢复；
- 上传：创建、列出、读取、登记分片、完成、续传、取消；
- 权限：读取策略、修改公开范围、授予、撤销和管理员恢复管理者。

所有服务端用户 capability 必须有 CLI 绑定和 Skill 引用；Web 上线动作必须登记 capability surface 与 resource surface。

### 9.2 CLI

```text
torg space list|get|usage
torg file list|get|search
torg file upload|download
torg file mkdir|move
torg file versions|version-upload|version-restore
torg file trash|restore|delete
torg folder access|get-access|grant|revoke
torg upload list|resume|cancel
```

规则：

- 无参数只显示帮助，不联网、不读取凭据。
- 组织操作显式提供 `--org` 和 `--space`；个人操作显式提供 `--space`。
- 同名上传默认失败；新版本必须显式指定文件 ID。
- 永久删除需要更强确认；非交互调用还需要 `--yes` 和幂等键。
- 第一版不实现 `file sync`。
- JSON 输出、stdout/stderr 和错误码保持稳定。

### 9.3 Web

个人路由：

```text
/personal
/personal/files
/personal/files/:entryId
/personal/usage
```

组织路由：

```text
/org/:organizationId/files
/org/:organizationId/files/:entryId
```

列表页提供面包屑、文件夹导航、元数据搜索、上传、新建文件夹、移动、回收站和用量。详情页提供预览/下载、版本、校验和、权限来源、活动记录和允许动作。

### 9.4 Skill

Skill 先调用 `torg capability list|describe --json`，再使用已发布命令。Skill 不自行构造 MinIO URL、不保存预签名 URL、不调用 S3 SDK，也不通过 SSH 或本地文件系统模拟缺失能力。

## 10. MinIO 与平台部署

### 10.1 本地

本地 Compose 增加固定版本 MinIO、私有数据卷和健康检查。测试使用独立 bucket/prefix，不复用开发数据。测试结束只清理测试 bucket/prefix，默认不删除开发卷。

### 10.2 AUP

- MinIO 使用 OrgSpace 独立服务账号、数据目录、Compose service 和备份路径。
- S3 API 只在平台内部网络和 `files.orgspace.tashan.chat` 受控入口可达。
- MinIO Console 和管理端口不向公网开放。
- API 和 Worker 使用最小权限服务凭据；凭据不进入 Git、CLI、Skill、审计或前端包。
- bucket 禁止匿名访问和公开列举。
- 数据库备份与 MinIO 对象备份必须记录一致的恢复点；恢复演练同时验证元数据和对象。

## 11. 安全与先行拒绝测试

实现正常路径前必须先覆盖：

- `../`、绝对路径、反斜杠、URL 编码穿越、Unicode 混淆和空名称；
- 客户端伪造 object key、upload ID、part number、ETag 或 checksum；
- 跨个人空间、跨组织和跨受限文件夹对象 ID；
- 两个并发上传争抢最后额度；
- 上传中断、分片缺失、大小不符、哈希错误和重复完成；
- MinIO 成功但数据库事务失败，以及数据库成功但对象缺失；
- 通过移动对象绕过来源或目标文件夹权限；
- 移除最后一名管理者和失效 Membership 继续操作；
- 旧预签名 URL、过期上传会话和已取消会话；
- 回收站恢复路径冲突和到期清理重复执行。

任何失败路径分配的预留、multipart upload、临时对象和 Worker 租约都必须有清理或调和测试。

## 12. 验收定义

至少使用两个账号、两个组织和两台逻辑设备完成：

1. 个人空间互不可见，组织管理员也不能读取成员个人空间。
2. 公开文件夹由组织成员共同读写。
3. 受限文件夹的 `manager`、`editor`、`viewer` 权限准确。
4. 管理员只看受限文件夹元数据，不能读取内容；孤儿管理者恢复可用并有审计。
5. 分片上传中断后可以在同设备和另一已授权设备继续。
6. 并发上传不会超卖额度，额度下降后的超额空间保持只读。
7. 同名冲突、新版本、历史恢复、回收站恢复和 30 天清理符合规则。
8. MinIO、Worker 或 API 重启后上传会话和调和任务可恢复。
9. Web、CLI 和 Skill 对同一对象返回一致结果。
10. 删除任一 CLI/Skill/Web 绑定时一致性门禁稳定失败。

只有上述验收和 AUP 恢复演练完成后，个人空间、个人文件、个人用量和组织文件模块才能标记为 `available`。

## 13. 非目标

- 文件正文全文检索和 OCR；
- 文件内容病毒扫描与自动分类；
- 公开匿名分享链接；
- 单文件 ACL；
- `file sync`；
- 在线共同编辑 Office 文档；
- 代码执行、构建、数据库、daemon、用户网站和用户域名。
