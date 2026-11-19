# 07 · 安全边界、测试验收标准与工程交付规范

> **对应目录**：`services/server/`、`apps/web/`、`apps/android/`  
> **目标**：把安全合规、可验证的自动化测试门槛与四人协作边界写死在流程里，防止重构后期再度失控。

---

## 1. 安全与隐私防护基线

### 1.1 认证与令牌安全（修复 V1 所有已知漏洞）
1. **密码哈希**：废弃 V1 的单轮 SHA-256，全量采用 **Argon2id**（建议参数：`m=65536 KiB (64MB)`, `t=3 iterations`, `p=1`）。
2. **双令牌机制**：
   - `Access Token`：无状态 JWT（HS256 或 EdDSA），有效期 **15 分钟**，仅承载 `sub (user_id)` 与过期时间。
   - `Refresh Token`：高熵随机字符串（32 字节以上），服务端仅存 SHA-256 哈希，有效期 **14 天**。
   - **重放检测（Token Rotation Reuse Detection）**：每次刷新作废旧记录并继承 `family_id` 签发新记录；若已作废的旧 Refresh Token 再次出现，立即吊销该 `family_id` 全部会话并返回 `401 TOKEN_REUSE_DETECTED`。
3. **双端 Refresh Token 自适应存放策略**：
   - **签发**：`register` / `login` / `refresh` 同时在 JSON Body 返回 `refreshToken`（供 Android 存入硬件 Keystore 背书的 `EncryptedDataStore`）并写入 `Set-Cookie: rc_refresh_token=...; HttpOnly; SameSite=Lax; Path=/api/v1/auth`（HTTPS 下加 `Secure`）。
   - **提取**：`/auth/refresh` 与 `/auth/logout` 优先读取 Body 中的 `refreshToken`（Android 显式传参），若未传则回退读取 `rc_refresh_token` Cookie（Web 内存态持 15 分钟 `accessToken`，零 `localStorage` 持久化长效密钥）。

### 1.2 生理与团队隐私威胁防护
- **对象级越权防护（BOLA/IDOR）**：所有 `/schedule/*`、`/biometrics/*`、`/energy/*` 查询强制在 SQL `WHERE` 子句中绑定从 JWT 提取的 `user_id`；所有 `/workspaces/{id}/*` 接口先验证调用者在 `workspace_members` 中的成员资格。
- **团队生理脱敏边界**：团队相关 Handler 只允许调用脱敏后的投影函数，禁止在任何团队 DTO Struct 中包含 `hrv_rmssd`、`heart_rate`、`sleep_duration` 或未授权成员的日程标题字段——在类型系统层面切断越权泄漏可能。

---

## 2. 分层测试金字塔与验收门禁

### 2.1 Go 服务端 (`services/server`)
- **引擎纯函数黄金测试（Unit + Table-Driven）**：
  - 精力模型测试：覆盖正常睡眠、连续熬夜（$S_{\text{sleep}}$ 骤降）、HRV 低于基线 $-1.5\sigma$ 触发 `wearable_fatigue`、缺失穿戴数据降级 `baseline_only` 等边界向量。
  - 协同排会求解器测试：覆盖跨时区交集、避开 `focus_shield`、高/低认知负荷会议匹配不同精力窗口、防碎片化打分、完全无解时输出精准 `blocking_diagnostics`。
  - 个人救援事务测试：验证 3 种策略产出的确定性差异、硬约束不可突破以及采纳/撤销后状态一致性。
- **PostgreSQL 集成测试（开启 `-race` 竞态检测）**：
  - 使用真实 PostgreSQL 实例（CI 起 PG 16 Service / 本地 Docker PG）验证：`tstzrange` GiST 冲突查询精度、两个并发请求同时抢占同一成员同一时间段确认会议时，必然一个成功一个返回 `409 Conflict`、Refresh Token 轮换重放吊销整族。
- **门禁命令**：`go test -race ./...` 与 `go vet ./...` 必须 100% 通过。

### 2.2 Web 工作台 (`apps/web`)
- **单元测试（Vitest）**：时间轴坐标换算、时区边界（跨零点/夏令时）、重叠会议分列算法、OpenAPI 错误码解析。
- **接口模拟与端到端回归（MSW + Playwright）**：覆盖登录失效跳转、日历新增与救援对比三方案确认/撤销、团队排会推荐与 409 冲突提示；校验 `390px` 移动端与 `1440px` 桌面端零横向溢出与浅/深色切换无对比度缺失。
- **门禁命令**：`npm run typecheck && npm run build && npm test`。

### 2.3 Android 客户端 (`apps/android`)
- **单元测试（JUnit5 + Turbine + Coroutines Test）**：
  - BLE `0x2A37` 字节流解析器（含 uint8/uint16 心率、多 RR 间期解析与异常跳变伪影剔除、RMSSD 数学精度验证）；
  - `HealthSyncWorker` 断网入队 Room → 联网批量重传与 `ChangesToken` 过期回退测试。
- **UI 状态测试（Compose UI Test）**：验证精力主卡数据源标签诚实渲染（区分 `live_wearable` / `baseline_only` / `replay_demo`）、过载救援确认 Sheet 交互。
- **门禁命令**：`./gradlew testDebugUnitTest lintDebug`。

---

## 3. 团队四人协作分工与物理接口锁规则

### 两大Day-0物理交接锁文件
1. **`contracts/openapi.json`（P1 ↔ P3/P4 HTTP & WS 唯一契约锁）**：由 `services/server/internal/api/contracts.go` 与 Huma 路由导出生成，P3（Web）与 P4（Android）据此自动生成类型与 Mock 测试桩，从第一天起零阻塞并行开发。
2. **`services/server/internal/engine/contracts.go`（P1 ↔ P2 纯函数算法契约锁）**：定义三大引擎接口（`EnergyEngine`、`TeamPlannerEngine`、`RescueEngine`）与零 SQL 依赖的输入输出 Struct，P2 仅据此文件实现与测试，P1 仅调用此接口组装数据库读写。

| 角色 | 独家拥有目录 | 协作交接点与防冲突规则 |
| --- | --- | --- |
| **P1 服务端基座与团队服务** | `services/server/internal/{auth,config,db,biometrics,schedule,workspace,realtime,api}`、`services/server/cmd/`、`migrations/` | 拥有数据库 Schema、`api/contracts.go` 与 `contracts/openapi.json` 发布权；修改 `engine/contracts.go` 需 P1+P2 联合评审 |
| **P2 精力与协同求解引擎** | `services/server/internal/engine/` | 实现 `engine/contracts.go` 定义的纯 Go 接口，不直接碰 SQL 或 HTTP；独立维护高精度表格驱动黄金测试用例库 |
| **P3 Web 前端工作台** | `apps/web/` | 消费 `contracts/openapi.json` 生成的 TS 类型；不手写与契约矛盾的本地类型；遵循 [06-design-system-v2.md](06-design-system-v2.md) |
| **P4 Android 穿戴与客户端** | `apps/android/` | 消费 `contracts/openapi.json` 生成的 Kotlin DTO；重点攻克 Health Connect 真机授权、BLE 真实设备/模拟器测试与通知推送 |

### 合并进主干（PR）四连检查
1. 后端修改后是否同步更新并提交了 `contracts/openapi.json`？
2. Go `go test -race ./...` 是否全绿？（Windows 11 Build 26100+ 需带 GCC 执行 `go test -race -ldflags="-linkmode=external" ./...`）
3. Web `npm run typecheck && npm run build && npm test` 是否全绿？
4. Android `./gradlew testDebugUnitTest lintDebug` 是否全绿？

---

## 4. 开发环境与工具链版本清单（按角色分工）

新成员拉取 `refactor/v2-rebuild` 分支后，**无需全员安装全部工具**，按个人分工安装对应工具链即可在 1 分钟内启动开发：

| 角色 / 适用范围 | 必备工具与锁定版本基线 | 关键说明与验证命令 |
| --- | --- | --- |
| **全员通用** | • **Git**（Windows 建议开启长路径与 LF/CRLF 统一）<br>• **Node.js `>= 20`**（实测 `v24.15.0` / `npm 11.12.1`） | P3 开发必需；P4 用来执行 `apps/android/scripts/gen-api.ps1` 拉起 `openapi-generator-cli` 最便捷 |
| **P1 服务端基座与 DB** | • **Go `>= 1.24`**（实测 `1.27.4`）<br>• **PostgreSQL `16`**（Docker Compose 或绿色版 `16.16`）<br>• **sqlc `v1.31.1`**<br>• **goose `v3.30.1`** | 复制根目录 [.env.example](../.env.example) 为 `.env`；Windows MinGW 8.1 下装 `sqlc` 需设 `$env:CGO_ENABLED="0"`。运行 `goose up`、`sqlc generate`、`go vet ./...`、`go test ./...` |
| **P2 算法求解引擎** | • **Go `>= 1.24`**（实测 `1.27.4`） | 仅需 Go 工具链（无需本地装 PG 或 Android SDK），直接在 `services/server/internal/engine/` 跑 `go test -v ./internal/engine`（Windows 跑 `-race` 需配 GCC 并附加 `-ldflags="-linkmode=external"`） |
| **P3 Web 工作台** | • **Node.js `>= 20`**<br>• **Vite `6.4.6`** + **React `19.1`** + **TypeScript `5.8`**<br>• **Tailwind CSS `v4.1`**<br>• **openapi-typescript `7.13.0`** + **Vitest `3.2.7`** | 在 `apps/web/` 执行 `npm install && npm run gen:api && npm run dev`；门禁执行 `npm run typecheck && npm run build && npm test` |
| **P4 Android 客户端** | • **Android Studio**（内置 **JDK `17` 或 `21`**，实测 Temurin `21.0.2`）<br>• **Gradle `8.14`**（工程自带 `gradlew` 自动下载）<br>• **AGP `8.9.3`** + **Kotlin `2.0.21`** + **KSP `2.0.21-1.0.28`**<br>• **Android SDK `API 36`**（`compileSdk 36` / `targetSdk 35` / `minSdk 26`）<br>• **Hilt `2.52`** + **Health Connect SDK `1.1.0`** + **Room `2.6.1`** + **Retrofit `2.11.0`** + **OkHttp `4.12.0`**<br>• **OpenAPI Generator `7.27.0`** | 首次用 `scripts/gen-api.ps1` 生成 Kotlin DTO；门禁执行 `./gradlew testDebugUnitTest lintDebug`（Windows 用 `.\gradlew.bat`） |
