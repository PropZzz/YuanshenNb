"""Existing SQLite schema and idempotent compatibility initialization."""
from __future__ import annotations

from .database import get_connection
from .session_store import initialize_sessions
from pathlib import Path
import sqlite3


def init_db(db_path: str | Path | None = None, connection: sqlite3.Connection | None = None) -> None:
    owns_connection = connection is None
    if connection is None:
        connection = get_connection(db_path)
        connection.row_factory = sqlite3.Row

    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                contact_address TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        initialize_sessions(connection)
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schedules (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                day TEXT,
                title TEXT NOT NULL,
                tag TEXT NOT NULL,
                description TEXT,
                load TEXT,
                goal_id TEXT,
                goal_task_id TEXT,
                height REAL NOT NULL,
                color INTEGER NOT NULL,
                time_hour INTEGER NOT NULL,
                time_minute INTEGER NOT NULL,
                reminder_minutes_before INTEGER NOT NULL,
                repeat TEXT NOT NULL,
                repeat_until TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        schedule_columns = {row[1] for row in connection.execute("PRAGMA table_info(schedules)")}
        for column, default in (("description", None), ("reschedule_flexible", 1), ("hard_locked", 0)):
            if column not in schedule_columns:
                if column == "description":
                    connection.execute("ALTER TABLE schedules ADD COLUMN description TEXT")
                else:
                    connection.execute(f"ALTER TABLE schedules ADD COLUMN {column} INTEGER NOT NULL DEFAULT {default}")
        if owns_connection:
            # Startup migration of settings saved before the exclusivity rule.
            connection.execute("UPDATE schedules SET reschedule_flexible = 0 "
                               "WHERE hard_locked = 1 AND reschedule_flexible = 1")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS microtasks (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                tag TEXT NOT NULL,
                minutes INTEGER NOT NULL,
                priority INTEGER NOT NULL,
                requirement TEXT,
                done INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS task_events (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                task_id TEXT NOT NULL,
                title TEXT NOT NULL,
                tag TEXT NOT NULL,
                load TEXT,
                at TEXT NOT NULL,
                type TEXT NOT NULL,
                planned_minutes INTEGER,
                energy TEXT,
                actual_minutes INTEGER,
                interruptions INTEGER,
                reason TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS settings (
                user_id TEXT PRIMARY KEY,
                scheduling_tuning_json TEXT NOT NULL,
                theme_mode TEXT NOT NULL DEFAULT 'system',
                locale TEXT NOT NULL DEFAULT 'zh_CN',
                favorite_device_id TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        # Keep databases created by older releases readable after the settings
        # contract gained per-user theme and locale fields.
        columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(settings)").fetchall()
        }
        for name, definition in (
            ("theme_mode", "TEXT NOT NULL DEFAULT 'system'"),
            ("locale", "TEXT NOT NULL DEFAULT 'zh_CN'"),
            ("favorite_device_id", "TEXT"),
            # “我的”页卡片偏好（番茄钟节奏、免打扰策略、静默名单等）以 JSON
            # 逐键合并存储，避免为每项偏好各加一列。
            ("preferences_json", "TEXT NOT NULL DEFAULT '{}'"),
        ):
            if name not in columns:
                connection.execute(f"ALTER TABLE settings ADD COLUMN {name} {definition}")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS emotion_checkins (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                at TEXT NOT NULL,
                state TEXT NOT NULL,
                note TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS energy_samples (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                at TEXT NOT NULL,
                level TEXT NOT NULL,
                status TEXT NOT NULL,
                description TEXT NOT NULL,
                battery_percent INTEGER NOT NULL,
                emotion TEXT NOT NULL,
                flow_state TEXT NOT NULL,
                source TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS goals (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                due TEXT NOT NULL,
                priority INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS goal_tasks (
                id TEXT PRIMARY KEY,
                goal_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL,
                load TEXT NOT NULL,
                tag TEXT NOT NULL,
                done INTEGER NOT NULL,
                depends_on_json TEXT NOT NULL,
                position INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(goal_id) REFERENCES goals(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS team_members (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                display_name TEXT NOT NULL,
                role TEXT NOT NULL,
                energy TEXT NOT NULL,
                permission TEXT NOT NULL,
                busy_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS rescue_snapshots (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                day TEXT NOT NULL DEFAULT '',
                strategy TEXT NOT NULL,
                baseline_hash TEXT NOT NULL,
                urgent_json TEXT,
                before_json TEXT NOT NULL,
                after_json TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT '',
                undone_at TEXT,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        # Existing deployments predate the day-scoped rescue API. CREATE IF
        # NOT EXISTS does not add its columns to an already populated table.
        snapshot_columns = {row[1] for row in connection.execute("PRAGMA table_info(rescue_snapshots)")}
        for name, definition in (
            ("day", "TEXT NOT NULL DEFAULT ''"),
            ("urgent_json", "TEXT"),
            ("undone_at", "TEXT"),
        ):
            if name not in snapshot_columns:
                connection.execute(f"ALTER TABLE rescue_snapshots ADD COLUMN {name} {definition}")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sync_changes (
                cursor INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                entity TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                operation TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS reminders (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                schedule_id TEXT NOT NULL,
                enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
                minutes_before INTEGER CHECK(minutes_before BETWEEN 0 AND 10080),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, schedule_id),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS task_event_deletions (
                event_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                schema_version INTEGER NOT NULL DEFAULT 1,
                deleted_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        connection.commit()
    finally:
        if owns_connection:
            connection.close()
