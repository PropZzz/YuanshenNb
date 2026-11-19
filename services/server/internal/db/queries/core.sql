-- 时序智配 V2 核心 sqlc 查询契约
-- 设计原则：
-- 1. 对象级接口在 SQL 层强制绑定 user_id 或校验 workspace_members 成员资格。
-- 2. 排会与救援事务统一按 users.id 升序行锁防空日历幻读与交叉死锁。
-- 3. 时间碰撞查询统一利用 tstzrange GiST 索引。

-- name: LockUsersForScheduling :many
-- 按 UUID 字典序升序锁住参会人/目标用户主表行，彻底消除空日历幻读与多事务交叉死锁
SELECT id
FROM users
WHERE id = ANY(sqlc.arg(user_ids)::uuid[])
ORDER BY id ASC
FOR UPDATE;

-- name: FindHardScheduleConflicts :many
-- 检查指定用户在半开时间区间 [start_at, end_at) 内是否存在不可移动的日程冲突
SELECT id, user_id, title, category, flexibility, start_at, end_at
FROM schedule_items
WHERE user_id = ANY(sqlc.arg(user_ids)::uuid[])
  AND status <> 'cancelled'
  AND (flexibility = 'hard_locked' OR category = 'meeting')
  AND time_range && tstzrange(sqlc.arg(start_at)::timestamptz, sqlc.arg(end_at)::timestamptz, '[)')
ORDER BY user_id, start_at;

-- name: FindScheduleConflictsExcludingIDs :many
-- 救援撤销校验：检查待还原区间是否与快照之外新出现的锁定日程或会议重叠（COALESCE 防空/nil 切片引发 SQL UNKNOWN）
SELECT id, user_id, title, category, flexibility, start_at, end_at
FROM schedule_items
WHERE user_id = sqlc.arg(user_id)
  AND status <> 'cancelled'
  AND (flexibility = 'hard_locked' OR category = 'meeting')
  AND NOT (id = ANY(COALESCE(sqlc.arg(excluded_ids)::uuid[], '{}'::uuid[])))
  AND time_range && tstzrange(sqlc.arg(start_at)::timestamptz, sqlc.arg(end_at)::timestamptz, '[)')
ORDER BY start_at;

-- name: ListUserSchedulesInWindow :many
-- 拉取单个用户在指定时间窗内的日程（个人查询与 48h baselineVersion 计算复用）
SELECT
    id, user_id, workspace_id, meeting_proposal_id,
    title, notes, category, cognitive_load, flexibility, status,
    start_at, end_at, duration_minutes, deadline_at, reminder_minutes,
    created_at, updated_at
FROM schedule_items
WHERE user_id = sqlc.arg(user_id)
  AND (sqlc.arg(include_cancelled)::boolean OR status <> 'cancelled')
  AND time_range && tstzrange(sqlc.arg(from_at)::timestamptz, sqlc.arg(to_at)::timestamptz, '[)')
ORDER BY start_at ASC, id ASC;

-- name: ListTeamMemberSchedulesInWindow :many
-- 批量拉取工作区多个成员在时间窗内的有效日程（由 Go engine 层执行隐私投影脱敏）
SELECT
    id, user_id, category, cognitive_load, flexibility, status,
    start_at, end_at, title
FROM schedule_items
WHERE user_id = ANY(sqlc.arg(user_ids)::uuid[])
  AND status <> 'cancelled'
  AND time_range && tstzrange(sqlc.arg(from_at)::timestamptz, sqlc.arg(to_at)::timestamptz, '[)')
ORDER BY user_id ASC, start_at ASC;

-- name: UpsertBiometricSample :one
-- 穿戴生理样本幂等入库：依赖 (user_id, source_type, metric_type, external_id) 完整唯一索引
INSERT INTO biometric_samples (
    user_id, source_type, metric_type,
    recorded_at, end_at, numeric_value, unit, metadata, external_id
) VALUES (
    sqlc.arg(user_id), sqlc.arg(source_type), sqlc.arg(metric_type),
    sqlc.arg(recorded_at), sqlc.arg(end_at), sqlc.arg(numeric_value),
    sqlc.arg(unit), sqlc.arg(metadata), sqlc.arg(external_id)
)
ON CONFLICT (user_id, source_type, metric_type, external_id) DO NOTHING
RETURNING id;

-- name: ListRecentBiometricsForEnergy :many
-- 拉取 [since_at, until_at] 窗口内（典型 14 天）的生理样本，避免查询历史日时误读未来样本
SELECT
    id, user_id, source_type, metric_type,
    recorded_at, end_at, numeric_value, unit, metadata, external_id
FROM biometric_samples
WHERE user_id = sqlc.arg(user_id)
  AND recorded_at >= sqlc.arg(since_at)::timestamptz
  AND recorded_at <= sqlc.arg(until_at)::timestamptz
ORDER BY recorded_at DESC;

-- name: InsertEnergySnapshot :one
INSERT INTO energy_snapshots (
    user_id, local_day, computed_at, score, tier, data_freshness,
    hourly_curve, drivers, focus_shields, overload_alert, diagnostics
) VALUES (
    sqlc.arg(user_id), sqlc.arg(local_day), sqlc.arg(computed_at),
    sqlc.arg(score), sqlc.arg(tier), sqlc.arg(data_freshness),
    sqlc.arg(hourly_curve), sqlc.arg(drivers), sqlc.arg(focus_shields),
    sqlc.arg(overload_alert), sqlc.arg(diagnostics)
)
RETURNING *;

-- name: GetLatestEnergySnapshotByDay :one
SELECT *
FROM energy_snapshots
WHERE user_id = sqlc.arg(user_id)
  AND local_day = sqlc.arg(local_day)
ORDER BY computed_at DESC
LIMIT 1;

-- name: ListWorkspaceMembersWithProfiles :many
-- 拉取团队工作区成员及其隐私边界与工作时间窗（严禁在此查询返回任何生理原始值）
SELECT
    wm.workspace_id,
    wm.user_id,
    u.display_name,
    u.timezone,
    wm.role,
    wm.privacy_level,
    wm.joined_at,
    COALESCE(ep.work_start_minute, 540) AS work_start_minute,
    COALESCE(ep.work_end_minute, 1110) AS work_end_minute,
    COALESCE(ep.chronotype, 'balanced') AS chronotype,
    COALESCE(ep.preferred_focus_windows, '[{"startMinute":540,"endMinute":720}]'::jsonb) AS preferred_focus_windows,
    COALESCE(ep.min_recovery_buffer_min, 15) AS min_recovery_buffer_min
FROM workspace_members wm
JOIN users u ON u.id = wm.user_id
LEFT JOIN energy_profiles ep ON ep.user_id = wm.user_id
WHERE wm.workspace_id = sqlc.arg(workspace_id)
ORDER BY wm.joined_at ASC, wm.user_id ASC;

-- name: GetWorkspaceMembership :one
SELECT workspace_id, user_id, role, privacy_level, joined_at
FROM workspace_members
WHERE workspace_id = sqlc.arg(workspace_id)
  AND user_id = sqlc.arg(user_id);

-- name: LockRescueSnapshotForUndo :one
SELECT *
FROM rescue_snapshots
WHERE id = sqlc.arg(snapshot_id)
  AND user_id = sqlc.arg(user_id)
FOR UPDATE;

-- name: MarkRescueSnapshotReverted :exec
UPDATE rescue_snapshots
SET status = 'reverted',
    reverted_at = NOW()
WHERE id = sqlc.arg(snapshot_id)
  AND user_id = sqlc.arg(user_id)
  AND status = 'applied';

-- name: DeclineTeamMeetingForUser :execrows
-- 参会人拒绝团队会议时，将个人对应 schedule_items 置为 cancelled 释放 GiST 区间
UPDATE schedule_items
SET status = 'cancelled',
    updated_at = NOW()
WHERE meeting_proposal_id = sqlc.arg(proposal_id)::uuid
  AND user_id = sqlc.arg(user_id)
  AND status <> 'cancelled';

-- name: CancelAllScheduleItemsForMeeting :execrows
-- 会议取消时，将全部参会人关联的 schedule_items 置为 cancelled
UPDATE schedule_items
SET status = 'cancelled',
    updated_at = NOW()
WHERE meeting_proposal_id = sqlc.arg(proposal_id)::uuid
  AND status <> 'cancelled';
