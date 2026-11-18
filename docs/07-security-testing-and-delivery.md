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
3. **Web 凭证存放策略**：`Refresh Token` 优先通过 `HttpOnly; Secure; SameSite=Lax` Cookie 管理（或内存态 Access Token + 安全刷新端点），避免长效密钥暴露在 `localStorage`。

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

## 3. 团队四人协作分工与接口锁规则

| 角色 | 独家拥有目录 | 协作交接点与防冲突规则 |
| --- | --- | --- |
| **P1 服务端基座与团队服务** | `services/server/internal/{auth,config,db,biometrics,schedule,workspace,realtime,api}`、`migrations/` | 拥有数据库 Schema 与 `openapi.json` 发布权；任何路由参数修改需导出契约提交 PR |
| **P2 精力与协同求解引擎** | `services/server/internal/engine/` | 通过纯 Go Struct 接口与 P1 对接，不直接碰 SQL；独立维护高精度算法测试用例库 |
| **P3 Web 前端工作台** | `apps/web/` | 消费 `contracts/openapi.json` 生成的 TS 类型；不手写与契约矛盾的本地类型；遵循 [06-design-system-v2.md](06-design-system-v2.md) |
| **P4 Android 穿戴与客户端** | `apps/android/` | 消费 `contracts/openapi.json` 生成的 Kotlin DTO；重点攻克 Health Connect 真机授权、BLE 真实设备/模拟器测试与通知推送 |

### 合并进主干（PR）四连检查
1. 后端修改后是否同步更新并提交了 `contracts/openapi.json`？
2. Go `go test -race ./...` 是否全绿？
3. Web `tsc --noEmit` 与 Vitest 是否全绿？
4. Android `./gradlew testDebugUnitTest` 是否全绿？
