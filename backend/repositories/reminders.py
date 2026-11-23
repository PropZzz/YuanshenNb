"""Reminder configuration; effective times always come from the current schedule."""

from calendar import monthrange
from datetime import date, datetime, time, timedelta
from pathlib import Path
import sqlite3
import uuid

from .common import _connect, _now
from .errors import RepositoryConflictError, RepositoryNotFoundError


_SELECT = """
    SELECT r.*, s.id AS linked_id, s.day, s.time_hour, s.time_minute,
           s.reminder_minutes_before, s.repeat, s.repeat_until
    FROM reminders r LEFT JOIN schedules s ON s.id = r.schedule_id AND s.user_id = r.user_id
    WHERE r.user_id = ?
"""


def _occurs_on(anchor: date | None, day: date, repeat: str, until: date | None) -> bool:
    if anchor is None:
        return True  # Existing floating schedules occur on each explicitly selected day.
    if day < anchor or (until is not None and day > until):
        return False
    if repeat == "none":
        return day == anchor
    if repeat == "daily":
        return True
    if repeat == "weekly":
        return (day - anchor).days % 7 == 0
    # Match calendar/focus: Jan 31 -> Feb 28 -> Mar 28, rather than Mar 31.
    occurrence_day = anchor.day
    months = (day.year - anchor.year) * 12 + day.month - anchor.month
    for step in range(1, months + 1):
        year, month = divmod(anchor.year * 12 + anchor.month - 1 + step, 12)
        occurrence_day = min(occurrence_day, monthrange(year, month + 1)[1])
        if occurrence_day <= 28:
            break
    return day.day == occurrence_day


def _project(row: sqlite3.Row, day: date | None = None) -> dict[str, object]:
    offset = row["minutes_before"]
    inherited = offset is None
    if inherited:
        offset = row["reminder_minutes_before"]
    result = {
        "id": row["id"], "scheduleId": row["schedule_id"], "enabled": bool(row["enabled"]),
        "minutesBefore": offset if isinstance(offset, int) and 0 <= offset <= 10080 else None,
        "usesScheduleOffset": inherited,
        "status": "ready", "triggerAtLocal": None, "unavailableReason": None,
    }
    if not row["enabled"]:
        result["status"] = "disabled"
    elif row["linked_id"] is None:
        result.update(status="unavailable", unavailableReason="scheduleMissing")
    elif row["repeat"] not in {"none", "daily", "weekly", "monthly"}:
        result.update(status="unavailable", unavailableReason="unsupportedRepeat")
    else:
        try:
            anchor = date.fromisoformat(row["day"]) if row["day"] is not None else None
            until = date.fromisoformat(row["repeat_until"]) if row["repeat_until"] is not None else None
            clock = time(row["time_hour"], row["time_minute"])
            if not isinstance(offset, int) or not 0 <= offset <= 10080:
                raise ValueError("Invalid reminder offset")
            target = day or anchor
            if target is None:
                result.update(status="unavailable", unavailableReason="dateRequired")
            elif not _occurs_on(anchor, target, row["repeat"], until):
                result["status"] = "notScheduled"
            else:
                start = datetime.combine(target, clock)
                result["triggerAtLocal"] = (start - timedelta(minutes=offset)).isoformat()
        except (ValueError, TypeError, OverflowError):
            result.update(status="unavailable", unavailableReason="invalidSchedule")
    return result


def list_reminders(db_path: str | Path | None, user_id: str, day: date | None = None) -> list[dict[str, object]]:
    with _connect(db_path) as connection:
        return [_project(row, day) for row in connection.execute(_SELECT + " ORDER BY r.id", (user_id,))]


def _find(connection: sqlite3.Connection, user_id: str, reminder_id: str) -> sqlite3.Row:
    row = connection.execute(_SELECT + " AND r.id = ?", (user_id, reminder_id)).fetchone()
    if row is None:
        raise RepositoryNotFoundError("Reminder not found")
    return row


def create_reminder(
    db_path: str | Path | None, user_id: str, schedule_id: str,
    *, enabled: bool = True, minutes_before: int | None = None,
) -> dict[str, object]:
    with _connect(db_path) as connection:
        connection.execute("BEGIN IMMEDIATE")
        owned = connection.execute(
            "SELECT 1 FROM schedules WHERE id = ? AND user_id = ?", (schedule_id, user_id),
        ).fetchone()
        if owned is None:
            raise RepositoryNotFoundError("Schedule not found")
        existing = connection.execute(
            "SELECT 1 FROM reminders WHERE user_id = ? AND schedule_id = ?", (user_id, schedule_id),
        ).fetchone()
        if existing is not None:
            raise RepositoryConflictError("Reminder already exists for this schedule")
        reminder_id = uuid.uuid4().hex
        now = _now()
        connection.execute(
            """INSERT INTO reminders (id, user_id, schedule_id, enabled, minutes_before, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (reminder_id, user_id, schedule_id, int(enabled), minutes_before, now, now),
        )
        return _project(_find(connection, user_id, reminder_id))


def update_reminder(
    db_path: str | Path | None, user_id: str, reminder_id: str,
    *, enabled: bool = True, minutes_before: int | None = None,
) -> dict[str, object]:
    with _connect(db_path) as connection:
        connection.execute("BEGIN IMMEDIATE")
        _find(connection, user_id, reminder_id)
        connection.execute(
            "UPDATE reminders SET enabled = ?, minutes_before = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (int(enabled), minutes_before, _now(), reminder_id, user_id),
        )
        return _project(_find(connection, user_id, reminder_id))


def delete_reminder(db_path: str | Path | None, user_id: str, reminder_id: str) -> None:
    with _connect(db_path) as connection:
        cursor = connection.execute("DELETE FROM reminders WHERE id = ? AND user_id = ?", (reminder_id, user_id))
        if cursor.rowcount != 1:
            raise RepositoryNotFoundError("Reminder not found")
