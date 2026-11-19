-- +goose Up
-- 时序智配 V2 PostgreSQL 16 核心表结构
-- 设计原则：
-- 1. 全量使用 TIMESTAMPTZ (UTC) + 整型 duration_minutes，彻底废弃 V1 像素高度换算。
-- 2. 使用 btree_gist + tstzrange 区间生成列支持亚毫秒级日程重叠与空档查询。
-- 3. 团队协作采用真实多用户 Workspace 模型，生理隐私数据严格与团队视图隔离。

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. 用户与认证会话
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    password_hash   TEXT NOT NULL, -- Argon2id
    timezone        TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    theme_mode      TEXT NOT NULL DEFAULT 'system' CHECK (theme_mode IN ('system', 'light', 'dark')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id       UUID NOT NULL,
    token_hash      TEXT NOT NULL UNIQUE,
    device_name     TEXT NOT NULL DEFAULT '',
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id, expires_at DESC);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (family_id);

-- 2. 穿戴设备生理样本与精力模型
CREATE TABLE biometric_samples (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_type     TEXT NOT NULL CHECK (source_type IN ('health_connect', 'ble_gatt', 'replay_demo')),
    metric_type     TEXT NOT NULL CHECK (metric_type IN ('heart_rate', 'hrv_rmssd', 'resting_hr', 'sleep_session', 'sleep_stage', 'active_calories')),
    recorded_at     TIMESTAMPTZ NOT NULL,
    end_at          TIMESTAMPTZ, -- 睡眠分期等区间指标可选
    numeric_value   DOUBLE PRECISION NOT NULL,
    unit            TEXT NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- 强制三路来源提供确定性幂等键：
    -- health_connect: 系统 record UID
    -- ble_gatt: ble:{deviceHash}:{metricType}:{recordedAtEpochSec}
    -- replay_demo: replay:{scenario}:{day}:{metricType}:{idx}
    external_id     TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_at IS NULL OR end_at >= recorded_at)
);

CREATE UNIQUE INDEX uq_biometrics_external
    ON biometric_samples (user_id, source_type, metric_type, external_id);

CREATE INDEX idx_biometrics_lookup
    ON biometric_samples (user_id, metric_type, recorded_at DESC);

CREATE TABLE energy_profiles (
    user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    work_start_minute       INTEGER NOT NULL DEFAULT 540 CHECK (work_start_minute BETWEEN 0 AND 1439),  -- 默认 09:00
    work_end_minute         INTEGER NOT NULL DEFAULT 1110 CHECK (work_end_minute BETWEEN 1 AND 1440),  -- 默认 18:30
    chronotype              TEXT NOT NULL DEFAULT 'balanced' CHECK (chronotype IN ('morning_lark', 'balanced', 'night_owl')),
    preferred_focus_windows JSONB NOT NULL DEFAULT '[{"startMinute":540,"endMinute":720}]'::jsonb,
    hrv_baseline_ms         DOUBLE PRECISION,
    rhr_baseline_bpm        DOUBLE PRECISION,
    min_recovery_buffer_min INTEGER NOT NULL DEFAULT 15 CHECK (min_recovery_buffer_min BETWEEN 5 AND 60),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (work_end_minute > work_start_minute)
);

CREATE TABLE energy_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    local_day       DATE NOT NULL, -- 用户当前时区下的本地日期 (YYYY-MM-DD)
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    score           INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    tier            TEXT NOT NULL CHECK (tier IN ('peak', 'steady', 'strained', 'depleted')),
    data_freshness  TEXT NOT NULL CHECK (data_freshness IN ('live_wearable', 'recent_wearable', 'replay_demo', 'baseline_only')),
    hourly_curve    JSONB NOT NULL, -- 未来 24h 预测点位数组 [{hourStartAt, score, tier}]
    drivers         JSONB NOT NULL DEFAULT '{}'::jsonb, -- 可解释因子（睡眠分、HRV 偏差、会议耗能等）
    focus_shields   JSONB NOT NULL DEFAULT '[]'::jsonb, -- 推荐保护窗口列表
    overload_alert  JSONB, -- 触发疲劳过载预警时的结构体（无预警时为 NULL）
    diagnostics     JSONB NOT NULL DEFAULT '{}'::jsonb -- 同步诊断元数据（lastSyncedAt, primarySource, baselineReadyDays 等）
);

CREATE INDEX idx_energy_snapshots_user ON energy_snapshots (user_id, computed_at DESC);
CREATE INDEX idx_energy_snapshots_user_day ON energy_snapshots (user_id, local_day, computed_at DESC);

-- 3. 团队工作区与隐私共享边界
CREATE TABLE workspaces (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    invite_code     TEXT NOT NULL UNIQUE,
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspace_members (
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    -- 成员向团队暴露的颗粒度：
    -- busy_only: 仅空闲/忙碌；energy_tier: 空闲/忙碌 + 精力保护状态（默认，不泄密）；full_title: 含日程标题
    privacy_level   TEXT NOT NULL DEFAULT 'energy_tier' CHECK (privacy_level IN ('busy_only', 'energy_tier', 'full_title')),
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX idx_workspace_members_user ON workspace_members (user_id);

-- 4. 会议提案（团队协同排会核心实体）
CREATE TABLE meeting_proposals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    organizer_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    duration_minutes    INTEGER NOT NULL CHECK (duration_minutes BETWEEN 15 AND 480),
    cognitive_load      TEXT NOT NULL DEFAULT 'medium' CHECK (cognitive_load IN ('high', 'medium', 'low')),
    status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled')),
    confirmed_start_at  TIMESTAMPTZ,
    confirmed_end_at    TIMESTAMPTZ,
    idempotency_key     TEXT, -- 可选请求幂等键（防弱网确认会议重复提交）
    recommendation_meta JSONB NOT NULL DEFAULT '{}'::jsonb, -- 选中窗口的评分与推荐解释
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (confirmed_end_at IS NULL OR confirmed_end_at > confirmed_start_at),
    CHECK (status <> 'confirmed' OR (confirmed_start_at IS NOT NULL AND confirmed_end_at IS NOT NULL))
);

CREATE UNIQUE INDEX uq_meeting_proposals_idempotency
    ON meeting_proposals (workspace_id, organizer_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_meeting_proposals_workspace_status
    ON meeting_proposals (workspace_id, status, confirmed_start_at DESC);

CREATE TABLE meeting_participants (
    proposal_id     UUID NOT NULL REFERENCES meeting_proposals(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    required        BOOLEAN NOT NULL DEFAULT TRUE,
    response_status TEXT NOT NULL DEFAULT 'pending' CHECK (response_status IN ('pending', 'accepted', 'declined')),
    PRIMARY KEY (proposal_id, user_id)
);

-- 5. 统一日程与任务时间块（取代旧版割裂的 schedules + microtasks + goal_tasks）
CREATE TABLE schedule_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id        UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    meeting_proposal_id UUID REFERENCES meeting_proposals(id) ON DELETE SET NULL,
    title               TEXT NOT NULL,
    notes               TEXT NOT NULL DEFAULT '',
    category            TEXT NOT NULL DEFAULT 'deep_work' CHECK (category IN ('deep_work', 'meeting', 'recovery', 'routine', 'urgent')),
    cognitive_load      TEXT NOT NULL DEFAULT 'medium' CHECK (cognitive_load IN ('high', 'medium', 'low')),
    flexibility         TEXT NOT NULL DEFAULT 'flexible' CHECK (flexibility IN ('hard_locked', 'flexible', 'focus_shield')),
    status              TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
    start_at            TIMESTAMPTZ NOT NULL,
    end_at              TIMESTAMPTZ NOT NULL,
    duration_minutes    INTEGER GENERATED ALWAYS AS (
        GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (end_at - start_at)) / 60)::INTEGER)
    ) STORED,
    time_range          TSTZRANGE GENERATED ALWAYS AS (tstzrange(start_at, end_at, '[)')) STORED,
    deadline_at         TIMESTAMPTZ,
    reminder_minutes    INTEGER NOT NULL DEFAULT 10 CHECK (reminder_minutes >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_at > start_at)
);

CREATE UNIQUE INDEX uq_schedule_items_proposal_user
    ON schedule_items (meeting_proposal_id, user_id)
    WHERE meeting_proposal_id IS NOT NULL;

CREATE INDEX idx_schedule_items_proposal
    ON schedule_items (meeting_proposal_id)
    WHERE meeting_proposal_id IS NOT NULL;

CREATE INDEX idx_schedule_items_user_range
    ON schedule_items USING GIST (user_id, time_range)
    WHERE status <> 'cancelled';

CREATE INDEX idx_schedule_items_user_start
    ON schedule_items (user_id, start_at);

-- 6. 突发重排 / 精力过载救援事务快照（支持原子撤销）
CREATE TABLE rescue_snapshots (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    local_day        DATE NOT NULL,
    baseline_version TEXT NOT NULL,
    option_hash      TEXT NOT NULL,
    strategy         TEXT NOT NULL CHECK (strategy IN ('protect_deadline', 'protect_recovery', 'minimize_changes')),
    trigger_reason   TEXT NOT NULL CHECK (trigger_reason IN ('urgent_task', 'team_meeting_overload', 'wearable_fatigue')),
    before_items     JSONB NOT NULL,
    after_items      JSONB NOT NULL,
    status           TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'reverted')),
    applied_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reverted_at      TIMESTAMPTZ
);

CREATE INDEX idx_rescue_snapshots_user ON rescue_snapshots (user_id, applied_at DESC);

-- +goose Down
DROP TABLE IF EXISTS rescue_snapshots;
DROP TABLE IF EXISTS schedule_items;
DROP TABLE IF EXISTS meeting_participants;
DROP TABLE IF EXISTS meeting_proposals;
DROP TABLE IF EXISTS workspace_members;
DROP TABLE IF EXISTS workspaces;
DROP TABLE IF EXISTS energy_snapshots;
DROP TABLE IF EXISTS energy_profiles;
DROP TABLE IF EXISTS biometric_samples;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;
