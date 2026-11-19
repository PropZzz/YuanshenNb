# AGENT.md — AI 编码代理上下文与强制约束

> **适用范围**：本文件面向所有在本仓库中工作的 AI 编码代理（Coordinator / Subagent / Reviewer）。  
> **人类访客说明**：项目简介、产品价值与使用说明请见 [README.md](README.md)；详细工程规格见 [docs/README.md](docs/README.md)。

---

## 1. 当前项目状态与开发上下文

- **仓库阶段**：处于 **V2 全面重构期**（当前主力分支：`refactor/v2-rebuild`）。V1 历史代码已移出工作树，仅作为只读历史快照保留在 `main` 分支中。
- **当前已就绪资产**：仅包含项目目录骨架、PostgreSQL 初始迁移（[services/server/migrations/0001_init.sql](services/server/migrations/0001_init.sql)）、提炼自 V1 的 Web 视觉令牌与品牌资源（[apps/web/src/styles/tokens.css](apps/web/src/styles/tokens.css)、[apps/web/public/](apps/web/public/)）以及全套 V2 架构设计文档（[docs/](docs/README.md)）。
- **核心产品范围（Strict Scope）**：只围绕一条闭环建设：
  1. Android 穿戴设备生理采样（Health Connect / BLE GATT / 显式测试回放）；
  2. Go 服务端个人精力推理、深度专注保护与突发扰动可撤销救援；
  3. 基于成员隐私边界脱敏投影的团队协同排会黄金窗口求解。

---

## 2. 按任务必读文档索引（写代码前先读对应章节）

| 任务涉及领域 | 必读文档（相对路径） |
| --- | --- |
| 数据库 Schema、字段约束、区间查询 | [docs/01-domain-and-database.md](docs/01-domain-and-database.md)、[0001_init.sql](services/server/migrations/0001_init.sql) |
| 穿戴接入协议、精力电量公式、疲劳阈值 | [docs/02-wearable-energy-engine.md](docs/02-wearable-energy-engine.md) |
| 团队隐私脱敏、排会黄金窗口求解、个人救援 | [docs/03-team-scheduling-and-rescue.md](docs/03-team-scheduling-and-rescue.md) |
| REST API、RFC 9457 错误、WebSocket 推送 | [docs/04-api-and-realtime-contracts.md](docs/04-api-and-realtime-contracts.md) |
| Web / Android 模块划分、缓存、离线同步 | [docs/05-client-web-and-android.md](docs/05-client-web-and-android.md) |
| Web & Android 视觉规范、色彩、响应式布局 | [docs/06-design-system-v2.md](docs/06-design-system-v2.md)、[tokens.css](apps/web/src/styles/tokens.css) |
| 认证安全、隐私防线与自动化测试门禁 | [docs/07-security-testing-and-delivery.md](docs/07-security-testing-and-delivery.md) |
| 四人职责分工、目录写入边界与工具链 | [docs/08-team-division-and-workflow.md](docs/08-team-division-and-workflow.md) |

---

## 3. 技术栈与目录边界（禁止擅自变更选型）

| 模块 | 唯一技术栈 | 写入边界 |
| --- | --- | --- |
| **后端服务与引擎** | **Go 1.24+** · `Chi v5` + `Huma v2` · `pgx/v5` + `sqlc` + `goose` · **PostgreSQL 16** | `services/server/` |
| **Web 工作台** | **React 19 + TypeScript + Vite 6** · Tailwind CSS v4 + `shadcn/ui` · TanStack Query v5 + Zustand | `apps/web/` |
| **Android 端** | **Kotlin 2.x + Jetpack Compose (Material 3)** · Hilt · Health Connect SDK · BLE GATT (`0x180D`) · WorkManager · Room | `apps/android/` |
| **唯一接口契约** | OpenAPI 3.1 (`Huma v2` 导出 → `openapi-typescript` / Kotlin Generator) | `contracts/` |

---

## 4. 八条不可违反的工程红线（Hard Constraints）

1. **禁止范围蔓延（No Feature Creep）**：
   - 严禁重新引入已被 V2 砍掉的 V1 模块：微任务积分兑换系统、独立目标树拆解页、MCP 多应用爬虫页、裸蓝牙 GATT 读写调试页、`501` 占位路由。
   - 不要增加营销落地页（Landing Page），产品打开直接进入工作台/认证流。
2. **禁止在前端重复实现调度或精力算法**：
   - Web 与 Android **禁止**编写独立排程算法、团队冲突求解或精力分数计算逻辑；一切核心计算必须收口在 `services/server/internal/engine/`。
3. **契约先行（Contract-First），禁止手写漂移 DTO**：
   - 修改或新增后端接口必须通过 `Huma v2` 结构定义并导出更新 `contracts/openapi.json`，双端类型由生成脚本产出，禁止手动定义与服务端不一致的接口模型。
4. **物理时间统一，禁止 UI 耦合字段**：
   - 全部起止时间使用 UTC `TIMESTAMPTZ`（接口使用 RFC 3339）与整型 `duration_minutes`；严禁出现以像素高度换算时长、前端颜色整数直接入库等 V1 遗留反模式。
5. **团队生理隐私零泄漏**：
   - 团队视图及排会推荐接口**绝不允许**输出任何成员的原始心率、HRV、睡眠时长或超出其 `privacy_level` 允许范围的日程标题；应在 Go DTO 结构体层面做物理隔离。
6. **数据诚实性（No Fake Data）**：
   - 无穿戴数据时必须标注 `baseline_only`，回放测试样本必须标注 `replay_demo`，禁止把模拟/占位数据伪装成“手环实时数据”。
   - 禁止静默覆盖用户既有日程：个人救援与团队会议确认必须走“计算方案 → 用户显式确认 → 事务落库（带快照可撤销）”。
7. **禁止复刻 V1 静态 HTML/JS 屎山**：
   - 开发 Web 界面时可参考 [docs/06-design-system-v2.md](docs/06-design-system-v2.md) 或按需执行 `git show main:web/stitch/screens/<page>/index.html` 对照视觉排版，但**必须**用干净的 React 组件 + Tailwind v4 + `tokens.css` 实现，严禁搬运旧 `iframe` 壳或 `router.js` 模式。
8. **安全底线**：
   - 密码必须使用 **Argon2id**；Refresh Token 必须做 SHA-256 摘要入库并支持轮换重放检测（`family_id`）；对象级接口必须在 SQL 层强制校验当前 `user_id` 或 `workspace_members` 归属。

---

## 5. 代码质量与验证门禁

1. **修改对应端后必须通过相应检查，不得跳过或放宽断言伪造通过**：
   - **Go 服务端**：`go vet ./...`、`go test -race ./...`（集成测试使用真实 PostgreSQL，验证并发锁与 `tstzrange` 冲突）。
   - **Web 前端**：`npm run typecheck`、`npm run build`、`npm test`。
   - **Android 客户端**：`./gradlew testDebugUnitTest lintDebug`。
2. **文档与契约同步**：修改接口、表结构或核心规则时，必须同步更新 `docs/01..07` 对应章节与 `contracts/openapi.json`。
3. **禁止触碰归档文件**：根目录下保留的 [project_plan.docx](project_plan.docx) 为竞赛计划书原件，未得用户明确指令不得修改或删除。
