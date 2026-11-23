"""schedule persistence; shared transactions stay with their owning domain."""
from __future__ import annotations

from .common import _check_global_owner
from .common import _connect
from .common import _first_non_none
from .common import _now
from .common import _parse_date
from .common import _parse_float
from .common import _parse_int
from .common import _parse_time
from .errors import RepositoryConflictError
from .errors import RepositoryValidationError
from pathlib import Path
import hashlib
import json
import sqlite3
import uuid


def _schedule_row_to_dict(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": row["id"],
        "day": row["day"],
        "title": row["title"],
        "tag": row["tag"],
        "description": row["description"],
        "load": row["load"],
        "goalId": row["goal_id"],
        "goalTaskId": row["goal_task_id"],
        "height": row["height"],
        "color": row["color"],
        "time": {"hour": row["time_hour"], "minute": row["time_minute"]},
        "reminderMinutesBefore": row["reminder_minutes_before"],
        "repeat": row["repeat"],
        "repeatUntil": row["repeat_until"],
        "rescheduleFlexible": bool(row["reschedule_flexible"]),
        "hardLocked": bool(row["hard_locked"]),
    }


def _save_schedule_constraints(connection: sqlite3.Connection, user_id: str,
                               schedule_id: str, payload: dict[str, object]) -> None:
    """Used by all schedule writes, including sync and snapshot restoration."""
    values = []
    for alias, field in (("rescheduleFlexible", "reschedule_flexible"), ("hardLocked", "hard_locked")):
        value = payload.get(alias, payload.get(field))
        if alias in payload or field in payload:
            if not isinstance(value, bool):
                raise RepositoryValidationError(f"{alias} must be a boolean")
            values.append(int(value))
        else:
            values.append(None)
    if all(value is None for value in values):
        return
    if values == [1, 1]:
        raise RepositoryValidationError("rescheduleFlexible and hardLocked are mutually exclusive")
    if values[0] == 1:
        values[1] = 0
    elif values[1] == 1:
        values[0] = 0
    connection.execute(
        "UPDATE schedules SET reschedule_flexible = COALESCE(?, reschedule_flexible), "
        "hard_locked = COALESCE(?, hard_locked) WHERE id = ? AND user_id = ?",
        (*values, schedule_id, user_id),
    )


def _repair_legacy_schedule_constraints(entry: dict[str, object]) -> dict[str, object]:
    if entry.get("hardLocked") is True and entry.get("rescheduleFlexible", True) is True:
        return {**entry, "rescheduleFlexible": False}
    return entry


def _normalize_schedule_values(
    payload: dict[str, object],
) -> tuple[object, ...]:
    schedule_id = str(_first_non_none(payload, "id", default=uuid.uuid4().hex))
    day = _parse_date(payload.get("day"))
    title = str(_first_non_none(payload, "title", default=""))
    tag = str(_first_non_none(payload, "tag", default=""))
    load_value = _first_non_none(payload, "load")
    load = None if load_value is None else str(load_value)
    goal_id_value = _first_non_none(payload, "goalId", "goal_id")
    goal_task_id_value = _first_non_none(payload, "goalTaskId", "goal_task_id")
    goal_id = None if goal_id_value is None else str(goal_id_value)
    goal_task_id = None if goal_task_id_value is None else str(goal_task_id_value)
    height = _parse_float(_first_non_none(payload, "height", default=60.0), 60.0)
    color = _parse_int(_first_non_none(payload, "color", default=0), 0)
    hour, minute = _parse_time(payload.get("time") or {})
    reminder_minutes_before = _parse_int(
        _first_non_none(payload, "reminderMinutesBefore", "reminder_minutes_before", default=10),
        10,
    )
    repeat = str(_first_non_none(payload, "repeat", default="none"))
    repeat_until = _parse_date(_first_non_none(payload, "repeatUntil", "repeat_until"))
    description_value = payload.get("description")
    description = None if description_value is None else str(description_value)
    return (
        schedule_id,
        day,
        title,
        tag,
        load,
        goal_id,
        goal_task_id,
        height,
        color,
        hour,
        minute,
        reminder_minutes_before,
        repeat,
        repeat_until,
        description,
    )


def upsert_schedule(db_path: str | Path | None, user_id: str, payload: dict[str, object]) -> dict[str, object]:
    (
        schedule_id,
        day,
        title,
        tag,
        load,
        goal_id,
        goal_task_id,
        height,
        color,
        hour,
        minute,
        reminder_minutes_before,
        repeat,
        repeat_until,
        description,
    ) = _normalize_schedule_values(payload)
    now = _now()

    with _connect(db_path) as connection:
        # 同一 ID 属于其他用户时必须报冲突，不能退回 500（UNIQUE 约束异常）。
        existing = _check_global_owner(connection, "schedules", schedule_id, user_id, "Schedule")
        if existing is None:
            try:
                connection.execute(
                    """
                    INSERT INTO schedules (
                        id, user_id, day, title, tag, description, load, goal_id, goal_task_id, height, color,
                        time_hour, time_minute, reminder_minutes_before, repeat, repeat_until,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        schedule_id,
                        user_id,
                        day,
                        title,
                        tag,
                        description,
                        load,
                        goal_id,
                        goal_task_id,
                        height,
                        color,
                        hour,
                        minute,
                        reminder_minutes_before,
                        repeat,
                        repeat_until,
                        now,
                        now,
                    ),
                )
            except sqlite3.IntegrityError as exc:
                raise RepositoryConflictError(
                    f"Schedule id already exists: {schedule_id}"
                ) from exc
        else:
            connection.execute(
                """
                UPDATE schedules
                SET day = ?, title = ?, tag = ?, load = ?, goal_id = ?, goal_task_id = ?, height = ?,
                    color = ?, time_hour = ?, time_minute = ?, reminder_minutes_before = ?, repeat = ?,
                    repeat_until = ?, description = CASE WHEN ? THEN ? ELSE description END, updated_at = ?
                WHERE id = ? AND user_id = ?
                """,
                (
                    day,
                    title,
                    tag,
                    load,
                    goal_id,
                    goal_task_id,
                    height,
                    color,
                    hour,
                    minute,
                    reminder_minutes_before,
                    repeat,
                    repeat_until,
                    "description" in payload,
                    description,
                    now,
                    schedule_id,
                    user_id,
                ),
            )
        _save_schedule_constraints(connection, user_id, schedule_id, payload)
        connection.commit()
        row = connection.execute(
            "SELECT * FROM schedules WHERE id = ? AND user_id = ?",
            (schedule_id, user_id),
        ).fetchone()
        return _schedule_row_to_dict(row)


def upsert_schedules_batch(
    db_path: str | Path | None,
    user_id: str,
    payloads: list[dict[str, object]],
    *, create_only: bool = False,
) -> list[dict[str, object]]:
    now = _now()
    with _connect(db_path) as connection:
        results: list[dict[str, object]] = []
        for payload in payloads:
            schedule_id = str(_first_non_none(payload, "id", default=uuid.uuid4().hex))
            day = _parse_date(payload.get("day"))
            title = str(_first_non_none(payload, "title", default=""))
            tag = str(_first_non_none(payload, "tag", default=""))
            load_value = _first_non_none(payload, "load")
            load = None if load_value is None else str(load_value)
            goal_id_value = _first_non_none(payload, "goalId", "goal_id")
            goal_task_id_value = _first_non_none(payload, "goalTaskId", "goal_task_id")
            height = _parse_float(_first_non_none(payload, "height", default=60.0), 60.0)
            color = _parse_int(_first_non_none(payload, "color", default=0), 0)
            hour, minute = _parse_time(payload.get("time") or {})
            reminder = _parse_int(_first_non_none(payload, "reminderMinutesBefore", "reminder_minutes_before", default=10), 10)
            repeat = str(_first_non_none(payload, "repeat", default="none"))
            repeat_until = _parse_date(_first_non_none(payload, "repeatUntil", "repeat_until"))
            description_value = payload.get("description")
            description = None if description_value is None else str(description_value)
            existing = _check_global_owner(connection, "schedules", schedule_id, user_id, "Schedule")
            if create_only and existing is not None:
                continue
            conflict_action = "DO NOTHING" if create_only else """DO UPDATE SET
                day = excluded.day, title = excluded.title, tag = excluded.tag,
                description = CASE WHEN ? THEN excluded.description ELSE schedules.description END, load = excluded.load,
                goal_id = excluded.goal_id, goal_task_id = excluded.goal_task_id, height = excluded.height,
                color = excluded.color, time_hour = excluded.time_hour, time_minute = excluded.time_minute,
                reminder_minutes_before = excluded.reminder_minutes_before, repeat = excluded.repeat,
                repeat_until = excluded.repeat_until, updated_at = excluded.updated_at
                WHERE schedules.user_id = excluded.user_id"""
            values = (schedule_id, user_id, day, title, tag, description, load,
                      None if goal_id_value is None else str(goal_id_value),
                      None if goal_task_id_value is None else str(goal_task_id_value),
                      height, color, hour, minute, reminder, repeat, repeat_until, now, now)
            cursor = connection.execute(
                f"""
                INSERT INTO schedules (
                    id, user_id, day, title, tag, description, load, goal_id, goal_task_id, height, color,
                    time_hour, time_minute, reminder_minutes_before, repeat, repeat_until,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) {conflict_action}
                """,
                values if create_only else (*values, "description" in payload),
            )
            if create_only and cursor.rowcount == 0:
                _check_global_owner(connection, "schedules", schedule_id, user_id, "Schedule")
                continue
            _save_schedule_constraints(connection, user_id, schedule_id, payload)
            row = connection.execute("SELECT * FROM schedules WHERE id = ? AND user_id = ?", (schedule_id, user_id)).fetchone()
            results.append(_schedule_row_to_dict(row))
        connection.commit()
        return results


def schedule_baseline_hash(db_path: str | Path | None, user_id: str) -> str:
    rows = list_schedules(db_path, user_id)
    encoded = json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def list_schedules(db_path: str | Path | None, user_id: str) -> list[dict[str, object]]:
    with _connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT *
            FROM schedules
            WHERE user_id = ?
            ORDER BY
                CASE WHEN day IS NULL THEN 1 ELSE 0 END,
                day,
                time_hour,
                time_minute,
                updated_at DESC,
                id DESC
            """,
            (user_id,),
        ).fetchall()
        return [_schedule_row_to_dict(row) for row in rows]


def delete_schedule(db_path: str | Path | None, user_id: str, schedule_id: str) -> None:
    with _connect(db_path) as connection:
        connection.execute(
            "DELETE FROM schedules WHERE id = ? AND user_id = ?",
            (schedule_id, user_id),
        )
        connection.commit()


def _insert_schedule_on_connection(
    connection: sqlite3.Connection,
    user_id: str,
    payload: dict[str, object],
    now: str,
) -> dict[str, object]:
    (
        schedule_id,
        day,
        title,
        tag,
        load,
        goal_id,
        goal_task_id,
        height,
        color,
        hour,
        minute,
        reminder_minutes_before,
        repeat,
        repeat_until,
        description,
    ) = _normalize_schedule_values(payload)
    _check_global_owner(connection, "schedules", schedule_id, user_id, "Schedule")
    try:
        connection.execute(
            """
            INSERT INTO schedules (
                id, user_id, day, title, tag, description, load, goal_id, goal_task_id, height, color,
                time_hour, time_minute, reminder_minutes_before, repeat, repeat_until,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                schedule_id,
                user_id,
                day,
                title,
                tag,
                description,
                load,
                goal_id,
                goal_task_id,
                height,
                color,
                hour,
                minute,
                reminder_minutes_before,
                repeat,
                repeat_until,
                now,
                now,
            ),
        )
    except sqlite3.IntegrityError as exc:
        raise RepositoryConflictError(f"Schedule id already exists: {schedule_id}") from exc
    _save_schedule_constraints(connection, user_id, schedule_id, payload)
    row = connection.execute(
        "SELECT * FROM schedules WHERE id = ? AND user_id = ?",
        (schedule_id, user_id),
    ).fetchone()
    return _schedule_row_to_dict(row)


def _delete_schedules_for_day_on_connection(
    connection: sqlite3.Connection,
    user_id: str,
    day_iso: str,
) -> None:
    connection.execute(
        "DELETE FROM schedules WHERE user_id = ? AND day = ?",
        (user_id, day_iso),
    )
