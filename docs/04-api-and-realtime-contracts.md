# 04 · REST API、WebSocket 实时推送与 OpenAPI 契约规范

> **对应后端模块**：`services/server/internal/api/`、`services/server/internal/realtime/`、`services/server/cmd/export-openapi/`  
> **契约定义源码**：[services/server/internal/api/contracts.go](../services/server/internal/api/contracts.go)、[services/server/internal/api/routes.go](../services/server/internal/api/routes.go)  
> **契约产物说明**：[contracts/README.md](../contracts/README.md)（导出生成 `contracts/openapi.json`）  
> **目标**：以 OpenAPI 3.1 为唯一编译期真相源（Single Source of Truth），定义完备的 REST 资源边界、双端自适应认证契约、RFC 9457 统一错误字典与 WebSocket 实时协同协议。

---

## 1. 契约先行开发流程（Contract-First）

1. **强类型 Go 结构体唯一真源**：服务端在 [services/server/internal/api/contracts.go](../services/server/internal/api/contracts.go)、[enums.go](../services/server/internal/api/enums.go)、[errors.go](../services/server/internal/api/errors.go)、[ws.go](../services/server/internal/api/ws.go) 与 [routes.go](../services/server/internal/api/routes.go) 中使用 `Huma v2` 定义全部 Request / Response DTO、共享 `$ref` 枚举组件与 WebSocket 事件 Payload（已关闭 Request/Response `$schema` 注入与可空数组 `DefaultArrayNullable = false`）。
   - 所有物理时间戳统一为 `RFC 3339 / ISO-8601` UTC 字符串（例：`2026-11-18T13:00:00Z`）；
   - 所有本地日历日期统一为 `YYYY-MM-DD` 字符串（例：`2026-11-18`）；
   - 所有时长统一为整型分钟数 `durationMinutes`，**严禁**出现像素高度或前端颜色整数。
2. **一键导出 OpenAPI 3.1 契约锁**：后端修改任何路由、参数或响应结构后，必须立即执行导出命令更新 `contracts/openapi.json`：
   ```powershell
   cd services/server
   go run ./cmd/export-openapi -out ../../contracts/openapi.json
   ```
3. **双端代码生成与编译期门禁**：
   - **Web 端 (`apps/web`)**：通过 `openapi-typescript` 生成 `src/api/schema.d.ts`，配合 `openapi-fetch` 进行全链路强类型调用。
   - **Android 端 (`apps/android`)**：通过 OpenAPI Generator 生成 `Kotlinx Serialization + Retrofit` 接口与 DTO。
   - **铁律**：严禁在 Web 或 Android 端手写与 `contracts/openapi.json` 漂移的私有接口 DTO。

---

## 2. REST API 端点全量规范（基础路径 `/api/v1`）

### 2.1 健康检查、认证与会话 (`/health`, `/auth/*`)

| # | 方法与路径 | 鉴权 | 核心请求字段 (Query / Body) | 核心响应字段 | 语义与关键状态码 |
| --- | --- | --- | --- | --- | --- |
| 1 | `GET /health` | 公开 | — | `ok`, `version`, `dbStatus`, `serverTime` | 数据库连通性探针；异常返回 `503 ProblemDetail (SERVICE_UNAVAILABLE)` |
| 2 | `POST /auth/register` | 公开 | `email`, `displayName`, `password(>=8)`, `timezone?`, `deviceName?` | `accessToken`, `expiresInSeconds`, `refreshToken`, `user` + `Set-Cookie` | 创建账号并初始化默认 `energy_profiles`；邮箱已存在返 `409 EMAIL_ALREADY_EXISTS` |
| 3 | `POST /auth/login` | 公开 | `email`, `password`, `deviceName?` | `accessToken`, `expiresInSeconds`, `refreshToken`, `user` + `Set-Cookie` | Argon2id 校验，创建新令牌族 (`family_id`)；凭证错误返 `401 INVALID_CREDENTIALS` |
| 4 | `POST /auth/refresh` | 公开 | `refreshToken?` (可选 Body) 或 `Cookie: rc_refresh_token`, `deviceName?` | `accessToken`, `expiresInSeconds`, `refreshToken`, `user` + `Set-Cookie` | **令牌轮换**：旧令牌立即作废并签发同族新令牌；检测到已轮换令牌被重放则吊销整族并返 `401 TOKEN_REUSE_DETECTED` |
| 5 | `POST /auth/logout` | Bearer | `refreshToken?` (可选 Body) 或 `Cookie: rc_refresh_token` | `204 No Content`（并清除 Cookie） | 吊销当前设备 Refresh Token 并下发 `Max-Age=0` Cookie |
| 6 | `GET /auth/me` | Bearer | — | `id`, `email`, `displayName`, `timezone`, `themeMode`, `createdAt`, `updatedAt` | 获取当前登录用户档案 |
| 7 | `PATCH /auth/me` | Bearer | `displayName?`, `timezone?`, `themeMode?` (`'system'\|'light'\|'dark'`) | 更新后的 `UserProfile` | 更新个人显示名称、IANA 时区或主题偏好 |
| 8 | `POST /auth/ws-ticket` | Bearer | — | `ticket`, `expiresAt` | **WebSocket 握手票据**：签发 30 秒有效、单次消费即销毁的短效票据 |

#### 双端 Refresh Token 自适应契约（Web Cookie + Android JSON Body）

1. **双轨签发（`POST /auth/register`、`POST /auth/login`、`POST /auth/refresh`）**：
   - **JSON Body 返回 `refreshToken`**：供 Android 客户端读取并加密存入 Jetpack `EncryptedDataStore`（硬件 Keystore 背书）。
   - **HTTP Header 写入 `HttpOnly` Cookie**：同时下发 `Set-Cookie: rc_refresh_token=<token>; HttpOnly; SameSite=Lax; Path=/api/v1/auth; Max-Age=1209600`（生产 HTTPS 环境强制附加 `Secure`）。Web 端仅在内存（Zustand memory state）持有 15 分钟有效期的 `accessToken`，由浏览器自动托管 `rc_refresh_token` Cookie，彻底杜绝 `localStorage` 暴露长效令牌的 XSS 风险。
2. **自适应提取优先级（`POST /auth/refresh`、`POST /auth/logout`）**：
   - 请求体中的 `body.refreshToken` 定义为**可选字段（optional）**。
   - **读取顺序**：服务端**优先读取 `body.refreshToken`**（Android 端显式传参）；若 `body.refreshToken` 为空字符串或未传，则**自动回退读取请求 Cookie `rc_refresh_token`**（Web 端通过 `credentials: 'include'` 自动携带）。
   - 若两处均无令牌或令牌已过期，返回 `401 INVALID_REFRESH_TOKEN`。

数据库故障不是无效凭据：登录读取密码及刷新读取令牌失败时，使用现有契约已声明的 `500 INTERNAL_SERVER_ERROR`（`application/problem+json`），不返回 `401 INVALID_CREDENTIALS` / `INVALID_REFRESH_TOKEN`。响应不包含底层 SQL 诊断，也不写入新的会话 Cookie；原始原因留给服务端诊断。不存在账号/令牌、密码不匹配等真实鉴权失败仍保持 401。本规则不改变请求、响应 DTO 或令牌轮换协议。

---

### 2.2 穿戴生理上报与精力模型 (`/biometrics/*`, `/energy/*`)

| # | 方法与路径 | 鉴权 | 核心请求字段 (Query / Body) | 核心响应字段 | 语义与关键状态码 |
| --- | --- | --- | --- | --- | --- |
| 9 | `POST /biometrics/samples/batch` | Bearer | `samples[1..500]`: `{sourceType, metricType, recordedAt, endAt?, numericValue, unit, sleepStage?, externalId, metadata?}` | `acceptedCount`, `deduplicatedCount`, `latestEnergy` | **强制 `externalId` 必填**；单批 `1..500` 条；按唯一索引幂等去重；越界伪影返 `422 INVALID_BIOMETRIC_SAMPLE`；入库后实时返回 `latestEnergy` |
| 10 | `POST /biometrics/replay-seed` | Bearer | `scenario` (`'well_rested'\|'sleep_deprived'\|'high_stress'`), `day` (`YYYY-MM-DD`) | `scenario`, `day`, `seededCount`, `latestEnergy` | 显式注入 `sourceType='replay_demo'` 的测试回放样本并实时返回重算后的 `latestEnergy` |
| 11 | `GET /energy/today` | Bearer | Query: `day?` (`YYYY-MM-DD`, 默认用户本地今日) | `localDay`, `timezone`, `computedAt`, `score`, `tier`, `dataFreshness`, `drivers`, `hourlyCurve[]`, `focusShields[]`, `overloadAlert?`, `diagnostics` | 返回当日精力电量、四因子贡献拆解、本地自然日带 UTC 时间戳预测曲线（常规 24 点，DST 切换日 23/25 点）、专注保护盾、过载预警与穿戴基线诊断 |
| 12 | `GET /energy/profile` | Bearer | — | `userId`, `workStartMinute`, `workEndMinute`, `chronotype`, `preferredFocusWindows[]`, `minRecoveryBufferMin`, `hrvBaselineMs?`, `rhrBaselineBpm?`, `updatedAt` | 获取当前用户的节律配置与 14 日滑动生理基线 |
| 13 | `PUT /energy/profile` | Bearer | `workStartMinute`, `workEndMinute`, `chronotype`, `preferredFocusWindows[]`, `minRecoveryBufferMin` | 更新后的 `EnergyProfile` | 校验 `workEndMinute > workStartMinute` 及专注窗边界（越界返 `422 INVALID_WORK_HOURS`），保存后同步触发当日精力重算 |

#### 穿戴上报与精力响应契约细则

1. **`POST /biometrics/samples/batch` 的 `externalId` 确定性幂等规则**：
   - `externalId` 为**必填非空字符串**（缺失或为空返回 `422 VALIDATION_FAILED`）：
     - **Health Connect 通道 (`sourceType = 'health_connect'`)**：传入系统 `Record.metadata.id`（对拆分的睡眠分期记录传入 `hc:{sleepSessionId}:stage:{stageIndex}:{startEpochSec}`）。
     - **BLE GATT 通道 (`sourceType = 'ble_gatt'`)**：Android 端在入队 Room `pending_biometrics` 前，必须按 60 秒聚合窗口构造 `ble:{deviceHash}:{metricType}:{recordedAtEpochSec}`（例：`ble:9f86d081:hrv_rmssd:1795012200`）。
   - 服务端通过 `uq_biometrics_external (user_id, source_type, metric_type, external_id)` 执行幂等写入，保障弱网重传零脏数据。
   - 生理值、单位或时间区间无效时整批拒绝且不部分写入；`422 INVALID_BIOMETRIC_SAMPLE` 在 `errors[].location` 中返回首个无效点的字段位置（例如 `body.samples[1].numericValue`），供离线队列隔离该点后重试其余样本。结构性校验仍使用 `422 VALIDATION_FAILED`。
2. **`GET /energy/today`（及 `latestEnergy`）完整响应结构**：
   ```json
   {
     "localDay": "2026-11-18",
     "timezone": "Asia/Shanghai",
     "computedAt": "2026-11-18T06:30:00Z",
     "score": 82,
     "tier": "peak",
     "dataFreshness": "live_wearable",
     "drivers": {
       "sleepRecoveryScore": 39.5,
       "autonomicDeltaScore": 11.0,
       "circadianScore": 24.0,
       "cognitiveLoadDrainScore": 6.5,
       "recoveryBufferBonusScore": 4.0,
       "sleepDurationMinutes": 465,
       "recentHrvRmssdMs": 62.4,
       "recentRestingHrBpm": 56.0,
       "summary": "昨夜深睡充足，晨间 HRV 高于个人 14 日基线 +1.3σ，当前处于上午心流峰值区。"
     },
     "hourlyCurve": [
       { "hourStartAt": "2026-11-17T16:00:00Z", "score": 48, "tier": "strained" },
       { "hourStartAt": "2026-11-18T01:00:00Z", "score": 84, "tier": "peak" }
     ],
     "focusShields": [
       {
         "startAt": "2026-11-18T01:00:00Z",
         "endAt": "2026-11-18T03:30:00Z",
         "avgScore": 85,
         "source": "preferred_window"
       }
     ],
     "overloadAlert": null,
     "diagnostics": {
       "lastSyncedAt": "2026-11-18T06:28:15Z",
       "primarySource": "health_connect",
       "baselineReadyDays": 14,
       "hrvBaselineMs": 54.2,
       "rhrBaselineBpm": 58.0
     }
   }
   ```

---

### 2.3 个人日程与突发救援 (`/schedule/*`)

| # | 方法与路径 | 鉴权 | 核心请求字段 (Query / Path / Body) | 核心响应字段 | 语义与关键状态码 |
| --- | --- | --- | --- | --- | --- |
| 14 | `GET /schedule/items` | Bearer | Query: `from` (RFC3339), `to` (RFC3339), `includeCancelled?` (bool) | `items[]`, `baselineLocalDay`, `baselineVersion` | **强制校验 `to - from <= 62 days`**（超限返 `422 RANGE_TOO_LARGE`）；返回时间窗内日程、乐观锁锚定日与 48h 基线版本 |
| 15 | `POST /schedule/items` | Bearer | `title`, `notes?`, `category`, `cognitiveLoad`, `flexibility`, `startAt`, `endAt`, `deadlineAt?`, `reminderMinutes?`, `allowOverlap?` | `item`, `baselineLocalDay`, `baselineVersion` | `endAt <= startAt` 返 `422 INVALID_TIME_RANGE`；若与未取消的 `hard_locked` 或已确认 `meeting` 重叠且 `allowOverlap != true`，返 `409 CONFLICT_SCHEDULE_OVERLAP` |
| 16 | `PATCH /schedule/items/{id}` | Bearer | Path: `id`; Body: `title?`, `notes?`, `category?`, `cognitiveLoad?`, `flexibility?`, `status?`, `startAt?`, `endAt?`, `deadlineAt?` (可传 `null`), `clearDeadline?`, `reminderMinutes?`, `allowOverlap?` | `item`, `baselineLocalDay`, `baselineVersion` | `status` 仅允许 `'planned'\|'in_progress'\|'completed'\|'cancelled'`；传 `deadlineAt: null` 或 `clearDeadline: true` 可清除截止时间；团队关联会议仅可改 `notes`/`reminderMinutes` 或标 `'completed'`（改时间或取消返 `409 MEETING_MANAGED_BY_PROPOSAL`） |
| 17 | `DELETE /schedule/items/{id}` | Bearer | Path: `id` | `204 No Content` | 软删除置 `status = 'cancelled'`（释放 GiST 区间）；团队关联会议直接删返 `409 MEETING_MANAGED_BY_PROPOSAL` |
| 18 | `POST /schedule/rescue/options` | Bearer | `day` (`YYYY-MM-DD`), `triggerReason`, `urgentTask?`: `{title, notes?, durationMinutes, cognitiveLoad, deadlineAt}` | `day`, `baselineVersion`, `options[]` (默认 3 套, `minItems: 1`) | 纯函数预演不写库；`deadlineAt <= now` 返 `422 DEADLINE_IN_PAST`；产出对比方案与 `optionHash` |
| 19 | `POST /schedule/rescue/apply` | Bearer | Header: `Idempotency-Key?`; Body: `day`, `baselineVersion`, `strategy`, `triggerReason`, `urgentTask?`, `expectedOptionHash?` | `snapshotId`, `strategy`, `baselineLocalDay`, `baselineVersion`, `appliedItems[]` | **禁止客户端传 `afterItems[]`**；单事务锁 `users` 行、校验 48h `baselineVersion`（过期返 `409 STALE_BASELINE_VERSION`）、服务端确定性重算并落库日程与 `rescue_snapshots` |
| 20 | `POST /schedule/rescue/undo` | Bearer | `snapshotId` | `snapshotId`, `status` (`'reverted'`), `baselineLocalDay`, `baselineVersion`, `restoredItems[]` | 单事务校验 `status == 'applied'`（已撤销返 `409 ALREADY_REVERTED`）且还原 `before_items` 不与新增 `hard_locked / meeting` 冲突（冲突返 `409 SNAPSHOT_RESTORE_CONFLICT`） |
| 21 | `GET /schedule/rescue/history` | Bearer | Query: `limit?` (`1..50`, 默认 `20`), `cursor?` | `snapshots[]`, `nextCursor?` | 分页查看近期救援采纳与撤销历史记录 |

#### 个人日程与救援契约细则

1. **`PATCH /schedule/items/{id}` 状态枚举与团队会议边界（修复枚举冲突）**：
   - `schedule_items.status` 严格对齐数据库 `CHECK` 约束，仅允许 4 个枚举值：`'planned' | 'in_progress' | 'completed' | 'cancelled'`（**不存在 `'declined'`**）。
   - 对于由团队协同排会生成的日程（`meetingProposalId != null`）：
     - 参会人接受或拒绝会议**必须**通过 `POST /workspaces/{id}/meetings/{proposalId}/respond` 执行（当 `responseStatus = 'declined'` 时，由服务端在同一事务内将该用户的 `schedule_items.status` 置为 `'cancelled'`）；
     - 组织者或管理员取消会议**必须**通过 `POST /workspaces/{id}/meetings/{proposalId}/cancel` 执行；
     - 个人在 `/schedule/items/{id}` 仅允许修改 `notes`、`reminderMinutes` 或将状态标记为 `'completed'`。
2. **`POST /schedule/rescue/options` 的 `RescueOption` 结构定义**：
   - 固定返回 3 个方案（`strategy` 分别为 `'protect_deadline'`、`'protect_recovery'`、`'minimize_changes'`），每个 `RescueOption` 结构如下：
     - `strategy`: `'protect_deadline' | 'protect_recovery' | 'minimize_changes'`
     - `optionHash`: `string`（方案 `diffItems` 的确定性 SHA-256 指纹）
     - `feasible`: `bool`（无逾期且满足全部硬约束时为 `true`）
     - `movedCount`: `int`（在当日内调整起止时间的任务数）
     - `deferredCount`: `int`（顺延至次日工作窗的任务数）
     - `recoveryMinutes`: `int`（方案保障的恢复缓冲总分钟数）
     - `overdueRiskCount`: `int`（存在晚于 `deadlineAt` 风险的任务数）
     - `summary`: `string`（可读方案权衡摘要）
     - `diffItems[]`: 每项包含 `{ op: 'create' | 'move' | 'defer' | 'unchanged', itemId?: UUID, title: string, category: ScheduleCategory, cognitiveLoad: CognitiveLoad, flexibility: Flexibility, beforeStartAt?: RFC3339, beforeEndAt?: RFC3339, afterStartAt: RFC3339, afterEndAt: RFC3339, reasonCode: string, reasonLabel: string }`
3. **`POST /schedule/rescue/apply` 安全重算事务（修复客户端传 `afterItems[]` 漏洞）**：
   - 客户端**只允许**传 `{ day, baselineVersion, strategy, triggerReason, urgentTask?, expectedOptionHash? }`，**严禁**由客户端直接上传修改后的 `afterItems[]` 数组。
   - 服务端在单个 PostgreSQL 事务中执行：
     1. `SELECT id FROM users WHERE id = $1 FOR UPDATE` 锁定当前用户行；
     2. 查询用户目标 48h 窗口内有效日程并重算当前 `baselineVersion`，若与请求 `baselineVersion` 不一致，立即回滚并返回 `409 STALE_BASELINE_VERSION`；
     3. 调用 `RescueEngine.BuildOptions` 纯函数确定性重算指定 `strategy` 的方案（若请求携带 `expectedOptionHash` 且与重算出的 `optionHash` 不匹配，同样返回 `409 STALE_BASELINE_VERSION`）；
     4. 原子更新 `schedule_items` 并插入 `rescue_snapshots (status = 'applied', before_items, after_items)`。

---

### 2.4 团队空间与协同排会 (`/workspaces/*`)

| # | 方法与路径 | 鉴权 | 核心请求字段 (Query / Path / Header / Body) | 核心响应字段 | 语义与关键状态码 |
| --- | --- | --- | --- | --- | --- |
| 22 | `POST /workspaces` | Bearer | `name` (`1..64`), `description?`, `privacyLevel?` | `Workspace`（含 `inviteCode`、`myRole='owner'` 及 `myPrivacyLevel`） | 创建团队工作区并自动将创建者设为 `owner` |
| 23 | `GET /workspaces` | Bearer | — | `workspaces[]`（含 `memberCount`、`myRole` 与 `myPrivacyLevel`） | 列出当前用户已加入的全部工作区 |
| 24 | `POST /workspaces/join` | Bearer | `inviteCode`, `privacyLevel?` | `Workspace` | 凭邀请码加入工作区；无效码返 `404 INVITE_CODE_NOT_FOUND`，已加入返 `409 ALREADY_WORKSPACE_MEMBER` |
| 25 | `PATCH /workspaces/{id}/me` | Bearer | Path: `id`; Body: `privacyLevel` (`'busy_only'\|'energy_tier'\|'full_title'`) | `WorkspaceMember`（含 `workspaceId`, `userId`, `displayName`, `role`, `timezone`, `privacyLevel`, `joinedAt`） | 修改个人在该团队公开的隐私投影级别，触发 `workspace.availability_changed` |
| 26 | `GET /workspaces/{id}/members` | Bearer | Path: `id` | `workspaceId`, `members[]`: `{userId, displayName, role, timezone, privacyLevel, joinedAt}` | **工作区成员名册**：供排会选人组件独立加载；非成员返 `403 FORBIDDEN_NOT_WORKSPACE_MEMBER` |
| 27 | `GET /workspaces/{id}/availability` | Bearer | Path: `id`; Query: `from` (RFC3339), `to` (RFC3339), `memberIds?` | `workspaceId`, `from`, `to`, `members[]`: `{userId, displayName, timezone, privacyLevel, workStartMinute, workEndMinute, slots[], energyBuckets[]?}` | **强制校验 `to - from <= 14 days`**（超限返 `422 RANGE_TOO_LARGE`）；**严格脱敏投影**：绝不含精力 `score` 或生理原值 |
| 28 | `POST /workspaces/{id}/meetings/recommend` | Bearer | Path: `id`; Body: `title`, `description?`, `durationMinutes` (`15..480`), `cognitiveLoad`, `participantIds[]`, `optionalIds[]?`, `searchFrom`, `searchTo`, `respectFocusShields?`, `maxResults?` (`1..10`, 默认 `3`) | `recommendations[]`, `blockingDiagnostics[]` | **强制校验 `searchTo - searchFrom <= 14 days`**；求解黄金协同窗口，返回结构化 `explanationTags: Array<{code, tone, label}>` |
| 29 | `POST /workspaces/{id}/meetings/confirm` | Bearer | Path: `id`; Header: `Idempotency-Key?`; Body: `proposalId?`, `title`, `description?`, `cognitiveLoad`, `participantIds[]`, `optionalIds[]?`, `startAt`, `endAt`, `recommendationMeta?` (`MeetingRecommendationMeta`) | `proposal`, `createdScheduleCount` | **单事务按 UUID 字典序锁全体参会人 `users` 行**，二次校验无 `hard_locked / meeting` 冲突（必选成员冲突返 `409 CONFLICT_MEMBER_BUSY`），原子落库提案与必选及可用可选成员的 `schedule_items`（时长由 `startAt`/`endAt` 推导，不再传冗余 `durationMinutes`） |
| 30 | `GET /workspaces/{id}/meetings` | Bearer | Path: `id`; Query: `status?` (`'draft'\|'confirmed'\|'cancelled'`), `from?`, `to?`, `limit?` (`1..50`), `cursor?` | `meetings[]`（含 `participants[]: {userId, displayName, required, responseStatus}`）, `nextCursor?` | 查询团队会议提案列表及每位参会人的回执状态 |
| 31 | `POST /workspaces/{id}/meetings/{proposalId}/respond` | Bearer | Path: `id`, `proposalId`; Body: `responseStatus` (`'accepted'\|'declined'`) | `proposalId`, `userId`, `responseStatus`, `scheduleStatus`, `updatedAt` | 受邀参会人回执；当为 `'declined'` 时，**同事务将该用户对应的 `schedule_items.status` 置为 `'cancelled'`**（释放 GiST 忙碌区间） |
| 32 | `POST /workspaces/{id}/meetings/{proposalId}/cancel` | Bearer | Path: `id`, `proposalId`; Body: `reason?` | `proposalId`, `status` (`'cancelled'`), `cancelledScheduleCount`, `updatedAt` | **仅会议 `organizer` 或工作区 `owner/admin` 可调用**（否则返 `403 FORBIDDEN_INSUFFICIENT_ROLE`）；同事务将提案与关联的全员 `schedule_items.status` 置为 `'cancelled'` |

会议确认保留全体邀请，并为必选成员及当前无硬冲突的可选成员创建个人日程；忙碌的可选成员可在冲突释放后再接受。`createdScheduleCount` 统计实际日程行，幂等重试保持同一口径。参会人 ID 去重，同一人同时出现在必选和可选列表时以必选为准。

救援历史与会议列表的 `cursor` 均为不透明游标，包含排序时间戳与 UUID。服务端按 `(applied_at, id)` 或 `(created_at, id)` 双键倒序分页，避免同一事务时间戳的记录在翻页时被跳过；客户端应原样回传，不能自行解释或拼接。

#### 团队协同与隐私隔离契约细则

1. **`GET /workspaces/{id}/availability` 跨时区结构化脱敏契约**：
   - `slots[]` 每项为 `{ startAt: RFC3339, endAt: RFC3339, kind: 'busy' | 'focus_shield' | 'soft_busy', title?: string }`：
     - `privacyLevel == 'busy_only'`：`hard_locked`、`meeting` 与 `focus_shield` 统一折叠为 `kind: 'busy'`，不输出 `soft_busy`，不输出 `title`，不输出 `energyBuckets`。
     - `privacyLevel == 'energy_tier'`（默认）：区分 `'busy' | 'focus_shield' | 'soft_busy'`，输出 `energyBuckets[]`，但**绝不输出 `title`**。
     - `privacyLevel == 'full_title'`：在 `energy_tier` 基础上额外输出 `slots[].title`。
   - `energyBuckets[]?` 每项为 `{ hourStartAt: RFC3339, tier: 'peak' | 'steady' | 'strained' | 'depleted' }`：
     - 采用带 UTC `hourStartAt` 的结构化时间桶，天然支持跨时区与最多 14 天多日网格对齐；
     - **物理隔离红线**：Go DTO 结构体层面不包含 `score`、`hrvRmssd`、`heartRate`、`sleepMinutes` 字段，从类型系统根源杜绝生理隐私泄漏。
2. **`POST /workspaces/{id}/meetings/recommend` 的 `explanationTags` 结构**：
   ```json
   {
     "code": "ALL_PARTICIPANTS_PEAK_OR_STEADY",
     "tone": "positive",
     "label": "全员处于精力峰值或平稳期，契合高认知负荷研讨"
   }
   ```
   - `tone` 枚举固定为 `'positive' | 'neutral' | 'warning'`，前端直接映射语义徽标色，无需正则解析文案。

---

## 3. 统一错误规范（RFC 9457 Problem Details）

`Huma v2` 统一返回 `Content-Type: application/problem+json`，所有业务异常均携带机器可读的顶层 `code` 枚举与可选的字段级 `errors[]`：

```json
{
  "type": "https://shixu.app/errors/conflict-member-busy",
  "title": "Schedule Conflict",
  "status": 409,
  "detail": "成员 张伟 在 2026-11-19T06:00:00Z ~ 07:00:00Z 已有锁定日程，无法确认会议预约。",
  "code": "CONFLICT_MEMBER_BUSY",
  "errors": [
    {
      "location": "body.startAt",
      "message": "conflicts with existing hard_locked or meeting block",
      "value": "2026-11-19T06:00:00Z"
    }
  ]
}
```

### 标准业务错误码字典（Error Code Dictionary）

| HTTP 状态码 | 标准业务 `code` 枚举 | 触发场景说明 | 客户端（Web & Android）强制处理规范 |
| --- | --- | --- | --- |
| `400` | `BAD_REQUEST` | JSON 语法损坏或无法解析请求体 | 提示请求格式错误，记录诊断日志 |
| `401` | `UNAUTHORIZED` | 缺失或无效的 `Authorization: Bearer` 令牌 | 触发单飞（Single-Flight）`POST /auth/refresh` 自动刷新并重放原请求 |
| `401` | `INVALID_CREDENTIALS` | 登录邮箱不存在或密码校验失败 | 在登录表单展示“账号或密码错误”，不触发刷新拦截器 |
| `401` | `INVALID_REFRESH_TOKEN` | Refresh Token 不存在、已过期或已主动注销 | 立即清空本地会话态，跳转至登录页（**禁止当作空业务列表渲染**） |
| `401` | `TOKEN_REUSE_DETECTED` | 检测到已轮换的旧 Refresh Token 被重放（整族已被吊销） | 立即清空本地凭证，弹窗提示“检测到会话异常，请重新登录”并跳转登录页 |
| `401` | `INVALID_WS_TICKET` | WebSocket 握手 `ticket` 不存在、已过期（>30s）或已被消费 | 重新调用 `POST /auth/ws-ticket` 获取新票据后再发起重连 |
| `403` | `FORBIDDEN` | 通用权限不足兜底错误 | 提示无权执行当前操作 |
| `403` | `FORBIDDEN_NOT_WORKSPACE_MEMBER` | 访问未加入的 `workspaceId` 资源 | 提示“您不是该团队工作区成员”并跳回工作区列表 |
| `403` | `FORBIDDEN_INSUFFICIENT_ROLE` | 非会议 `organizer` 且非工作区 `owner/admin` 尝试取消会议 | 禁用取消按钮并提示“仅会议发起人或工作区管理员可取消会议” |
| `403` | `FORBIDDEN_NOT_MEETING_PARTICIPANT` | 非该会议提案的受邀参会人调用 `/respond` | 提示“您不在该会议受邀名单中” |
| `404` | `NOT_FOUND` | 通用资源不存在（如 `schedule_items.id` 不存在或不属于当前用户） | 提示目标记录不存在或已被移除，刷新当前列表缓存 |
| `404` | `INVITE_CODE_NOT_FOUND` | 团队工作区邀请码无效或已失效 | 在加入团队输入框下方标红提示“邀请码无效，请核对后重试” |
| `404` | `MEETING_PROPOSAL_NOT_FOUND` | 指定的 `proposalId` 在该工作区下不存在 | 提示会议提案不存在，刷新团队会议列表 |
| `404` | `SNAPSHOT_NOT_FOUND` | 指定的救援快照 `snapshotId` 不存在 | 提示救援快照不存在，刷新救援历史列表 |
| `405` | `METHOD_NOT_ALLOWED` | 请求 HTTP 方法不被该路径支持 | 检查请求方法与客户端生成代码版本 |
| `409` | `CONFLICT` | 通用资源状态冲突兜底错误 | 刷新最新资源状态后重试 |
| `409` | `EMAIL_ALREADY_EXISTS` | 注册邮箱已被占用 | 在注册页邮箱字段标红提示“该邮箱已注册，请直接登录” |
| `409` | `ALREADY_WORKSPACE_MEMBER` | 用户已在该工作区中，重复调用 `/workspaces/join` | 直接引导跳转进入该工作区视图 |
| `409` | `CONFLICT_SCHEDULE_OVERLAP` | 新建/修改个人日程与既有 `hard_locked` 或 `meeting` 重叠（且 `allowOverlap != true`） | 高亮展示冲突的日程时段与标题，询问用户是否改期或开启强制重叠 |
| `409` | `CONFLICT_MEMBER_BUSY` | 确认团队会议事务加锁复检时，某必选成员时段已被并发占用 | 展示具体冲突成员昵称，自动重新请求 `/meetings/recommend` 刷新候选窗口 |
| `409` | `MEETING_MANAGED_BY_PROPOSAL` | 尝试通过个人 `/schedule/items/{id}` 直接删改团队会议的时间或状态 | 提示“团队会议请通过会议回执（接受/拒绝）或由组织者取消” |
| `409` | `MEETING_ALREADY_CANCELLED` | 对已处于 `cancelled` 状态的会议提案再次调用 `/respond` 或 `/cancel` | 刷新会议状态为“已取消”，关闭操作弹窗 |
| `409` | `STALE_BASELINE_VERSION` | 调用 `/schedule/rescue/apply` 时，用户 48h 日程基线已变化或 `expectedOptionHash` 不匹配 | 提示“您的日程刚刚发生了更新，正在为您重新生成最新救援方案”并重拉 `/rescue/options` |
| `409` | `ALREADY_REVERTED` | 对 `status == 'reverted'` 的救援快照重复调用 `/schedule/rescue/undo` | 置灰撤销按钮并提示“该救援方案已撤销” |
| `409` | `SNAPSHOT_RESTORE_CONFLICT` | 撤销救援快照时，原 `before_items` 时段已被快照之后新确认的锁定日程/团队会议占用 | 展示冲突的新会议详情，阻止静默覆盖，引导用户手动调整 |
| `422` | `VALIDATION_FAILED` | 通用字段格式、枚举或长度校验失败 | 解析 `errors[].location` 紧贴对应表单字段展示错误提示 |
| `422` | `RANGE_TOO_LARGE` | `/schedule/items` 跨度超过 62 天，或 `/availability`、`/meetings/recommend` 跨度超过 14 天 | 自动收敛查询日期范围或提示“单次查询时间跨度过大” |
| `422` | `INVALID_TIME_RANGE` | `endAt <= startAt` 或 `to <= from` | 在起止时间选择器下方标红提示“结束时间必须晚于开始时间” |
| `422` | `DEADLINE_IN_PAST` | 紧急救援任务 `urgentTask.deadlineAt <= now` | 标红截止时间字段，提示“紧急任务截止时间必须晚于当前时间” |
| `422` | `INVALID_BIOMETRIC_SAMPLE` | 穿戴样本物理值越界（如 HR < 30 或 > 220、HRV > 250ms） | Android 端从 `pending_biometrics` 队列剔除该异常坏点并记录本地诊断日志，避免死循环重传 |
| `422` | `INVALID_WORK_HOURS` | `workEndMinute <= workStartMinute` 或 `preferredFocusWindows` 越界 | 在节律设置表单标红提示工作时段与心流窗口区间错误 |
| `422` | `PARTICIPANT_NOT_IN_WORKSPACE` | 排会请求的 `participantIds` 或 `optionalIds` 含有非当前工作区成员 | 刷新工作区成员列表（`GET /workspaces/{id}/members`）并提示移除非成员 |
| `429` | `TOO_MANY_REQUESTS` | 触发限流保护 | 退避后重试并提示用户稍后再试 |
| `500` | `INTERNAL_SERVER_ERROR` | 未捕获服务端异常 | 展示通用错误提示并上报诊断请求 ID |
| `503` | `SERVICE_UNAVAILABLE` | 数据库连接池不可用或服务停机维护 | 展示非阻塞连接中断横幅，Android 端转入 Room 离线缓冲模式 |

---

## 4. WebSocket 实时协同协议 (`GET /api/v1/ws`)

### 4.1 握手鉴权、心跳与断线补偿

1. **短效票据握手（避免 URL 泄露 JWT）**：
   - 客户端先携带 Bearer Token 调用 `POST /api/v1/auth/ws-ticket`，获取 30 秒有效、单次消费即销毁的 `ticket`；
   - 随后连接 `wss://<host>/api/v1/ws?ticket=<ticket>`；若票据无效或过期，服务端拒绝升级并返回 `401 INVALID_WS_TICKET`。
   - 票据仅以 SHA-256 摘要存入迁移 `0002_ws_tickets.sql` 创建的 `ws_tickets`；API 启动前须执行该迁移。握手通过带有效期条件的 `DELETE ... RETURNING` 原子消费，因此签发与握手落到不同 API 实例时仍保持单次有效。
   - 升级前的票据拒绝使用 `application/problem+json` 的 RFC 9457 `ProblemDetail`；浏览器 `Origin` 必须在 `CORS_ALLOWED_ORIGINS` 中，否则返回 `403 FORBIDDEN` 且不消费票据。Android 等原生客户端可不发送 `Origin`，仍必须提供有效票据。
2. **心跳保活与重连补偿**：
   - 服务端每 `30s` 发送 WebSocket `Ping` 控制帧（客户端 `10s` 内未回 `Pong` 则判定断开）；
   - 客户端断开后按指数退避重连（`1s -> 2s -> 5s -> 15s` + 随机抖动）；
   - **重连成功后状态对齐**：客户端必须立即重拉一次 `GET /energy/today` 与当前可见时间窗的 `GET /schedule/items`（Android 端据此核对 `baselineVersion` 并对账本地提醒闹钟）。

### 4.2 标准 JSON 消息信封（Event Envelope）

所有服务端下行消息均采用统一 JSON 信封结构：

```json
{
  "version": 1,
  "eventId": "01933e6a-8c3b-7000-8000-000000000001",
  "type": "schedule.updated",
  "occurredAt": "2026-11-18T14:30:00Z",
  "payload": {}
}
```

### 4.3 七大下行事件契约清单（Server → Client）

| # | 事件类型 (`type`) | 触发时机 | 投递目标范围 | `payload` 结构定义 |
| --- | --- | --- | --- | --- |
| 1 | `energy.updated` | 穿戴样本批量入库、测试回放注入、修改 `EnergyProfile` 或日程变动引起精力重算完成 | 当前用户全部在线端（Web + Android） | `{ userId: UUID, localDay: 'YYYY-MM-DD', score: int, tier: EnergyTier, dataFreshness: DataFreshness, computedAt: RFC3339 }` |
| 2 | `energy.overload_alert` | 精力重算触发穿戴疲劳 (`wearable_fatigue`) 或会议连续过载 (`team_meeting_overload`) 阈值 | 当前用户全部在线端（Web + Android） | `{ userId: UUID, localDay: 'YYYY-MM-DD', triggerReason: RescueTriggerReason, severity: 'warning' \| 'critical', currentScore: int, tier: EnergyTier, message: string, recommendedStrategy: RescueStrategy }` |
| 3 | `schedule.updated` | 个人日程增删改、救援方案采纳 (`rescue_applied`)、救援撤销 (`rescue_reverted`)、团队会议确认/拒绝/取消引起个人日程表变更 | 当前用户全部在线端（驱动 Web 刷新日历，驱动 Android 秒级刷新 Room 缓存并重排本地闹钟） | `{ userId: UUID, baselineLocalDay: 'YYYY-MM-DD', baselineVersion: string, reason: 'item_created' \| 'item_updated' \| 'item_cancelled' \| 'rescue_applied' \| 'rescue_reverted' \| 'team_meeting_synced', affectedFrom: RFC3339, affectedTo: RFC3339, itemIds: UUID[] }` |
| 4 | `workspace.meeting_confirmed` | `POST /workspaces/{id}/meetings/confirm` 事务提交成功 | 该会议全体必选与可选参会人的在线端 | `{ workspaceId: UUID, proposalId: UUID, organizerId: UUID, title: string, cognitiveLoad: CognitiveLoad, startAt: RFC3339, endAt: RFC3339, participantIds: UUID[] }` |
| 5 | `workspace.meeting_cancelled` | `POST /workspaces/{id}/meetings/{proposalId}/cancel` 事务提交成功 | 该会议全体参会人的在线端（驱动 Android 立即注销该会议的本地提醒闹钟） | `{ workspaceId: UUID, proposalId: UUID, cancelledByUserId: UUID, title: string, startAt: RFC3339, endAt: RFC3339, reason?: string }` |
| 6 | `workspace.meeting_responded` | `POST /workspaces/{id}/meetings/{proposalId}/respond` 参会人接受或拒绝会议 | 会议发起人及该工作区在线成员端 | `{ workspaceId: UUID, proposalId: UUID, userId: UUID, displayName: string, responseStatus: 'accepted' \| 'declined', respondedAt: RFC3339 }` |
| 7 | `workspace.availability_changed` | 工作区成员增删改日程、采纳/撤销救援、修改 `privacyLevel` 或精力档位跨级变化（2 秒节流合并） | 同一工作区全体在线成员端（**零隐私详情**，仅通知前端按需静默刷新 `/availability`） | `{ workspaceId: UUID, userId: UUID, reason: 'schedule_changed' \| 'privacy_changed' \| 'energy_tier_changed', affectedFrom?: RFC3339, affectedTo?: RFC3339 }` |

#### 典型事件 Payload 示例：`schedule.updated`

```json
{
  "version": 1,
  "eventId": "01933e6a-8c3b-7000-8000-000000000002",
  "type": "schedule.updated",
  "occurredAt": "2026-11-18T14:32:10Z",
  "payload": {
    "userId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "baselineLocalDay": "2026-11-18",
    "baselineVersion": "9a8b7c6d5e4f3a2b",
    "reason": "rescue_applied",
    "affectedFrom": "2026-11-18T00:00:00Z",
    "affectedTo": "2026-11-19T23:59:59Z",
    "itemIds": [
      "550e8400-e29b-41d4-a716-446655440000",
      "550e8400-e29b-41d4-a716-446655440001"
    ]
  }
}
```
