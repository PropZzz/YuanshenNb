# 04 · REST API、WebSocket 实时推送与 OpenAPI 契约规范

> **对应后端模块**：`services/server/internal/api/`、`services/server/internal/realtime/`
> **契约产物**：[contracts/README.md](../contracts/README.md)（后续产出 `contracts/openapi.json`）
> **目标**：以 OpenAPI 3.1 为唯一真相源，定义清晰的 REST 资源边界、RFC 9457 统一错误语义与团队实时推送协议。

---

## 1. 契约先行开发流程（Contract-First）

1. Go 服务端采用 `Huma v2` 注册强类型 Request/Response Struct，所有时间字段统一为 `RFC 3339 / ISO-8601` UTC 字符串（例 `2026-11-18T13:00:00Z`），所有枚举使用明确字符串常量。
2. 后端变更接口后立即运行导出命令更新 `contracts/openapi.json`：
   ```powershell
   go run ./cmd/export-openapi -out ../../contracts/openapi.json
   ```
3. Web 端通过 `openapi-typescript` 生成 `src/api/schema.d.ts`；Android 端通过 OpenAPI Generator 生成 `Kotlinx Serialization + Retrofit` DTO，保证任一字段变更在双端编译期暴露。

---

## 2. REST API 端点全量清单（基础路径 `/api/v1`）

### 2.1 健康检查与认证 (`/auth/*`)

| 方法与路径 | 鉴权 | 核心请求字段 | 核心响应字段 | 语义与关键状态码 |
| --- | --- | --- | --- | --- |
| `GET /health` | 公开 | — | `ok`, `version`, `dbStatus` | 数据库连通探针；失败返回 `503` |
| `POST /auth/register` | 公开 | `email`, `displayName`, `password(>=8)`, `timezone` | `accessToken`, `refreshToken`, `user` | 创建账号并初始化默认 `energy_profiles`；邮箱冲突返回 `409` |
| `POST /auth/login` | 公开 | `email`, `password`, `deviceName` | `accessToken`, `refreshToken`, `user` | Argon2id 校验，签发新令牌族 |
| `POST /auth/refresh` | 公开 | `refreshToken` | `accessToken`, `refreshToken` | **令牌轮换**：旧令牌立即作废；若检测到已轮换令牌被重放，吊销整族并返回 `401` |
| `POST /auth/logout` | Bearer | `refreshToken` | `204 No Content` | 吊销当前设备 Refresh Token |
| `GET /auth/me` | Bearer | — | `id`, `email`, `displayName`, `timezone`, `themeMode` | 获取当前账号档案 |
| `PATCH /auth/me` | Bearer | `displayName?`, `timezone?`, `themeMode?` | 更新后的 `user` | 更新偏好并同步多端 |

### 2.2 穿戴生理上报与精力模型 (`/biometrics/*`, `/energy/*`)

| 方法与路径 | 鉴权 | 核心请求字段 | 核心响应字段 | 语义与关键状态码 |
| --- | --- | --- | --- | --- |
| `POST /biometrics/samples/batch` | Bearer | `samples[]`: `{sourceType, metricType, recordedAt, endAt?, numericValue, unit, externalId?, metadata?}` | `acceptedCount`, `deduplicatedCount`, `latestEnergy` | 单批上限 500 条；按 `externalId` 幂等去重；非法物理值返回 `422`；入库后同步刷新最新 `energy_snapshots` |
| `POST /biometrics/replay-seed` | Bearer | `scenario`: `'well_rested' \| 'sleep_deprived' \| 'high_stress'`, `day` | `seededCount`, `energy` | 显式写入带 `sourceType='replay_demo'` 的样本用于测试/演示 |
| `GET /energy/today` | Bearer | Query: `day?` (YYYY-MM-DD, 默认用户当前本地日期) | `score`, `tier`, `dataFreshness`, `drivers`, `hourlyCurve[24]`, `focusShields[]`, `overloadAlert?` | 返回当前电量、可解释贡献因子、24h 曲线与疲劳预警状态 |
| `PUT /energy/profile` | Bearer | `workStartMinute`, `workEndMinute`, `chronotype`, `preferredFocusWindows[]`, `minRecoveryBufferMin` | 更新后的 `EnergyProfile` | 校验 `workEndMinute > workStartMinute` 及窗口不越界 |

### 2.3 个人日程与突发救援 (`/schedule/*`)

| 方法与路径 | 鉴权 | 核心请求字段 | 核心响应字段 | 语义与关键状态码 |
| --- | --- | --- | --- | --- |
| `GET /schedule/items` | Bearer | Query: `from` (RFC3339), `to` (RFC3339), `includeCancelled?` | `items[]`, `baselineVersion` | 按时间窗拉取个人日程，附带基线乐观锁标识 |
| `POST /schedule/items` | Bearer | `title`, `category`, `cognitiveLoad`, `flexibility`, `startAt`, `endAt`, `deadlineAt?`, `reminderMinutes?`, `notes?` | 创建后的 `ScheduleItem` | `endAt <= startAt` 返回 `422`；若与 `hard_locked` 重叠可返回冲突提示字段或 `409`（带 `allowOverlap` 选项） |
| `PATCH /schedule/items/{id}` | Bearer | 任意可更新字段 + `status` | 更新后的 `ScheduleItem` | 团队关联会议仅允许个人标记 `declined/completed` 或备注，修改公开时间需走提案流程 |
| `DELETE /schedule/items/{id}` | Bearer | — | `204 No Content` | 软删除置 `status='cancelled'`（或清理草稿） |
| `POST /schedule/rescue/options` | Bearer | `day`, `triggerReason`, `urgentTask?` (`title`, `durationMinutes`, `cognitiveLoad`, `deadlineAt`) | `baselineVersion`, `options[3]` (`protect_deadline`, `protect_recovery`, `minimize_changes`) | 纯计算不写库；`deadlineAt <= now` 返回 `422` |
| `POST /schedule/rescue/apply` | Bearer | `baselineVersion`, `strategy`, `triggerReason`, `afterItems[]` | `snapshotId`, `appliedItems[]` | 单事务校验 `baselineVersion`（过期返 `409`），落库日程并写 `rescue_snapshots` |
| `POST /schedule/rescue/undo` | Bearer | `snapshotId` | `restoredItems[]` | 仅当 `status='applied'` 时在单事务恢复原日程；已撤销再调返回 `409` |
| `GET /schedule/rescue/history` | Bearer | Query: `limit?` | `snapshots[]` | 查看近期救援采用与撤销记录 |

### 2.4 团队空间与协同排会 (`/workspaces/*`)

| 方法与路径 | 鉴权 | 核心请求字段 | 核心响应字段 | 语义与关键状态码 |
| --- | --- | --- | --- | --- |
| `POST /workspaces` | Bearer | `name`, `description?` | `workspace` (含生成的 `inviteCode`) | 创建工作区并自动将创建者设为 `owner` |
| `GET /workspaces` | Bearer | — | `workspaces[]`（含当前用户角色与 `privacyLevel`） | 列出已加入的团队 |
| `POST /workspaces/join` | Bearer | `inviteCode` | `workspace` | 通过邀请码加入工作区 |
| `PATCH /workspaces/{id}/me` | Bearer | `privacyLevel` (`'busy_only'\|'energy_tier'\|'full_title'`) | 更新后的成员配置 | 修改个人向该团队公开的隐私颗粒度 |
| `GET /workspaces/{id}/availability` | Bearer | Query: `from`, `to` | `members[]`: `{userId, displayName, privacyLevel, slots[], energyTiers[24]?}` | **经服务端严格脱敏投影**：绝不输出私有心率/HRV 与未授权标题 |
| `POST /workspaces/{id}/meetings/recommend` | Bearer | `title`, `durationMinutes`, `cognitiveLoad`, `participantIds[]`, `optionalIds[]`, `searchFrom`, `searchTo`, `respectFocusShields` | `recommendations[0..3]`, `blockingDiagnostics[]` | 求解并打分 Top 3 黄金协同窗口；无解时返回阻断原因诊断 |
| `POST /workspaces/{id}/meetings/confirm` | Bearer | `proposalId?` 或完整提案 + `startAt`, `endAt`, `recommendationMeta` | `proposal`, `createdScheduleCount` | **单事务加锁校验全员冲突**，全员同步落库 `schedule_items` 并触发 WS 通知；冲突返回 `409` |
| `POST /workspaces/{id}/meetings/{proposalId}/respond` | Bearer | `responseStatus`: `'accepted' \| 'declined'` | 更新后的参会状态 | 参会成员回执；拒绝时同步更新对应个人 `schedule_items` 状态 |

---

## 3. 统一错误规范（RFC 9457 Problem Details）

`Huma v2` 默认返回标准 `application/problem+json`，客户端只需按统一结构体解析错误并展示字段级提示：

```json
{
  "type": "https://shixu.app/errors/schedule-conflict",
  "title": "Schedule Conflict",
  "status": 409,
  "detail": "成员 张伟 在 2026-11-19T06:00:00Z~07:00:00Z 已有锁定会议，无法确认预约。",
  "code": "CONFLICT_MEMBER_BUSY",
  "errors": [
    {
      "location": "body.startAt",
      "message": "conflicts with existing locked block",
      "value": "2026-11-19T06:00:00Z"
    }
  ]
}
```

| HTTP 状态码 | 标准业务错误码示例 | 客户端强制处理规则 |
| --- | --- | --- |
| `401` | `UNAUTHORIZED` / `TOKEN_REUSE_DETECTED` | 尝试一次 `/auth/refresh`；刷新失败或检测到重放则清空本地凭证跳转登录，**禁止当作空列表** |
| `403` | `FORBIDDEN_NOT_WORKSPACE_MEMBER` | 提示无权限访问该团队空间 |
| `404` | `NOT_FOUND` | 提示资源不存在或已被移除 |
| `409` | `CONFLICT_MEMBER_BUSY` / `STALE_BASELINE_VERSION` / `ALREADY_REVERTED` | 展示服务端返回的最新冲突详情，提示刷新后重试或重选窗口 |
| `422` | `VALIDATION_FAILED` / `DEADLINE_IN_PAST` | 紧贴具体表单字段标红展示服务端校验提示 |

---

## 4. WebSocket 实时协同协议 (`/api/v1/ws`)

- **鉴权方式**：WebSocket 握手通过首个控制帧鉴权或短效一次性 WS Ticket（避免把长效 JWT 直接暴露在 URL 查询日志里）：前端先调 `POST /auth/ws-ticket` 获取 30 秒一次性票据，再连 `wss://host/api/v1/ws?ticket=...`。
- **心跳与断线重连**：服务端每 30 秒发 `ping`，客户端指数退避重连（1s → 2s → 5s → 15s），重连成功后向服务端重新拉取一次 `/schedule/items` 与 `/energy/today` 补齐离线期间状态。
- **下行事件类型（Server → Client）**：
  - `energy.updated`：Android 穿戴样本批量入库重算后，实时推送到同账号打开的 Web 工作台。
  - `energy.overload_alert`：触发疲劳保护阈值时推送提醒，弹出“查看救援方案”入口。
  - `workspace.meeting_confirmed`：某团队工作区新确认会议时，推送给全部受影响参会者的在线端，直接驱动日历刷新与通知。
  - `workspace.availability_changed`：工作区成员增减日程导致忙碌块变化时，触发团队排会视图局部静默刷新（仅发 `workspaceId` 与 `userId`，不携带隐私详情）。
