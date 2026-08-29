# OrgSpace v1 备份与恢复演练

备份和恢复命令默认只显示用法或计划。不得把 `/`、用户主目录、非空对象目录或生产数据库作为演练恢复目标。

## 创建一致性备份

先暂停 API、Worker 和 Realtime 写入，导出 MinIO `orgspace-files` bucket 到一个只读本地目录，再执行：

```bash
node scripts/backup-orgspace.mjs \
  --database-url "$DATABASE_URL" \
  --object-dir /absolute/exported-orgspace-files \
  --environment-file /absolute/.env.production \
  --output-dir /absolute/empty-backup-target

# 审核计划后才添加：
node scripts/backup-orgspace.mjs ... --apply
```

`pg_dump` 的主版本必须不低于数据库主版本。若宿主机客户端版本不匹配，可显式使用生产 PostgreSQL 容器内的同版本工具：`--pg-dump-container <exact-container-name>`。

备份包包含 PostgreSQL custom dump、对象 tar、逐文件 SHA-256、全表逻辑计数、统一 checkpoint 和所需 Partner 密钥版本；不复制或打印密钥值。

## 隔离恢复演练

目标数据库必须在 loopback，名称必须以 `_test` 结尾，public schema 必须为空；对象目标必须为空：

```bash
node scripts/restore-orgspace-backup.mjs \
  --backup-dir /absolute/backup \
  --database-url postgresql://user:password@127.0.0.1:5432/orgspace_restore_test \
  --object-target /absolute/empty-object-target \
  --environment-file /absolute/restore.env

# 验证计划后：
node scripts/restore-orgspace-backup.mjs ... --apply --confirm-restore
```

对应地可用 `--pg-restore-container <exact-container-name>`。容器名称只接受受限字符，并且数据库仍必须是 loopback `_test` 目标。

恢复完成后脚本比较所有逻辑表计数和对象哈希。checkpoint、artifact checksum、所需密钥版本、tar 路径或目标空目录任一不满足即失败。

## 生产恢复边界

此脚本故意不允许直接写生产数据库。生产事故时先创建新的隔离数据库和对象目录，完成本演练与业务 smoke，再通过单独批准的切换流程更新生产连接。旧数据库、MinIO volume 和密钥文件在新栈验收前不得删除。
