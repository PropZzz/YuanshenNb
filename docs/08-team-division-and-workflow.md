# 08 · 四人团队协作分工与并行交付清单

> **适用分支**：`refactor/v2-rebuild`  
> **团队角色**：`P1` Go 服务端基座与数据库 / `P2` Go 核心算法引擎与全链路验收 / `P3` React Web 工作台 / `P4` Android 与穿戴采集  
> **关联文档**：[01-domain-and-database.md](01-domain-and-database.md)、[02-wearable-energy-engine.md](02-wearable-energy-engine.md)、[03-team-scheduling-and-rescue.md](03-team-scheduling-and-rescue.md)、[04-api-and-realtime-contracts.md](04-api-and-realtime-contracts.md)、[06-design-system-v2.md](06-design-system-v2.md)、[07-security-testing-and-delivery.md](07-security-testing-and-delivery.md)

---

## 1. 四人分工总览

| 角色 | 职责定位与技术栈 | 独占写入目录 | 核心交付物 | 上下游对接点 |
| --- | --- | --- | --- | --- |
| **P1** | **Go 服务端基座与数据库**<br>Go / Chi / Huma v2 / sqlc / PG 16 | `services/server/internal/{auth,config,db,biometrics,schedule,workspace,realtime,api}/`<br>`services/server/cmd/`、`services/server/migrations/`、[contracts/openapi.json](../contracts/openapi.json) | 认证与令牌轮换、REST Handler、行锁并发事务、WebSocket Hub、OpenAPI 导出与 PG 集成测试 | 上游调用 P2 实现的 `engine` 接口；下游向 P3/P4 提供 `openapi.json` 与后端服务实例 |
| **P2** | **Go 核心算法引擎与全链路联调验收**<br>纯 Go 算法 / 表格驱动单测 / 联调压测 | `services/server/internal/engine/`<br>联调 E2E 验收脚本与演示样本参数 | `EnergyEngine`、`TeamPlannerEngine`、`RescueEngine`、黄金测试向量、`replay_demo` 样本校准与并发验收 | 向 P1 交付纯函数引擎实现；联调阶段串联 P1 + P3 + P4 全链路验证 |
| **P3** | **React Web 工作台前端**<br>React 19 / TS / Vite / Tailwind v4 / TanStack Query | `apps/web/` | 认证流、`/focus`、`/energy`、`/calendar`（时间地图 + 三策略救援抽屉）、`/team`（脱敏网格 + 排会向导）、WS 刷新与响应式测试 | 消费 [contracts/openapi.json](../contracts/openapi.json) 生成 [schema.d.ts](../apps/web/src/api/schema.d.ts)；联调 P1 接口与 WS |
| **P4** | **Android 客户端与穿戴采集**<br>Kotlin / Compose / Hilt / Health Connect / BLE / Room | `apps/android/` | 加密令牌存储、Room 离线库、Health Connect + BLE `0x180D` 采集、移动业务页、WS 推送与闹钟联动 | 消费 [contracts/openapi.json](../contracts/openapi.json) 生成 Kotlin 客户端模型；为 P1/P3 提供真实生理数据流 |

---

## 2. 各角色详细职责与交付清单

### 2.1 P1 · 服务端基座、数据库与实时协同

- **独占写入目录**：
  - `services/server/internal/{auth,config,db,biometrics,schedule,workspace,realtime,api}/`
  - `services/server/cmd/`、`services/server/migrations/`、`contracts/openapi.json`
- **交付清单**：
  1. **认证与安全中间件**：
     - 实现 [routes.go](../services/server/internal/api/routes.go) 中的 `AuthHandlers`（注册、Argon2id 登录、Web Cookie + Android Body 双轨 Refresh Token 轮换、`family_id` 重放检测与整族吊销、注销、`/auth/me`、30 秒一次性 WS 票据）；
     - 实现并挂载 `RouteOptions.AuthMiddleware` 至 `protectedGroup`。
  2. **数据库迁移、查询与并发事务**：
     - 维护 `services/server/migrations/` 与 [core.sql](../services/server/internal/db/queries/core.sql)（`sqlc` 生成）；
     - 使用 [tx.go](../services/server/internal/db/tx.go) 的 `PGXStore.WithTx` / `TxManager` 封装事务；
     - 在团队会议确认与个人日程救援 `apply`/`undo` 中严格按 `LockUsersForScheduling` 升序加锁，并执行 `tstzrange` 冲突复检。
  3. **业务 Handler 与显式 DTO 映射**：
     - 实现 `SystemHandlers`、`BiometricsHandlers`、`EnergyHandlers`、`ScheduleHandlers`、`WorkspacesHandlers`；
     - 在 `services/server/cmd/api/main.go` 装配 `api.RouteHandlers`，并通过 [mapper.go](../services/server/internal/api/mapper.go) 完成 `api` DTO 与 `engine` 结构体之间的显式映射。
  4. **WebSocket Hub**：
     - 实现 `/api/v1/ws` 票据握手、30 秒 Ping/Pong 心跳与断线清理；
     - 基于 [ws.go](../services/server/internal/api/ws.go) 的 `WsEnvelope` / `NewWsEnvelope` 在精力重算与日程/会议变更后精准投递 7 类实时事件。
  5. **PostgreSQL 真实集成测试**：
     - 验证 `tstzrange` 冲突拦截、并发抢占同一时段必有一成功一 `409 CONFLICT_MEMBER_BUSY`、Refresh Token 重放触发整族吊销。
- **验收标准**：
  - `contracts/openapi.json` 与代码实现零漂移；
  - `go vet ./...` 与 `go test -race -ldflags="-linkmode=external" -count=1 ./...`（含 PG 集成测试）全绿通过。

---

### 2.2 P2 · 核心算法引擎与全链路联调验收

- **独占写入目录**：
  - `services/server/internal/engine/`
  - 联调验收阶段的端到端核验脚本与 `replay_demo` 样本调参
- **交付清单**：
  1. **个人精力推理引擎（实现 [contracts.go](../services/server/internal/engine/contracts.go) 中的 `EnergyEngine`）**：
     - 实现四因子精力公式 $E(t) = \operatorname{clamp}(0, 100, S_{\text{sleep}} + S_{\text{autonomic}} + C_{\text{circadian}}(t) - D_{\text{load}}(t) + R_{\text{buffer}}(t))$；
     - 计算近 14 日滑动 HRV/RHR 基线（输出 `UpdatedHRVBaseline`、`UpdatedRHRBaseline` 交由 P1 落库）；
     - 依据 `LocalDayWindowUTC` 生成本地自然日整点曲线 `HourlyCurve`（正确处理 DST 23/25 小时边界）；
     - 输出 `DataFreshness`（`live_wearable` / `recent_wearable` / `replay_demo` / `baseline_only`）、推荐 `FocusShields` 与 `OverloadAlert`。
  2. **团队隐私投影与黄金窗口求解器（实现 `TeamPlannerEngine`）**：
     - `ProjectAvailability`：基于不含生理基线的 `WorkScheduleProfile` 与日程，按 `busy_only` / `energy_tier` / `full_title` 输出脱敏后的 `AvailabilitySlot` 与 `PrivacyEnergyBucket`（不泄露精确精力分数）；
     - `RecommendWindows`：以 15 分钟离散步长计算跨时区工作交集并过滤硬冲突，按五目标评分输出 `Recommendations`；无可用窗口时返回精确 `BlockingDiagnostics`。
  3. **个人日程救援引擎（实现 `RescueEngine`）**：
     - 严格锁定 `hard_locked` 个人块与已确认 `meeting`，禁止移动或篡改；
     - 为 `protect_deadline`、`protect_recovery`、`minimize_changes` 输出确定性调整方案、`optionHash` 与结构化 `diffItems`，保证同一 `RescueSolverInput` 下预览与 `apply` 服务端重算结果 100% 一致。
  4. **黄金测试向量与全链路联调验收**：
     - 为三大引擎编写表格驱动单元测试（正常睡眠、熬夜降级、低 HRV 过载、无穿戴 `baseline_only` 降级、跨时区无交集、DST 切换、并发基线输入）；
     - 联调期牵头校准三套 `replay_demo` 演示样本（`well_rested`、`sleep_deprived`、`high_stress`），主导串通 `Android 上报 -> 服务端重算 -> Web WS 刷新 -> 团队排会 -> 突发救援 -> 撤销` 全链路演示验收。
- **验收标准**：
  - `services/server/internal/engine/` 严禁引入 `pgx`、`net/http` 或 `Huma`；
  - `go test -v -race ./internal/engine/...` 零竞态全绿；全链路联调演示剧本一次走通。

---

### 2.3 P3 · Web 工作台前端

- **独占写入目录**：
  - `apps/web/`
- **交付清单**：
  1. **认证流与实时刷新闭环**：
     - 基于 [client.ts](../apps/web/src/api/client.ts)（单飞 `401` Cookie 刷新与 `explode: false` 数组序列化）、[query-keys.ts](../apps/web/src/api/query-keys.ts)、[ws.ts](../apps/web/src/api/ws.ts) 与 [auth-store.ts](../apps/web/src/stores/auth-store.ts)，完成 `/login`、`/register` 页面与首屏静默刷新启动流；
     - 接入 WebSocket 7 类事件，按 Query Key 精准失效并刷新对应视图。
  2. **今日专注与精力洞察（`/focus`、`/energy`）**：
     - 实现专注计时器与精力保护态提示、24 小时精力预测曲线、四因子正负贡献拆解与穿戴来源新鲜度徽标（区分 `live_wearable`、`recent_wearable`、`replay_demo`、`baseline_only`）。
  3. **时间地图日历与三策略救援控制台（`/calendar`）**：
     - 将服务端 UTC 时间戳按用户本地时区投影至日/周视图，实现重叠时间块分栏算法、左侧精力热区色带与日程 CRUD；
     - 接入突发任务/过载触发的救援三策略对比抽屉（展示 `movedCount`、`deferredCount`、`recoveryMinutes`、`overdueRiskCount` 与一键应用/撤销）。
  4. **团队协同排会主控台（`/team`）**：
     - 实现工作区创建/加入与成员隐私设置；
     - 展示脱敏后多成员并排网格与整点 `energyBuckets`、发起排会查看 Top 3 黄金窗口评分拆解与无解 `blockingDiagnostics`，并在遇到 `409 CONFLICT_MEMBER_BUSY` 时提示并自动刷新候选窗口。
  5. **视觉规范与质量回归**：
     - 按 [06-design-system-v2.md](06-design-system-v2.md) 与 `tokens.css` 实现浅/深色双主题；
     - 覆盖 `390px` 移动端与 `1440px` 桌面端零横向溢出核查及 MSW + Vitest 测试。
- **验收标准**：
  - 所有接口类型均由 `npm run gen:api` 生成，无手写漂移 DTO；
  - `npm run typecheck && npm run build && npm test` 全绿通过。

---

### 2.4 P4 · Android 客户端与穿戴采集

- **独占写入目录**：
  - `apps/android/`
- **交付清单**：
  1. **安全凭证与 Room 离线持久化**：
     - 基于网络骨架（[ShixuJson.kt](../apps/android/app/src/main/kotlin/app/shixu/core/network/ShixuJson.kt)、[TokenStore.kt](../apps/android/app/src/main/kotlin/app/shixu/core/network/TokenStore.kt)、[TokenAuthenticator.kt](../apps/android/app/src/main/kotlin/app/shixu/core/network/TokenAuthenticator.kt)、[NetworkModule.kt](../apps/android/app/src/main/kotlin/app/shixu/core/network/di/NetworkModule.kt)），将 `InMemoryTokenStore` 替换为基于 Android Keystore + EncryptedDataStore 的持久化实现；
     - 建设 Room 离线库（`pending_biometrics` 待补传幂等队列 + 今日只读日程快照）。
  2. **Health Connect 生产同步通道（`core/health/`）**：
     - 申请最小必要生理权限（心率、HRV RMSSD、静息心率、睡眠分期、活动热量）；
     - 支持首次 14 天历史基线拉取、`ChangesToken` 增量同步、`WorkManager` 15 分钟周期任务 + 前台主动触发、Token 失效 48 小时兜底回拉及部分权限拒绝优雅降级。
  3. **BLE GATT 实时心率通道（`core/ble/`）**：
     - 实现标准心率服务 `0x180D` / 特征 `0x2A37` 字节流解析（`uint8`/`uint16` HR 与 RR 间期提取）；
     - 实现 >25% 跳变伪影剔除、60 秒滑窗 RMSSD 计算与确定性幂等键 `ble:{deviceHash}:{metricType}:{epochSec}` 生成。
  4. **移动端业务屏、实时推送与本地闹钟联动**：
     - 实现 `/focus`、`/calendar`（含救援确认 BottomSheet）、`/team`（会议邀请确认/拒绝回执）、`/energy`（采集状态与回放控制）、`/settings`（隐私颗粒度与同步诊断）；
     - 接入 `WsEventParser`（[WsEvent.kt](../apps/android/app/src/main/kotlin/app/shixu/core/network/WsEvent.kt)）与 `AlarmManager`，在收到 `schedule.updated`、`workspace.meeting_confirmed`、`workspace.meeting_cancelled` 时自动更新本地提前提醒闹钟。
- **验收标准**：
  - 断网采集进入 Room 队列并在网络恢复后按原 `idempotency_key` 无重复补传；
  - `.\gradlew.bat testDebugUnitTest lintDebug` 全绿通过。

---

## 3. 物理接口锁与契约同步规则

```text
                ┌────────────────────────────────────────────────────────┐
                │   锁 ①：services/server/internal/engine/contracts.go   │
                │   (EnergyEngine / TeamPlannerEngine / RescueEngine)    │
                └──────────────┬───────────────────────────┬─────────────┘
                               │ 调用纯函数                 │ 实现纯函数
                               ▼                           ▼
                     [P1 服务端基座]                  [P2 核心算法引擎]
                     auth / db / api                  energy / team_planner / rescue
                     schedule / workspace             + 黄金单测 + 联调验收
                               │
                               │ Huma v2 自动导出
                               ▼
                ┌────────────────────────────────────────────────────────┐
                │            锁 ②：contracts/openapi.json                │
                │   (REST 端点 + 共享枚举 + WsEnvelope 7 类实时事件)      │
                └──────────────┬───────────────────────────┬─────────────┘
                               │ openapi-typescript        │ OpenAPI Generator 7.27.0
                               ▼                           ▼
                        [P3 Web 工作台]              [P4 Android + 穿戴]
```

### 契约变更同步规则
1. **REST 接口 / 枚举 / 错误码变更**：只能由 P1 修改 `services/server/internal/api/` 后在 `services/server/` 执行导出命令，再提交 [contracts/openapi.json](../contracts/openapi.json)：
   ```powershell
   cd services/server
   go run ./cmd/export-openapi -out ../../contracts/openapi.json
   ```
2. **双端强类型同步**：[contracts/openapi.json](../contracts/openapi.json) 合入 `refactor/v2-rebuild` 后，双端必须立即执行代码生成（禁止手写漂移 DTO）：
   - **P3 Web**：`cd apps/web && npm run gen:api`（刷新 [schema.d.ts](../apps/web/src/api/schema.d.ts)）
   - **P4 Android**：`powershell -ExecutionPolicy Bypass -File apps/android/scripts/gen-api.ps1`
3. **算法接口与 WS 事件变更**：
   - 修改 [services/server/internal/engine/contracts.go](../services/server/internal/engine/contracts.go) 必须由 **P1 + P2 联合评审**后提交；
   - 修改 WS 事件类型或 Payload 结构必须同步更新 [04-api-and-realtime-contracts.md](04-api-and-realtime-contracts.md) 与 [ws.go](../services/server/internal/api/ws.go)。

---

## 4. 分阶段并行里程碑（Sprint 1–4）

| 阶段 | P1（服务端基座） | P2（算法引擎 + 验收） | P3（Web 工作台） | P4（Android + 穿戴） | 合流验收标准 |
| --- | --- | --- | --- | --- | --- |
| **Sprint 1**<br>基座与主干闭环 | 认证与双轨令牌轮换、用户档案、个人日程 CRUD | `EnergyEngine` 四因子模型与 DST 曲线单测 | 登录/注册流、`AppShell`、`/calendar` 日程基础 CRUD 与时区投影 | Keystore 令牌存储、Room 库基础表、登录与今日日程列表 | Web 与 Android 可登录同一账号并互通个人日程 CRUD |
| **Sprint 2**<br>穿戴与个人救援 | 穿戴批量幂等入库、`replay-seed`、救援 `options`/`apply`/`undo` 事务 | `RescueEngine` 三策略确定性求解与黄金测试向量 | `/energy` 四因子拆解与新鲜度徽标、`/calendar` 救援对比抽屉 | Health Connect 14 天首拉 + 15m Worker、BLE `0x2A37` 解析、救援 BottomSheet | 手机上报或回放样本 → 后端重算精力 → Web 展示曲线并可应用/撤销三策略救援 |
| **Sprint 3**<br>团队协同与实时推送 | 工作区、成员隐私接口、按序加锁会议确认事务、WS Hub 7 事件 | `TeamPlannerEngine` 脱敏投影、五目标求解与阻断诊断 | `/team` 脱敏网格、Top 3 黄金窗口排会向导、WS 精准失效刷新 | 团队会议邀请确认/拒绝、过载通知、`WsEventParser` + `AlarmManager` 闹钟 | Web 确认团队会议 → Android 秒级收到推送与闹钟对齐；成员拒绝后自动释放区间 |
| **Sprint 4**<br>并发压测与答辩收口 | 边界状态码收敛、SQL 性能排查、生产安全配置检查 | `-race` 并发抢占压测、3 套 `replay_demo` 样本调参、全链路 E2E 验收 | `390px`/`1440px` 响应式与浅/深色巡检、MSW/Vitest 回归 | 真机穿戴长稳联调、断网 Room 补传验证、Debug/Release 包打样 | 三端 CI 门禁全绿 + 真机演示与 `replay_demo` 兜底演练一次通过 |

---

## 5. Git 分支规范与 PR 四连门禁

1. **分支命名**：每人基于 `refactor/v2-rebuild` 拉取个人特性分支（如 `feat/p1-auth-schedule`、`feat/p2-energy-engine`、`feat/p3-calendar-ui`、`feat/p4-health-connect`），按模块小步提交 PR 合回 `refactor/v2-rebuild`。
2. **目录修改边界**：未与模块负责人确认前，禁止跨边界直接修改他人独占目录；禁止修改根目录归档文件 [project_plan.docx](../project_plan.docx)。
3. **PR 合并四连门禁**：
   - **契约一致性**：后端改动路由/DTO/枚举后，已同步提交 [contracts/openapi.json](../contracts/openapi.json) 及双端生成产物；
   - **Go 服务端**（Windows 11 跑 `-race` 需配 GCC）：
     ```powershell
     cd services/server
     go vet ./...
     go test -race -ldflags="-linkmode=external" -count=1 ./...
     ```
     > P2 未启动本地 PostgreSQL 时可先执行 `go test -v -race -ldflags="-linkmode=external" ./internal/engine/...`，合入前必须通过全仓含 PG 的集成测试。
   - **Web 前端**：
     ```powershell
     cd apps/web
     npm run typecheck && npm run build && npm test
     ```
   - **Android 客户端**：
     ```powershell
     cd apps/android
     .\gradlew.bat testDebugUnitTest lintDebug
     ```

---

## 6. 开发环境与工具链版本清单（按角色分工）

| 角色 / 适用范围 | 必备工具与版本基线 | 环境配置与验证命令 |
| --- | --- | --- |
| **全员通用** | • **Git**（Windows 建议开启长路径与 LF/CRLF 统一）<br>• **Node.js `>= 20`**（实测 `v24.15.0` / `npm 11.12.1`） | P3 开发必需；P4 执行 [gen-api.ps1](../apps/android/scripts/gen-api.ps1) 拉起 `openapi-generator-cli` 使用 |
| **P1 服务端基座与 DB** | • **Go `>= 1.24`**（实测 `1.27.4`）<br>• **PostgreSQL `16`**（Docker Compose 或绿色版 `16.16`）<br>• **sqlc `v1.31.1`**<br>• **goose `v3.30.1`** | 复制 [.env.example](../.env.example) 为 `.env`；Windows MinGW 8.1 安装 `sqlc` 需设 `$env:CGO_ENABLED="0"`。验证：`goose up`、`sqlc generate`、`go vet ./...`、`go test ./...` |
| **P2 算法求解引擎** | • **Go `>= 1.24`**（实测 `1.27.4`） | 仅需 Go 工具链（无需本地安装 PG 或 Android SDK），在 `services/server/` 验证：`go test -v ./internal/engine/...`（Windows `-race` 需配 GCC 并附加 `-ldflags="-linkmode=external"`） |
| **P3 Web 工作台** | • **Node.js `>= 20`**<br>• **Vite `6.4.6`** + **React `19.1`** + **TypeScript `5.8`**<br>• **Tailwind CSS `v4.1`**<br>• **openapi-typescript `7.13.0`** + **Vitest `3.2.7`** | 在 `apps/web/` 执行 `npm install && npm run gen:api && npm run dev`（默认通过 `VITE_API_PROXY_TARGET` 同源代理 `/api`）；门禁：`npm run typecheck && npm run build && npm test` |
| **P4 Android 客户端** | • **Android Studio**（内置 **JDK `17` 或 `21`**，实测 Temurin `21.0.2`）<br>• **Gradle `8.14`**（工程自带 `gradlew`）<br>• **AGP `8.9.3`** + **Kotlin `2.0.21`** + **KSP `2.0.21-1.0.28`**<br>• **Android SDK `API 36`**（`compileSdk 36` / `targetSdk 35` / `minSdk 26`）<br>• **Hilt `2.52`** + **Health Connect SDK `1.1.0`** + **Room `2.6.1`** + **Retrofit `2.11.0`** + **OkHttp `4.12.0`**<br>• **OpenAPI Generator `7.27.0`** | [gen-api.ps1](../apps/android/scripts/gen-api.ps1) 已锁定 `7.27.0`；真机联调在 `apps/android/local.properties` 配置 `shixu.apiBaseUrl=http://<宿主机IP>:8080/`（或设 `ANDROID_API_BASE_URL`）。门禁：`.\gradlew.bat testDebugUnitTest lintDebug` |
