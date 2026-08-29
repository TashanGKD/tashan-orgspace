# 空间、文件与额度 Phase 1 验收记录

- 日期：2026-08-29
- 已验证代码提交：`9d31ae527325ff10fc9f35fead2317a77c338dc4`
- 已验证 Git tree：`1f25cda5bece41b66da3dcaddd212a10c058063e`
- 分支：`main`
- 范围：个人/组织空间、文件、文件夹权限、额度、版本、断点续传、回收站和存储恢复

## 最终结果

对上述代码提交运行 `ORGSPACE_TEST_CLEANUP_VOLUMES=1 bash scripts/verify-phase0.sh`，最终输出 `verify-phase0: PASS`。

- 工具链、Prettier、ESLint、全仓 TypeScript：通过。
- 常规测试：39 个测试文件、288 项测试通过；其中 Web 为 19 个测试文件、108 项测试。
- 分发测试：4 个测试文件、29 项测试通过；真实空用户安装验证覆盖 macOS arm64、无系统 Node.js 和 `torg 0.1.0-alpha.3`。
- 能力注册表：43 个能力；其中 Phase 1 文件能力 26 个，API/Web/CLI/Skill 差异为 0。
- 一致性门禁：18 个门禁，全部存在同名负向自测；文件存储门禁报告 26 个能力、2 个资源表面、0 个违规。
- 生产形态 Compose：初始 5 项及 MinIO 重启后 5 项均通过，私有 bucket、CORS、网关和无外露数据端口保持成立。
- 真实 E2E：7 个测试文件、7 条旅程全部通过。
- 本轮新增的定向数据库集成验证：文件服务 3 项、额度 3 项、Worker 8 项、migration 4 项，分别通过。

MinIO 固定镜像：

- `quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z`
- `quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z`

## 用户与权限旅程

验收使用合成手机号和测试验证码创建两名真实账号身份；Alice 使用两个独立设备 token，另建两个组织，Bob 只加入其中一个组织。

- Alice 与 Bob 的个人空间 ID 不同；Bob 访问 Alice 个人空间返回拒绝。
- 组织公开目录允许 Bob 新建子目录。
- Bob 创建受限目录后是 manager；Alice 作为组织管理员只能读取该目录元数据，未获授权时下载返回 `FILE_FORBIDDEN`。
- Alice 可执行有理由、带当前 policy version 的 manager 恢复。
- editor 可在受限目录创建内容，但不能把自己提升为 manager；viewer 可查看但不能上传或修改。
- Bob 使用另一个组织的真实 space/root ID 被拒绝；Membership 改为 removed 后，原 token 对原组织文件空间立即失效。

## 字节与生命周期

- 创建 33 MiB、3 part 的确定性文件，设备 A 上传前两段后中断；设备 B 从服务端 `ListParts` 状态确认 `[1, 2]`，只上传缺失段并完成。
- Worker 校验完整 SHA-256 后才发布版本；CLI 下载后的字节与原始 Buffer 完全一致。
- 同目录同名新文件返回 `FILE_NAME_CONFLICT`；使用 `--target-file` 明确创建第二版。
- `file version-restore --version-id` 恢复第一版后，第二设备下载仍与最初 33 MiB 内容一致。
- 文件进入回收站后可恢复；第二次进入回收站并把测试到期时间推进后，Worker 永久删除全部版本，`usedBytes` 和 `reservedBytes` 都回到 0。

## 配额与故障恢复

- 两个事务竞争个人空间最后 10 bytes 时，仅一个 7-byte reservation 成功，另一个稳定返回 `QUOTA_EXCEEDED`。
- 管理员把成员额度提高到 100 GiB 后空间可写；降回 50 GiB 且已有 60 GiB 用量时切换为 `quota_readonly`，新 reservation 返回 `SPACE_READONLY`。
- 17 MiB multipart 上传第一段后重启 MinIO，服务恢复后仍能读取已上传 part 1 并续传。
- Worker 停止时完成 multipart，使校验任务留在数据库；替代 Worker 启动后领取任务并发布文件，证明 lease/队列可跨进程恢复。
- 替代 Worker 启动时删除严格匹配 `temporary/<uuid>` 且无有效上传会话引用的孤儿对象；合法会话对象、畸形临时键和版本键不被误删。
- 删除已发布版本对象并投递 `reconcile_version` 后，Worker 将版本标记为 `corrupt`。
- 永久删除不再被历史 `upload_sessions.target_file_id` 或 `completed_version_id` 阻塞；上传审计行保留，两个引用置空。

## Web 验收

文件 Web 在 Task 10 已完成真实浏览器检查；Task 12 未修改前端组件，完整 Web 回归仍为 108 项通过。

- 桌面：`1440 × 900`，个人文件与组织文件均采用列表/详情分栏，上传、版本、权限和回收站动作可达。
- 移动：`390 × 844`，侧栏收起为移动导航，详情使用窄屏布局，无横向溢出；Sheet 关闭按钮可点击。

## 本轮发现并修复的问题

1. 列表、详情和搜索错误地要求文件 read 权限，组织管理员无法履行“元数据可见、字节不可读”的边界；现在元数据走 `metadata`，下载仍走 `read`。
2. `file version-restore --version` 与 CLI 全局版本参数冲突并污染 JSON；已改为 `--version-id`，CLI、Skill 和门禁同步。
3. 历史上传会话外键阻塞永久删除；migration 008 将目标文件与完成版本引用改为 `ON DELETE SET NULL`。
4. Worker 缺少孤儿临时对象清理；现按严格键格式、有效会话引用和五分钟扫描间隔清理。
5. 恢复 E2E 最初关闭替代 Worker，导致后续场景无校验进程；E2E 总控现记录并最终回收替代 PID，让其服务剩余场景。

## 机制观察

### 任务评估

Phase 1 的 26 个文件能力已完成 API、Web、CLI、Skill、MinIO 数据面和真实用户旅程验收。AUP 公开环境与新 CLI/Skill 版本尚未发布，因此本文只声明代码和生产形态本地栈通过，不声明线上可用。

### 反模式与修复

- AP-1/漂移：业务参数从 `--version` 改名时，同时更新 CLI、Skill 和文件存储 gate，避免命令文档再次分叉。
- AP-3/脚手架冒充门禁：文件 gate 的负向自测把 CLI 恢复参数改回冲突形式并确认失败，不只检查文件存在。
- AP-6/局部加强破坏全局：恢复测试第一次单独通过但完整套件失败，说明 Worker 重启方案没有覆盖后续测试消费者；最终由 E2E 总控统一回收替代 Worker。

### 机制可观察性

- 实际触发一：新增管理员元数据 RED 测试在修复前收到空列表，定向集成测试明确失败；修复后列表、详情和搜索统一使用 metadata 判定（`apps/api/src/files/file-service.ts:121`、`apps/api/src/files/file-service.ts:139`、`apps/api/src/files/file-service.ts:170`），文件服务 3 项通过。
- 实际触发二：真实 E2E 调用旧 `--version` 时 stdout 同时出现 CLI 版本号和 JSON，解析失败；CLI 现固定 `--version-id`（`apps/cli/src/commands/file.ts:280`），负向自测会把它改回冲突形式并确认门禁拒绝（`scripts/check-file-storage-contract.self-test.mjs:115`）。
- 实际触发三：完整 verifier 第一次在后续文件生命周期场景发现 Worker 已被恢复场景关闭；E2E 总控现接管替代 PID 并在 finally 回收（`tests/e2e/run.ts:68`、`tests/e2e/run.ts:220`、`tests/e2e/run.ts:228`），从头运行得到 `verify-phase0: PASS`。
- 实际触发四：新增 migration 008 后，全文检索发现 Phase 2 仍计划使用同名编号；现有 gate 的负向自测构造实际/计划文件名碰撞并确认拒绝（`scripts/check-file-storage-contract.self-test.mjs:122`）。
- 未触发之处：静态 gate、单元测试以及两个单独通过的 E2E 场景都没有发现跨场景 Worker 生命周期问题，只有完整顺序执行才暴露；因此保留完整 E2E 为提交与 CI 的不可跳过阶段（`tests/e2e/run.ts:220`）。

## 剩余事项

- Phase 1 尚未部署到 AUP，也尚未发布新的 Skill/CLI 版本；这些操作留到 Phase 5，并需要执行时授权。
- `reconcile_version` 已能检测并标坏缺失对象，但周期性全量版本扫描和管理员修复界面仍是后续运维增强，不影响当前按任务投递的对账路径。
- 计算执行、Docker 构建、常驻服务、数据库产品和用户网站继续保持“即将上线”，不属于本次验收。
