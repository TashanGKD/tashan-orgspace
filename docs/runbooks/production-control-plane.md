# OrgSpace 生产控制面运行手册

## 边界

最终用户只访问 `https://orgspace.tashan.chat`，不使用 Tailscale、SSH、AUP 端口或 Docker。`ssh aup-server` 与 `ssh tashan-ecs` 仅供运维部署和排障。OrgSpace 的唯一远端根目录是 `/home/aup/tashan-orgspace`，唯一 Compose project 是 `tashan-orgspace-prod`。

## 上线前只读检查

```bash
scripts/deploy-orgspace.sh --preflight
scripts/configure-orgspace-ingress.sh --preflight
```

两个命令只读取本地 contract 与远端状态。任何 secret 缺失、权限不是 `0600`、端口被其他项目占用、证书缺失或 SSH 不可达都会停止。

## 部署

生产 secret 只保存在 AUP：

```text
/home/aup/tashan-orgspace/shared/.env.production
```

文件必须属于 `aup` 且权限为 `0600`。字段名以 `deploy/env.production.example` 为准；不得 `source` 该文件，不得打印内容，不得提交 Git。

确认完整验证通过且 worktree 干净后执行：

```bash
scripts/deploy-orgspace.sh --apply --confirm-production
scripts/configure-orgspace-ingress.sh --apply --confirm-production
scripts/smoke-production.sh
```

部署器只同步 HEAD 已跟踪文件到 commit 专属目录，构建和迁移成功后启动 `tashan-orgspace-prod`，健康通过后才更新 `current` 与 `.deployed-commit`。

## 只读状态检查

```bash
curl --fail --proto '=https' --tlsv1.2 https://orgspace.tashan.chat/v1/health
ssh aup-server "cat /home/aup/tashan-orgspace/.deployed-commit"
ssh aup-server "docker compose -p tashan-orgspace-prod ps"
ssh aup-server "/home/aup/tashan-orgspace/current/deploy/start-tunnel.sh --status"
ssh tashan-ecs "ss -ltnp | grep ':14010 '"
ssh tashan-ecs "nginx -t"
```

不得用其他 Compose project 的容器或其他反向端口推断 OrgSpace 正常。

## 恢复

仅恢复隧道：

```bash
ssh aup-server "/home/aup/tashan-orgspace/current/deploy/start-tunnel.sh --apply --confirm-production"
scripts/smoke-production.sh
```

验证隧道可停止并恢复：

```bash
scripts/smoke-production.sh --recovery-check --confirm-production
```

回滚应用版本：

```bash
scripts/deploy-orgspace.sh --rollback <verified-commit> --confirm-production
scripts/smoke-production.sh
```

回滚只接受已存在的 OrgSpace release 目录，不修改 ECS 上其他 vhost、隧道或容器。

## PostgreSQL 备份与恢复演练

创建备份并只输出路径与摘要：

```bash
ssh aup-server 'set -eu
backup_root=/home/aup/tashan-orgspace/backups
install -d -m 700 "$backup_root"
backup_file="$backup_root/orgspace-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker exec tashan-orgspace-prod-postgres-1 pg_dump -U orgspace -d orgspace -Fc > "$backup_file"
chmod 600 "$backup_file"
sha256sum "$backup_file"'
```

恢复演练只使用固定临时数据库 `orgspace_restore_drill`，不得覆盖生产数据库：

```bash
ssh aup-server 'set -eu
backup_file=$(find /home/aup/tashan-orgspace/backups -maxdepth 1 -type f -name "orgspace-*.dump" -printf "%T@ %p\n" | sort -nr | head -1 | cut -d" " -f2-)
test -n "$backup_file"
docker exec tashan-orgspace-prod-postgres-1 dropdb -U orgspace --if-exists orgspace_restore_drill
docker exec tashan-orgspace-prod-postgres-1 createdb -U orgspace orgspace_restore_drill
docker exec -i tashan-orgspace-prod-postgres-1 pg_restore -U orgspace -d orgspace_restore_drill --exit-on-error < "$backup_file"
docker exec tashan-orgspace-prod-postgres-1 psql -U orgspace -d orgspace_restore_drill -Atc "select count(*) from schema_migrations"
docker exec tashan-orgspace-prod-postgres-1 dropdb -U orgspace orgspace_restore_drill'
```

备份命令、文件摘要、恢复测试结果和清理结果写入验证报告，但不得记录数据库密码、手机号或 token。

## 审计与发布证据

- 部署历史：`/home/aup/tashan-orgspace/deploy-history.log`
- 当前提交：`/home/aup/tashan-orgspace/.deployed-commit`
- 隧道日志：`/home/aup/tashan-orgspace/tunnel/autossh.log`
- 应用审计：PostgreSQL `audit_events`，通过受权的 `torg audit list` 查询
- 本地验证报告：`docs/verification/`

报告只记录提交 SHA、版本、时间、HTTP 状态、request ID 和脱敏结果，不记录 `.env.production` 内容、短信验证码、密码、完整手机号或 access/refresh token。
