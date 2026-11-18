# 时序智配 V2 | Temporal Intelligence Scheduler

> **聚焦核心**：穿戴设备精力感知 × 个人精力保护 × 团队协同排会最优解

本分支（`refactor/v2-rebuild`）用于彻底重构项目架构，聚焦两个真正打通的高价值核心能力：
1. **个人级智能精力分配与保护**：由 Android 穿戴设备（Health Connect / BLE）持续采集心率、HRV 与睡眠数据，推导个人实时精力电量与 24h 节律曲线，保护深度专注窗口，并在突发打扰或疲劳过载时给出可解释、可撤销的日程重排方案。
2. **团队级协同排会与保护边界**：在严格保护成员生理隐私的前提下，将个人忙闲、深度专注保护期与认知负荷等级聚合为团队协同约束，为团队会议寻找对全员精力损耗最小、时间碎片最少的最优黄金窗口。

> 说明：V1 历史代码与文档完整保留在 `main` 分支（如需要对照旧版 Stitch HTML 或旧逻辑，可通过 `git show main:<path>` 随时查看）。

---

## 技术栈总览

| 模块 | 目录 | 核心技术选型 |
| --- | --- | --- |
| **后端 & 引擎** | `services/server` | **Go 1.24+** · `Chi` + `Huma v2` (OpenAPI 3.1) · `pgx/v5` + `sqlc` + `goose` · **PostgreSQL 16** |
| **Web 工作台** | `apps/web` | **React 19 + TypeScript + Vite 6** · Tailwind CSS v4 + `shadcn/ui` · TanStack Query v5 + Zustand |
| **Android 客户端** | `apps/android` | **Kotlin 2.x + Jetpack Compose (Material 3)** · Hilt · **Android Health Connect SDK** · BLE GATT (`0x180D`) · WorkManager |
| **唯一契约** | `contracts/` | 后端导出的 `openapi.json`，自动生成 Web TypeScript 与 Android Kotlin 客户端模型 |

---

## 目录结构

```text
Ruanchuang/
├── services/
│   └── server/                             # Go 服务端与 PostgreSQL 迁移脚本
├── apps/
│   ├── web/                                # React Web 前端（沿用并升级“时间地图”视觉体系）
│   └── android/                            # Kotlin Compose Android 客户端（含穿戴设备接入）
├── contracts/                              # OpenAPI 3.1 契约文件与生成说明
├── docs/
│   ├── README.md                           # V2 架构文档总览与分章索引
│   ├── 01-domain-and-database.md           # 领域模型与 PostgreSQL 设计
│   ├── 02-wearable-energy-engine.md        # 穿戴设备接入与精力模型
│   ├── 03-team-scheduling-and-rescue.md    # 团队协同排会与救援算法
│   ├── 04-api-and-realtime-contracts.md    # REST API 与 WebSocket 契约
│   ├── 05-client-web-and-android.md        # Web 与 Android 应用架构
│   ├── 06-design-system-v2.md              # Web & Android 视觉设计系统
│   └── 07-security-testing-and-delivery.md # 安全边界、测试验收与四人分工
├── docker-compose.yml                      # 本地 PostgreSQL 16 容器环境
└── project_plan.docx                       # 竞赛项目计划书（保留归档）
```

---

## 文档导航

- 架构文档总览与分章入口：[docs/README.md](docs/README.md)
- 服务端数据库初始迁移：[services/server/migrations/0001_init.sql](services/server/migrations/0001_init.sql)
