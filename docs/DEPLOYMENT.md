# 服务器部署

下方地址均为示例。实际服务器地址、SSH 端口和登录信息应保存在仓库之外。

GitHub 项目名为 `work-studio`。线上保留既有 `creation-studio` Compose 名称和目录，避免影响现有数据挂载、Nginx 入口及定时备份。

- 网站：<http://your-server.example>
- 管理后台：<http://your-server.example/admin>
- SSH：`root@your-server.example`，端口 `YOUR_SSH_PORT`；网站使用 HTTP 80 端口。
- 服务目录：`/opt/creation-studio`
- Compose 项目 / 服务：`creation-studio` / `app`
- 应用监听：`127.0.0.1:3180`，由现有 Nginx 转发。
- 数据：`/opt/creation-studio/data/app.db`、`data/uploads/`。
- 配置：`/opt/creation-studio/.env`，权限 600。不要重新生成 APP_SECRET。
- 本地管理员信息：`.deploy/admin-access.txt`，权限 600，未纳入源码或最终镜像。

只替换现有 Nginx IP server 的根路径配置，保留其他域名和 `/sub/`。原配置备份为 `/etc/nginx/backups/game-arcade-20261101T110901Z.conf`；新增 snippet 为 `/etc/nginx/snippets/creation-studio-ip.conf`。

## 运维命令

```sh
cd /opt/creation-studio
docker compose ps
docker compose logs --tail=100 app
curl -f http://127.0.0.1:3180/healthz
docker compose exec -T app node scripts/backup.mjs
```

定时备份由 `creation-studio-backup.timer` 每天 03:17 UTC 触发，停机错过的任务在恢复后补跑。快照保存在 `data/backups/`，保留最近 14 份；仅覆盖数据库。上传文件和 `.env` 应另行备份到安全位置。

```sh
systemctl list-timers creation-studio-backup.timer
journalctl -u creation-studio-backup.service --no-pager -n 30
```

更新时保留 `.env` 与 `data/`，传入源码后运行 `docker compose up -d --build`。不要同步本地测试库、`node_modules`、截图和 `.deploy`。

本次首页素材升级需在新容器中执行 `docker compose exec -T app node apps/server/dist/db-cli.js showcase`，为仍使用初始占位内容的记录补图。升级前的数据库、源码和旧镜像保存在 `/opt/creation-studio-releases/`；已有管理员、渠道、模型与账务数据继续使用原数据库。

数据库恢复：停止 app，先保存当前数据库及 WAL/SHM 副本；将选定备份替换为 `data/app.db`，清理与旧库对应的 `app.db-wal` 和 `app.db-shm`，确认文件归属 `1000:1000`，再启动并检查 `/healthz`。恢复数据库可能回退期间业务记录，操作前需明确恢复时间点。

当前入口为 HTTP；尚未配置 TLS。后续绑定域名/证书时同步更新 PUBLIC_BASE_URL。上游密钥接入步骤见根目录 README。
