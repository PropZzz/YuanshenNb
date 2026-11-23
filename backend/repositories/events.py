"""events persistence; shared transactions stay with their owning domain."""
from __future__ import annotations

from .common import _connect
from .common import _first_non_none
from .common import _now
from .common import _parse_int
from .errors import TaskEventBatchValidationError
from .errors import TaskEventConflictError
from .errors import RepositoryNotFoundError
from pathlib import Path
import json
import sqlite3
import uuid


_TASK_EVENT_UPSERT_SQL = """
    INSERT INTO task_events (
        id, user_id, task_id, title, tag, load, at, type,
        planned_minutes, energy, actual_minutes, interruptions,
        reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        task_id = excluded.task_id,
        title = excluded.title,
        tag = excluded.tag,
        load = excluded.load,
        at = excluded.at,
        type = excluded.type,
        planned_minutes = excluded.planned_minutes,
        energy = excluded.energy,
        actual_minutes = excluded.actual_minutes,
        interruptions = excluded.interruptions,
        reason = excluded.reason
    WHERE task_events.user_id = excluded.user_id
    """


def _task_event_row_to_dict(row: sqlite3.Row | None) -> dict[str, object] | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "taskId": row["task_id"],
        "title": row["title"],
        "tag": row["tag"],
        "load": row["load"],
        "at": row["at"],
        "type": row["type"],
        "plannedMinutes": row["planned_minutes"],
        "energy": row["energy"],
        "actualMinutes": row["actual_minutes"],
        "interruptions": row["interruptions"],
        "reason": row["reason"],
    }


def _task_event_values(
    payload: dict[str, object],
    now: str,
) -> tuple[object, ...]:
    return (
        str(payload.get("id") or uuid.uuid4()),
        str(_first_non_none(payload, "taskId", "task_id", default="")),
        str(payload.get("title") or ""),
        str(payload.get("tag") or ""),
        _first_non_none(payload, "load"),
        str(payload.get("at") or now),
        str(payload.get("type") or "start"),
        _parse_int(_first_non_none(payload, "plannedMinutes", "planned_minutes"), 0),
        _first_non_none(payload, "energy"),
        _first_non_none(payload, "actualMinutes", "actual_minutes"),
        _first_non_none(payload, "interruptions"),
        _first_non_none(payload, "reason"),
        now,
    )


def _upsert_task_event_on_connection(
    connection: sqlite3.Connection,
    user_id: str,
    payload: dict[str, object],
    now: str,
) -> str:
    values = _task_event_values(payload, now)
    event_id = str(values[0])
    if connection.execute(
        "SELECT 1 FROM task_event_deletions WHERE event_id = ?", (event_id,),
    ).fetchone() is not None:
        raise TaskEventConflictError("Task event id is no longer available")
    existing = connection.execute(
        "SELECT user_id FROM task_events WHERE id = ?",
        (event_id,),
    ).fetchone()
    if existing is not None and existing["user_id"] != user_id:
        raise TaskEventConflictError(f"Task event id already belongs to another user: {event_id}")

    connection.execute(
        _TASK_EVENT_UPSERT_SQL,
        (event_id, user_id, *values[1:]),
    )
    stored = connection.execute(
        "SELECT user_id FROM task_events WHERE id = ?",
        (event_id,),
    ).fetchone()
    if stored is None or stored["user_id"] != user_id:
        raise TaskEventConflictError(f"Task event id already belongs to another user: {event_id}")
    return event_id


def upsert_task_event(
    db_path: str | Path | None,
    user_id: str,
    payload: dict[str, object],
) -> dict[str, object]:
    with _connect(db_path) as connection:
        connection.execute("BEGIN IMMEDIATE")
        event_id = _upsert_task_event_on_connection(
            connection,
            user_id,
            payload,
            _now(),
        )
        row = connection.execute(
            "SELECT * FROM task_events WHERE id = ? AND user_id = ?",
            (event_id, user_id),
        ).fetchone()
        return _task_event_row_to_dict(row) or {}


def upsert_task_events(
    db_path: str | Path | None,
    user_id: str,
    payloads: list[dict[str, object]],
) -> list[dict[str, object]]:
    seen_ids: set[str] = set()
    for payload in payloads:
        event_id = str(payload.get("id") or "")
        if not event_id.strip():
            raise TaskEventBatchValidationError("Task event IDs must not be blank.")
        if event_id in seen_ids:
            raise TaskEventBatchValidationError(
                f"Duplicate task event id in batch: {event_id}"
            )
        seen_ids.add(event_id)

    with _connect(db_path) as connection:
        connection.execute("BEGIN IMMEDIATE")
        for event_id in seen_ids:
            existing = connection.execute(
                "SELECT user_id FROM task_events WHERE id = ?",
                (event_id,),
            ).fetchone()
            if existing is not None and existing["user_id"] != user_id:
                raise TaskEventConflictError(
                    f"Task event id already belongs to another user: {event_id}"
                )

        event_ids = [
            _upsert_task_event_on_connection(connection, user_id, payload, _now())
            for payload in payloads
        ]
        return [
            _task_event_row_to_dict(
                connection.execute(
                    "SELECT * FROM task_events WHERE id = ? AND user_id = ?",
                    (event_id, user_id),
                ).fetchone()
            )
            or {}
            for event_id in event_ids
        ]


def list_task_events(
    db_path: str | Path | None,
    user_id: str,
    from_at: str | None = None,
    to_at: str | None = None,
) -> list[dict[str, object]]:
    clauses = ["user_id = ?"]
    params: list[object] = [user_id]
    if from_at is not None:
        clauses.append("at >= ?")
        params.append(from_at)
    if to_at is not None:
        clauses.append("at < ?")
        params.append(to_at)

    with _connect(db_path) as connection:
        rows = connection.execute(
            f"""
            SELECT * FROM task_events
            WHERE {' AND '.join(clauses)}
            ORDER BY at ASC, id ASC
            """,
            params,
        ).fetchall()
        return [_task_event_row_to_dict(row) or {} for row in rows]


def delete_task_event(db_path: str | Path | None, user_id: str, event_id: str) -> None:
    """Archive the complete stored row and delete it in one serialized transaction."""
    with _connect(db_path) as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT * FROM task_events WHERE id = ? AND user_id = ?", (event_id, user_id),
        ).fetchone()
        if row is None:
            raise RepositoryNotFoundError("Task event not found")
        connection.execute(
            "INSERT INTO task_event_deletions (event_id, user_id, payload_json, schema_version, deleted_at) VALUES (?, ?, ?, 1, ?)",
            (event_id, user_id, json.dumps(dict(row), ensure_ascii=False), _now()),
        )
        connection.execute("DELETE FROM task_events WHERE id = ? AND user_id = ?", (event_id, user_id))
