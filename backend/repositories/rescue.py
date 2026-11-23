"""rescue persistence; shared transactions stay with their owning domain."""
from __future__ import annotations

from ..services_rescue import build_rescue_event
from ..services_rescue import compute_baseline_hash
from .common import _connect
from .common import _now
from .common import _parse_date
from .common import _parse_float
from .common import _parse_int
from .common import _parse_time
from .errors import RepositoryConflictError
from .errors import RepositoryNotFoundError
from .events import _upsert_task_event_on_connection
from .schedule import _delete_schedules_for_day_on_connection
from .schedule import _insert_schedule_on_connection
from .schedule import _repair_legacy_schedule_constraints
from .schedule import _save_schedule_constraints
from .schedule import _schedule_row_to_dict
from .schedule import list_schedules
from pathlib import Path
import hashlib
import json
import sqlite3
import uuid


def replace_schedules_with_snapshot(
    db_path: str | Path | None,
    user_id: str,
    before: list[dict[str, object]],
    after: list[dict[str, object]],
    strategy: str,
    baseline_hash: str,
) -> dict[str, object]:
    now = _now()
    snapshot_id = uuid.uuid4().hex
    with _connect(db_path) as connection:
        current = [
            _schedule_row_to_dict(row)
            for row in connection.execute(
                """
                SELECT * FROM schedules WHERE user_id = ?
                ORDER BY CASE WHEN day IS NULL THEN 1 ELSE 0 END, day,
                    time_hour, time_minute, updated_at DESC, id DESC
                """,
                (user_id,),
            ).fetchall()
        ]
        encoded = json.dumps(current, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
        if hashlib.sha256(encoded.encode("utf-8")).hexdigest() != baseline_hash:
            raise RepositoryConflictError("Schedule baseline changed; refresh before applying rescue.")
        connection.execute("DELETE FROM schedules WHERE user_id = ?", (user_id,))
        for payload in after:
            schedule_id = str(payload.get("id") or uuid.uuid4().hex)
            day = _parse_date(payload.get("day"))
            hour, minute = _parse_time(payload.get("time") or {})
            connection.execute(
                """
                INSERT INTO schedules (id, user_id, day, title, tag, description, load, goal_id, goal_task_id, height, color,
                    time_hour, time_minute, reminder_minutes_before, repeat, repeat_until, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (schedule_id, user_id, day, str(payload.get("title") or ""), str(payload.get("tag") or ""), payload.get("description"),
                 payload.get("load"), payload.get("goalId"), payload.get("goalTaskId"),
                 _parse_float(payload.get("height"), 60.0), _parse_int(payload.get("color"), 0), hour, minute,
                 _parse_int(payload.get("reminderMinutesBefore"), 10), str(payload.get("repeat") or "none"),
                 _parse_date(payload.get("repeatUntil")), now, now),
            )
            _save_schedule_constraints(connection, user_id, schedule_id, payload)
        connection.execute(
            "INSERT INTO rescue_snapshots (id, user_id, strategy, baseline_hash, before_json, after_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (snapshot_id, user_id, strategy, baseline_hash, json.dumps(before, ensure_ascii=False), json.dumps(after, ensure_ascii=False), "applied", now, now),
        )
        event_id = uuid.uuid4().hex
        _upsert_task_event_on_connection(
            connection,
            user_id,
            {"id": event_id, "taskId": f"rescue:{snapshot_id}", "title": "日程救援", "tag": "Rescue", "type": "interrupt", "at": now, "reason": f"rescue_accept:{strategy}"},
            now,
        )
        connection.commit()
        return {"snapshotId": snapshot_id, "strategy": strategy, "status": "applied", "entries": after}


def undo_schedule_snapshot(db_path: str | Path | None, user_id: str, snapshot_id: str) -> dict[str, object]:
    now = _now()
    with _connect(db_path) as connection:
        row = connection.execute("SELECT * FROM rescue_snapshots WHERE id = ? AND user_id = ?", (snapshot_id, user_id)).fetchone()
        if row is None:
            raise RepositoryNotFoundError(f"Rescue snapshot not found: {snapshot_id}")
        if row["status"] != "applied":
            raise RepositoryConflictError("Rescue snapshot has already been undone.")
        before = [_repair_legacy_schedule_constraints(entry) for entry in json.loads(row["before_json"])]
        connection.execute("DELETE FROM schedules WHERE user_id = ?", (user_id,))
        for payload in before:
            schedule_id = str(payload.get("id") or uuid.uuid4().hex)
            hour, minute = _parse_time(payload.get("time") or {})
            connection.execute(
                """
                INSERT INTO schedules (id, user_id, day, title, tag, description, load, goal_id, goal_task_id, height, color,
                    time_hour, time_minute, reminder_minutes_before, repeat, repeat_until, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (schedule_id, user_id, _parse_date(payload.get("day")), str(payload.get("title") or ""), str(payload.get("tag") or ""), payload.get("description"),
                 payload.get("load"), payload.get("goalId"), payload.get("goalTaskId"), _parse_float(payload.get("height"), 60.0),
                 _parse_int(payload.get("color"), 0), hour, minute, _parse_int(payload.get("reminderMinutesBefore"), 10),
                 str(payload.get("repeat") or "none"), _parse_date(payload.get("repeatUntil")), now, now),
            )
            _save_schedule_constraints(connection, user_id, schedule_id, payload)
        connection.execute("UPDATE rescue_snapshots SET status = 'undone', updated_at = ? WHERE id = ?", (now, snapshot_id))
        _upsert_task_event_on_connection(
            connection, user_id,
            {"id": uuid.uuid4().hex, "taskId": f"rescue:{snapshot_id}", "title": "撤销日程救援", "tag": "Rescue", "type": "interrupt", "at": now, "reason": f"rescue_undo:{row['strategy']}"},
            now,
        )
        connection.commit()
        return {"snapshotId": snapshot_id, "strategy": row["strategy"], "status": "undone", "entries": before}


def list_rescue_snapshots(db_path: str | Path | None, user_id: str) -> list[dict[str, object]]:
    with _connect(db_path) as connection:
        rows = connection.execute("SELECT * FROM rescue_snapshots WHERE user_id = ? ORDER BY created_at DESC", (user_id,)).fetchall()
        return [{"snapshotId": row["id"], "strategy": row["strategy"], "status": row["status"], "before": json.loads(row["before_json"]), "after": json.loads(row["after_json"]), "baselineHash": row["baseline_hash"]} for row in rows]


def _insert_rescue_snapshot_on_connection(
    connection: sqlite3.Connection,
    snapshot_id: str,
    user_id: str,
    day_iso: str,
    strategy: str,
    baseline_hash: str,
    urgent_json: str | None,
    before_json: str,
    now: str,
) -> None:
    connection.execute(
        """
        INSERT INTO rescue_snapshots (
            id, user_id, day, strategy, baseline_hash, urgent_json, before_json,
            after_json, status, created_at, updated_at, undone_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'active', ?, ?, NULL)
        """,
        # Legacy tables require after_json and updated_at explicitly: their
        # NOT NULL columns do not have the defaults used by new databases.
        (snapshot_id, user_id, day_iso, strategy, baseline_hash, urgent_json, before_json, now, now),
    )


def apply_rescue(
    db_path: str | Path | None,
    user_id: str,
    day_iso: str,
    strategy: str,
    baseline_hash: str,
    after_payloads: list[dict[str, object]],
    event_payload: dict[str, object],
    urgent_payload: dict[str, object] | None,
) -> dict[str, object]:
    """Atomically apply one rescue option for a single day.

    Verifies the baseline hash against the current database rows, then in one
    transaction: replaces the day's schedules, writes the `rescue_accept:`
    task event and saves the pre-apply snapshot. Any failure rolls back every
    write; a stale baseline raises RepositoryConflictError before any write.
    """
    with _connect(db_path) as connection:
        connection.execute("BEGIN IMMEDIATE")
        rows = connection.execute(
            "SELECT * FROM schedules WHERE user_id = ? AND day = ? ORDER BY id",
            (user_id, day_iso),
        ).fetchall()
        before = [_schedule_row_to_dict(row) for row in rows]
        if compute_baseline_hash(before, day_iso) != baseline_hash:
            raise RepositoryConflictError("Schedule baseline changed; regenerate rescue options")
        before_by_id = {str(entry["id"]): entry for entry in before}
        _delete_schedules_for_day_on_connection(connection, user_id, day_iso)
        now = _now()
        for payload in after_payloads:
            if str(payload.get("id")) in before_by_id:
                # Rescue changes time placement, never the user's event notes.
                payload = {**payload, "description": before_by_id[str(payload["id"])].get("description")}
            _insert_schedule_on_connection(connection, user_id, payload, now)
        event_payload = dict(event_payload)
        event_payload.update({"type": "interrupt", "reason": f"rescue_accept:{strategy}", "at": now})
        event_id = _upsert_task_event_on_connection(connection, user_id, event_payload, now)
        snapshot_id = uuid.uuid4().hex
        _insert_rescue_snapshot_on_connection(
            connection,
            snapshot_id,
            user_id,
            day_iso,
            strategy,
            baseline_hash,
            json.dumps(urgent_payload, ensure_ascii=False) if urgent_payload else None,
            json.dumps(before, ensure_ascii=False),
            now,
        )
        connection.commit()
    stored = list_schedules(db_path, user_id)
    return {
        "snapshotId": snapshot_id,
        "entries": [entry for entry in stored if entry.get("day") == day_iso],
        "eventId": event_id,
    }


def undo_rescue(
    db_path: str | Path | None,
    user_id: str,
    snapshot_id: str,
    event_id: str | None,
) -> dict[str, object]:
    """Atomically undo an applied rescue option.

    Restores the pre-apply snapshot in one transaction and writes the
    `rescue_undo:` task event. On failure the current plan is kept and the
    snapshot stays `active`, so the client can retry.
    """
    with _connect(db_path) as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT * FROM rescue_snapshots WHERE id = ?",
            (snapshot_id,),
        ).fetchone()
        if row is None or row["user_id"] != user_id:
            raise RepositoryNotFoundError(f"Rescue snapshot not found: {snapshot_id}")
        if row["status"] != "active":
            raise RepositoryConflictError(f"Rescue snapshot already undone: {snapshot_id}")
        day_iso = str(row["day"])
        strategy = str(row["strategy"])
        try:
            before = [_repair_legacy_schedule_constraints(entry) for entry in json.loads(row["before_json"])]
        except (TypeError, ValueError):
            before = []
        urgent = None
        if row["urgent_json"]:
            try:
                urgent = json.loads(row["urgent_json"])
            except (TypeError, ValueError):
                urgent = None
        _delete_schedules_for_day_on_connection(connection, user_id, day_iso)
        now = _now()
        for payload in before:
            _insert_schedule_on_connection(connection, user_id, payload, now)
        event_payload = build_rescue_event(urgent, event_id, "medium")
        event_payload.update({"type": "interrupt", "reason": f"rescue_undo:{strategy}", "at": now})
        saved_event_id = _upsert_task_event_on_connection(connection, user_id, event_payload, now)
        connection.execute(
            "UPDATE rescue_snapshots SET status = 'undone', undone_at = ? WHERE id = ?",
            (now, snapshot_id),
        )
        connection.commit()
    stored = list_schedules(db_path, user_id)
    return {
        "entries": [entry for entry in stored if entry.get("day") == day_iso],
        "eventId": saved_event_id,
    }
