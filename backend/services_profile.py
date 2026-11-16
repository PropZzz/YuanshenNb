"""“我的”页真实数据汇总：专注统计、履约率、时间结构与数据导出。

所有指标都从该用户在 SQLite 中的既有记录推导（task_events 的 complete
事件、microtasks 的创建/完结时间、energy_samples 的最新采样），不引入
任何虚构的演示数值；没有数据的指标返回 null，由前端显示为“暂无数据”。
"""

from __future__ import annotations

import sqlite3
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from .database import get_connection
from .repositories import (
    default_user_preferences,
    get_current_energy,
    get_user_settings,
    list_task_events,
)
from .session_store import initialize_sessions

# 等级阈值（累计专注小时）与称号；与前端数字工牌共用一套语义。
LEVEL_THRESHOLDS: tuple[tuple[int, int, str], ...] = (
    (1, 0, "初识节律"),
    (2, 5, "节律学徒"),
    (3, 20, "专注新手"),
    (4, 50, "节律稳定者"),
    (5, 100, "心流常客"),
    (6, 200, "心流行者"),
    (7, 400, "心流掌控者"),
    (8, 700, "节律大师"),
    (9, 1000, "时序宗师"),
)

ENERGY_BANDS: tuple[tuple[int, str], ...] = (
    (85, "充盈稳态"),
    (65, "良好运转"),
    (45, "消耗中"),
    (0, "亟需恢复"),
)

WEEKDAY_LABELS = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")


def _parse_at(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _focus_events(events: list[dict[str, object]]) -> list[dict[str, object]]:
    """专注会话以 type=complete 落库（focus.js 结算时写入）。"""
    return [event for event in events if event.get("type") == "complete"]


def _minutes(event: dict[str, object]) -> int:
    actual = event.get("actualMinutes")
    if isinstance(actual, (int, float)) and actual > 0:
        return int(actual)
    planned = event.get("plannedMinutes")
    return int(planned) if isinstance(planned, (int, float)) and planned > 0 else 0


def level_for_hours(hours: float) -> dict[str, object]:
    level, _, title = LEVEL_THRESHOLDS[0]
    for candidate, threshold, candidate_title in LEVEL_THRESHOLDS:
        if hours >= threshold:
            level, title = candidate, candidate_title
    next_threshold = next((threshold for _, threshold, _ in LEVEL_THRESHOLDS if threshold > hours), None)
    return {
        "level": level,
        "title": title,
        "nextLevelHours": next_threshold,
    }


def energy_label(battery_percent: int) -> str:
    for threshold, label in ENERGY_BANDS:
        if battery_percent >= threshold:
            return label
    return ENERGY_BANDS[-1][1]


def build_profile_summary(db_path: str | Path | None, user_id: str) -> dict[str, object]:
    """按卡片顺序组装“我的”页全部指标。"""
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    events = _focus_events(list_task_events(db_path, user_id))
    energy = get_current_energy(db_path, user_id)

    # ── 卡片2a：近 7 天（本周一至周日）专注时长与维持率 ──
    series: list[dict[str, object]] = []
    peak_day: date | None = None
    peak_minutes = 0
    for offset in range(7):
        day = week_start + timedelta(days=offset)
        day_events = [
            event for event in events
            if (parsed := _parse_at(event.get("at"))) is not None and parsed.date() == day
        ]
        minutes = sum(_minutes(event) for event in day_events)
        planned = sum(
            int(event.get("plannedMinutes") or 0)
            for event in day_events
            if isinstance(event.get("plannedMinutes"), (int, float))
        )
        retention = round(min(100.0, minutes / planned * 100), 1) if planned > 0 else None
        series.append({
            "day": day.isoformat(),
            "label": WEEKDAY_LABELS[offset],
            "minutes": minutes,
            "retention": retention,
            "isFuture": day > today,
            "isToday": day == today,
        })
        if minutes > peak_minutes:
            peak_minutes, peak_day = minutes, day

    # 心流波峰：峰值当天最长的一次会话（含起止时间），供横幅展示。
    peak_session: dict[str, object] | None = None
    if peak_day is not None and peak_minutes > 0:
        day_events = [
            event for event in events
            if (parsed := _parse_at(event.get("at"))) is not None and parsed.date() == peak_day
        ]
        longest = max(day_events, key=_minutes, default=None)
        if longest is not None:
            started = _parse_at(longest.get("at"))
            duration = _minutes(longest)
            interruptions = int(longest.get("interruptions") or 0)
            peak_session = {
                "day": peak_day.isoformat(),
                "weekday": WEEKDAY_LABELS[peak_day.weekday()],
                "start": started.strftime("%H:%M") if started else None,
                "end": (started + timedelta(minutes=duration)).strftime("%H:%M")
                if started and duration else None,
                "minutes": duration,
                "interruptions": interruptions,
            }

    # ── 卡片1：连续打卡、累计心流、等级与抗扰指数 ──
    active_days: set[date] = set()
    for event in events:
        parsed = _parse_at(event.get("at"))
        if parsed is not None:
            active_days.add(parsed.date())
    streak_days = 0
    cursor = today if today in active_days else today - timedelta(days=1)
    while cursor in active_days:
        streak_days += 1
        cursor -= timedelta(days=1)

    total_focus_minutes = sum(_minutes(event) for event in events)
    total_focus_hours = round(total_focus_minutes / 60, 1)

    interruptions_total = sum(int(event.get("interruptions") or 0) for event in events)
    session_count = len(events)
    if session_count > 0:
        per_session = interruptions_total / session_count
        resistance_index = round(max(0.0, 1.0 - min(1.0, per_session / 5)), 2)
    else:
        resistance_index = None

    # ── 卡片2b：本周微任务履约率（对比上周） ──
    def microtask_week_stats(start: date) -> dict[str, object]:
        with get_connection(db_path) as connection:
            connection.row_factory = sqlite3.Row
            row = connection.execute(
                """
                SELECT COUNT(*) AS created,
                       COALESCE(SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END), 0) AS completed
                FROM microtasks
                WHERE user_id = ?
                  AND date(created_at) >= ?
                  AND date(created_at) < ?
                """,
                (user_id, start.isoformat(), (start + timedelta(days=7)).isoformat()),
            ).fetchone()
        created = int(row["created"])
        completed = int(row["completed"])
        rate = round(completed / created * 100, 1) if created > 0 else None
        return {"created": created, "completed": completed, "rate": rate}

    this_week = microtask_week_stats(week_start)
    last_week = microtask_week_stats(week_start - timedelta(days=7))
    rate_delta = (
        round(this_week["rate"] - last_week["rate"], 1)
        if this_week["rate"] is not None and last_week["rate"] is not None
        else None
    )

    # ── 卡片2c：近 7 天认知时间结构（按日程标签聚合） ──
    week_events = [
        event for event in events
        if (parsed := _parse_at(event.get("at"))) is not None
        and week_start <= parsed.date() < week_start + timedelta(days=7)
    ]
    tag_minutes: dict[str, int] = {}
    for event in week_events:
        tag = str(event.get("tag") or "未分类").strip() or "未分类"
        tag_minutes[tag] = tag_minutes.get(tag, 0) + _minutes(event)
    structure_total_minutes = sum(tag_minutes.values())
    ranked = sorted(tag_minutes.items(), key=lambda item: item[1], reverse=True)
    structure = [
        {
            "tag": tag,
            "minutes": minutes,
            "percent": round(minutes / structure_total_minutes * 100, 1) if structure_total_minutes else 0.0,
        }
        for tag, minutes in ranked[:5]
    ]
    if len(ranked) > 5:
        other_minutes = sum(minutes for _, minutes in ranked[5:])
        structure.append({
            "tag": "其他",
            "minutes": other_minutes,
            "percent": round(other_minutes / structure_total_minutes * 100, 1) if structure_total_minutes else 0.0,
        })

    battery = energy.get("batteryPercent")
    battery = int(battery) if isinstance(battery, (int, float)) else 0
    return {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "weekStart": week_start.isoformat(),
        # 卡片1 指标条
        "streakDays": streak_days,
        "totalFocusMinutes": total_focus_minutes,
        "totalFocusHours": total_focus_hours,
        "energy": {
            "batteryPercent": battery,
            "label": energy_label(battery),
            "source": energy.get("source"),
            "flowState": energy.get("flowState"),
        },
        "resistanceIndex": resistance_index,
        "level": level_for_hours(total_focus_hours),
        "sessionCount": session_count,
        # 卡片2a
        "weeklySeries": series,
        "peakSession": peak_session,
        # 卡片2b
        "microtaskCycle": {
            "thisWeek": this_week,
            "lastWeek": last_week,
            "rateDelta": rate_delta,
        },
        # 卡片2c
        "timeStructure": {
            "totalMinutes": structure_total_minutes,
            "totalHours": round(structure_total_minutes / 60, 1),
            "segments": structure,
        },
    }


def collect_user_export(db_path: str | Path | None, user_id: str) -> dict[str, object]:
    """汇总该用户的全部业务数据，生成完整 JSON 数据副本。"""
    export: dict[str, object] = {
        "exportedAt": datetime.now().isoformat(timespec="seconds"),
        "format": "ruanchuang.full-export/v1",
        "profile": _user_public_row(db_path, user_id),
        "settings": get_user_settings(db_path, user_id),
    }
    tables = {
        "schedules": "SELECT * FROM schedules WHERE user_id = ? ORDER BY day, time_hour, time_minute",
        "microtasks": "SELECT * FROM microtasks WHERE user_id = ? ORDER BY created_at",
        "taskEvents": "SELECT * FROM task_events WHERE user_id = ? ORDER BY at",
        "goals": "SELECT * FROM goals WHERE user_id = ? ORDER BY due",
        "goalTasks": "SELECT * FROM goal_tasks WHERE user_id = ? ORDER BY goal_id",
        "emotionCheckins": "SELECT * FROM emotion_checkins WHERE user_id = ? ORDER BY day",
        "energySamples": "SELECT * FROM energy_samples WHERE user_id = ? ORDER BY at",
        "teamMembers": "SELECT * FROM team_members WHERE user_id = ? ORDER BY name",
        "syncChanges": "SELECT * FROM sync_changes WHERE user_id = ? ORDER BY cursor",
    }
    with get_connection(db_path) as connection:
        connection.row_factory = sqlite3.Row
        for key, query in tables.items():
            try:
                rows = connection.execute(query, (user_id,)).fetchall()
            except sqlite3.OperationalError:  # 表可能尚未在旧库中建立
                export[key] = []
                continue
            export[key] = [dict(row) for row in rows]
    return export


def _user_public_row(db_path: str | Path | None, user_id: str) -> dict[str, object] | None:
    with get_connection(db_path) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            "SELECT id, contact_address, display_name, created_at FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "contactAddress": row["contact_address"],
            "displayName": row["display_name"],
            "createdAt": row["created_at"],
        }


def build_security_report(db_path: str | Path | None, user_id: str) -> dict[str, object]:
    """账号安全审计：账号信息、活跃会话、数据规模与最近活动。"""
    profile = _user_public_row(db_path, user_id) or {}
    with get_connection(db_path) as connection:
        connection.row_factory = sqlite3.Row
        initialize_sessions(connection)
        now = int(time.time())
        sessions = connection.execute(
            "SELECT created_at, expires_at FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
        active_sessions = [row for row in sessions if int(row["expires_at"]) > now]
        counts = {
            table: connection.execute(
                f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", (user_id,)
            ).fetchone()[0]
            for table in ("schedules", "microtasks", "task_events", "goals")
        }
        last_event = connection.execute(
            "SELECT MAX(at) FROM task_events WHERE user_id = ?", (user_id,)
        ).fetchone()[0]
    return {
        "accountId": profile.get("id"),
        "contactAddress": profile.get("contactAddress"),
        "displayName": profile.get("displayName"),
        "createdAt": profile.get("createdAt"),
        "activeSessions": len(active_sessions),
        "totalSessions": len(sessions),
        "latestSessionCreatedAt": (
            datetime.fromtimestamp(int(active_sessions[0]["created_at"])).isoformat(timespec="seconds")
            if active_sessions else None
        ),
        "dataCounts": counts,
        "lastEventAt": last_event,
        "storage": "SQLite 本地库（服务器侧），按账号隔离",
        "preferences": get_user_settings(db_path, user_id).get("preferences", default_user_preferences()),
    }
