# Go 服务端

提供 32 个真实 REST 操作、一次性票据 WebSocket、个人精力推理、可撤销救援和团队排会。运行时由 `cmd/api/runtime.go` 装配 PostgreSQL 服务和纯函数引擎，不使用占位 Handler。

技术栈为 Go 1.24+、Chi v5、Huma v2、pgx/v5、PostgreSQL 16。数据库迁移采用 goose 格式；`internal/db/queries/core.sql` 保留 sqlc 查询契约，当前业务服务通过参数化 pgx SQL 执行事务。

## 首次启动

以下命令使用 PowerShell。先在仓库根目录启动 PostgreSQL，或准备自己已有的 PostgreSQL 16 实例：

```powershell
docker compose up -d postgres
```

进入 `services/server`，将 Go 放入 `PATH`。本工作区自带的 Go 可按下面方式启用；已安装 Go 的机器可跳过这一行：

```powershell
$env:Path = (Resolve-Path ..\..\.appdata\toolchains\go\bin).Path + ';' + $env:Path
go version
go mod download
```

应用只读取**进程环境变量**，不会自动加载根目录 `.env`。可以参考 `.env.example` 设置变量，或直接使用与 Compose 一致的开发配置：

```powershell
$env:APP_ENV = 'development'
$env:SERVER_ADDR = ':8080'
$env:DATABASE_URL = 'postgres://shixu:shixu_dev_password@127.0.0.1:5432/shixu_v2?sslmode=disable'
$env:JWT_SECRET = 'local-development-secret-at-least-32-bytes'
$env:COOKIE_SECURE = 'false'
$env:CORS_ALLOWED_ORIGINS = 'http://localhost:5173'
```

对**新建、空白数据库**先执行迁移。可以使用已有 goose；若尚未安装，可按仓库工具版本安装后执行：

```powershell
$env:CGO_ENABLED = '0'
go install github.com/pressly/goose/v3/cmd/goose@v3.30.1
$goose = Join-Path (go env GOPATH) 'bin\goose.exe'
& $goose -dir migrations postgres $env:DATABASE_URL up
```

必须依次包含 `0001_init.sql` 与 `0002_ws_tickets.sql`。后者创建数据库共享的一次性握手票据表；没有该表，REST 票据签发会失败。不要直接用 `psql -f` 执行完整迁移文件，因为文件内同时包含 Up 和 Down 段。服务启动时不会自动建表或清理数据。

```powershell
go run ./cmd/api
```

另开终端检查 `http://localhost:8080/api/v1/health`。正常响应包含 `ok: true` 与 `dbStatus: "up"`。默认监听 8080，Web 开发代理指向该端口；Android 模拟器使用 `http://10.0.2.2:8080/`。

### 本工作区现有本机数据库

本次联调使用的 PostgreSQL 在 `127.0.0.1:55432`，与 Compose 的 5432 分开。现有开发库已经执行上述两份迁移，使用它时直接设置连接并启动，**不要删除、重建或重复执行原始迁移 SQL**：

```powershell
$env:DATABASE_URL = 'postgres://shixu@127.0.0.1:55432/shixu_v2_dev?sslmode=disable'
go run ./cmd/api
```

这条无密码连接仅用于本机联调环境，不是生产配置。

## 测试与质量门禁

集成测试**只读取 `TEST_DATABASE_URL`**。缺失该变量时会明确跳过 PostgreSQL 测试，因此未设置时的普通 `go test` 不能证明并发事务通过。

准备独立测试库（例如 `shixu_v2_test`），为测试用户授予建 schema 以及安装 `pgcrypto`、`btree_gist` 扩展的权限。测试为每个用例建立随机 `test_<uuid>` schema，执行全部迁移并在结束时仅删除该 schema；不依赖或清空开发库业务表。

```powershell
# 当前工作区已经有独立测试库；其他机器改为自己的测试 DSN。
$env:TEST_DATABASE_URL = 'postgres://shixu@127.0.0.1:55432/shixu_v2_test?sslmode=disable'
go vet ./...
go test -count=1 ./...
```

Linux/macOS 且 C 编译器可用时执行 `go test -race -count=1 ./...`。Windows 11 的 race 检查需启用 CGO、配置 GCC 并使用外部链接；本机已验证配置如下，其他机器应替换 GCC 路径：

```powershell
$env:CGO_ENABLED = '1'
$env:CC = 'G:\study\c.C++\Dev_C_v6.3\Dev-Cpp\TDM-GCC-64\bin\gcc.exe'
$env:Path = (Split-Path $env:CC) + ';' + $env:Path
go vet ./...
go test -race '-ldflags=-linkmode=external' -count=1 ./...
```

数据库门禁包含 32 个 HTTP 操作的成功路径、28 个受保护操作的未登录拒绝、Refresh Token 轮换重放与跨用户注销隔离、空日历并发锁、半开时间区间、救援幂等/防篡改/撤销冲突、同时间戳分页、DST 自然日、团队隐私投影、样本去重及来源标签、WebSocket 单次票据和提交后事件投递。

## 契约与目录

```text
cmd/api/                 HTTP 启动、依赖装配、全操作集成测试
cmd/export-openapi/      Huma 契约导出
internal/api/            固定 DTO、枚举、错误、WS 事件和路由
internal/apiadapter/     DTO 与业务服务转换、提交后事件发布
internal/auth/           Argon2id、JWT、摘要 Refresh Token 与令牌家族轮换
internal/biometrics/     来源标注、批量幂等写入、精力持久化与显式回放
internal/engine/         无数据库、无客户端依赖的纯函数引擎
internal/schedule/       用户隔离日程、48h 救援事务与快照撤销
internal/workspace/      成员隐私、推荐、用户按序行锁与会议回执
internal/realtime/       摘要票据、Origin 校验、7 类下行事件
internal/testutil/       真实 PostgreSQL 的独立 schema 测试支持
migrations/             0001 初始表、0002 ws_tickets
```

修改 API DTO/枚举/路由后，按团队约定导出并更新双端生成类型：

```powershell
go run ./cmd/export-openapi -out ../../contracts/openapi.json
```

## 部署边界

- 生产环境必须覆盖至少 32 字节的 `JWT_SECRET`，通过 HTTPS 提供服务，设 `COOKIE_SECURE=true`，配置精确的 `CORS_ALLOWED_ORIGINS`，并使用适当的 PostgreSQL TLS/凭证配置。
- 默认 Access Token 15 分钟、Refresh Token 14 天、WS Ticket 30 秒；票据只保存 SHA-256 摘要并以 `DELETE ... RETURNING` 原子消费。WS 每 30 秒发送 Ping，10 秒内没有匹配 Pong 即断开。
- 当前 WS 客户端集合和事件广播位于单 API 进程内。数据库票据支持跨实例消费，但横向扩展实时事件投递仍需共享发布订阅通道；当前演示按单 API 实例部署。
- 每连接事件队列为 32 条，慢客户端可能丢弃队列满时的事件。客户端重连后必须重新拉取精力与可见日程，实时事件不作为持久化事实来源。
- 回放必须显式调用并始终标为 `replay_demo`；无可用穿戴数据时返回 `baseline_only`。真实设备采集效果仍需 Android 真机和硬件联调验证。
