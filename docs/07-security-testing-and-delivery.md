# 07 · 安全边界、测试验收标准与工程交付规范

> **对应目录**：`services/server/`、`apps/web/`、`apps/android/`  
> **关联文档**：四人职责边界与开发环境工具链已独立拆至 [08-team-division-and-workflow.md](08-team-division-and-workflow.md)  
> **目标**：把认证安全合规、生理隐私防护与可验证的自动化测试门槛固化在工程基线中，防止重构后期失控。

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
4. **鉴权失败与基础设施失败必须区分**：只有不存在账号、密码不匹配、令牌不存在或过期等真实凭据问题才返回对应 `401`。登录及刷新两次令牌查询的数据库错误必须保留原始原因，交由既有 RFC 9457 错误处理返回 `500 INTERNAL_SERVER_ERROR`，不得伪装成密码错误或登录失效；请求上下文取消同样保留原因。刷新查询失败时事务回滚，不签发或作废令牌，数据库恢复后原有效令牌可以重试；失败响应不得重置会话 Cookie 或暴露 SQL 细节。

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

## 3. 团队四人协作分工与开发环境

四人详细职责矩阵（P1 服务端基座 / P2 算法引擎与联调验收 / P3 Web / P4 Android）、物理接口锁（`contracts/openapi.json` 与 `internal/engine/contracts.go`）、迭代里程碑及各角色工具链版本清单，已独立拆出维护于：

- 👉 [08 · 四人团队协作分工、并行机制与开发环境清单](08-team-division-and-workflow.md)
