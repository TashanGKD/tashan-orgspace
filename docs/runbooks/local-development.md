# 本地开发基础设施

Phase 0 的 PostgreSQL 和 Redis 只发布到本机 loopback 地址，不允许作为公网或局域网服务使用。

## 启动

先为本机数据库设置一个仅用于本地开发的密码：

```bash
export ORGSPACE_LOCAL_POSTGRES_PASSWORD='replace-with-a-local-random-password'
docker compose -f deploy/compose.local.yml up -d --wait
```

本地连接地址为：

- PostgreSQL：`127.0.0.1:55432`
- Redis：`127.0.0.1:56379`

应用的 `DATABASE_URL` 应使用刚刚设置的本地密码；不要把密码写入 `.env.example` 或提交到 Git。

## 检查与停止

```bash
pnpm --filter @tashan/testkit test
docker compose -f deploy/compose.local.yml ps
docker compose -f deploy/compose.local.yml down
```

普通 `down` 会停止并移除容器，但保留 `postgres-data` 和 `redis-data` 命名卷，数据不会被删除。

## 破坏性清理

`docker compose -f deploy/compose.local.yml down -v` 会永久删除两个命名卷及其中的本地数据。只有在明确确认不再需要这些数据后，才可以手动执行；任何脚本都不得默认加上 `-v`。
