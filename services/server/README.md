# `services/server` — Go 后端与核心调度/精力引擎

## 技术栈

- **语言**：Go 1.24+
- **HTTP & OpenAPI**：`go-chi/chi/v5` + `danielgtaylor/huma/v2`（自动生成 `contracts/openapi.json`）
- **数据库访问**：PostgreSQL 16 + `jackc/pgx/v5` + `sqlc` + `pressly/goose`
- **认证**：Argon2id 密码哈希 + JWT Access Token + 可吊销 Refresh Token

## 建议目录布局

```text
services/server/
├── cmd/
│   ├── api/                 # 主服务入口
│   └── export-openapi/      # 导出 contracts/openapi.json 的 CLI
├── internal/
│   ├── api/                 # Huma v2 DTO 契约与路由注册（contracts.go）
│   ├── config/              # 环境变量与服务配置
│   ├── db/
│   │   └── queries/         # sqlc SQL 查询契约（core.sql）与生成代码
│   ├── auth/                # 登录/注册/Argon2id/双端 Refresh Token 中间件
│   ├── biometrics/          # Health Connect / BLE / Replay 样本批量入库
│   ├── engine/              # P2 独家领地：纯函数算法（contracts.go 锁定 P1↔P2 边界）
│   ├── schedule/            # 个人日程 CRUD、48h 基线乐观锁与救援事务
│   ├── workspace/           # 团队 Workspaces、隐私投影、会议提案与按序加锁事务
│   └── realtime/            # WebSocket 票据鉴权与 7 类下行事件广播中心
├── migrations/
│   └── 0001_init.sql        # PostgreSQL 16 初始表结构
├── go.mod
└── sqlc.yaml                # sqlc 代码生成配置
```

## 初始化前提

1. **安装工具链（Windows 本机已预装至 `D:\DevTools\` 并写入用户环境变量）**：
   - `Go 1.27.4`（`D:\DevTools\go`）、`sqlc v1.31.1`、`goose v3.30.1`（`D:\DevTools\gopath\bin`）
   - `PostgreSQL 16.16` 绿色版（`D:\DevTools\pgsql16`，数据目录 `D:\DevTools\pgdata16`）
   - 如需在全新机器重装 `sqlc` / `goose`（Windows MinGW 8.1 下推荐 `CGO_ENABLED=0`）：
     ```powershell
     $env:CGO_ENABLED="0"
     go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
     go install github.com/pressly/goose/v3/cmd/goose@latest
     ```
2. **启动本地 PostgreSQL 16**（Docker 或本机绿色版二选一）：
   ```powershell
   # 方式 A：Docker Compose
   docker compose up -d

   # 方式 B：D 盘本地 PostgreSQL 16 绿色版
   pg_ctl -D D:\DevTools\pgdata16 -l D:\DevTools\pgsql16\postgres.log start
   ```
3. **常用验证命令**：
   ```powershell
   sqlc generate
   go vet ./...
   go test -v ./...
   # Windows 11 Build 26100+ 启用 -race 需使用外部链接模式以正确解析 api-ms-win-core-synch-l1-2-0.dll
   go test -race -ldflags="-linkmode=external" ./...
   go run ./cmd/export-openapi -out ../../contracts/openapi.json
   ```
