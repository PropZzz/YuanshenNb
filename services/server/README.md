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
│   ├── config/              # 环境变量与服务配置
│   ├── db/                  # sqlc 生成代码与连接池
│   ├── auth/                # 登录/注册/Token 中间件
│   ├── biometrics/          # Health Connect / BLE / Replay 样本批量入库
│   ├── engine/              # 核心算法（精力曲线模型、协同黄金窗口求解、个人救援重排）
│   ├── schedule/            # 个人日程 CRUD 与冲突查询
│   ├── workspace/           # 团队 Workspaces、隐私边界、会议提案与事务确认
│   └── realtime/            # WebSocket / SSE 团队变更推送中心
├── migrations/
│   └── 0001_init.sql        # PostgreSQL 16 初始表结构
└── sqlc.yaml                # sqlc 代码生成配置
```

## 初始化前提

1. 安装 [Go 1.24+](https://go.dev/dl/)、`sqlc` 与 `goose`：
   ```powershell
   go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
   go install github.com/pressly/goose/v3/cmd/goose@latest
   ```
2. 启动本地 PostgreSQL：
   ```powershell
   docker compose up -d
   ```
