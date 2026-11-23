"""microtasks persistence; shared transactions stay with their owning domain."""
from __future__ import annotations

from .common import _check_global_owner
from .common import _connect
from .common import _first_non_none
from .common import _now
from .common import _parse_bool
from .common import _parse_float
from .common import _parse_int
from .common import _parse_time
from .errors import RepositoryConflictError
from .errors import RepositoryNotFoundError
from .errors import RepositoryValidationError
from .schedule import upsert_schedules_batch
from pathlib import Path
import sqlite3
import uuid


def _microtask_row_to_dict(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": row["id"],
        "title": row["title"],
        "tag": row["tag"],
        "minutes": row["minutes"],
        "priority": row["priority"],
        "requirement": row["requirement"],
        "done": bool(row["done"]),
    }


def upsert_microtask(db_path: str | Path | None, user_id: str, payload: dict[str, object]) -> dict[str, object]:
    microtask_id = str(_first_non_none(payload, "id", default=uuid.uuid4().hex))
    title = str(_first_non_none(payload, "title", default=""))
    tag = str(_first_non_none(payload, "tag", default=""))
    minutes = _parse_int(_first_non_none(payload, "minutes", default=0), 0)
    priority = _parse_int(_first_non_none(payload, "priority", default=3), 3)
    priority = max(1, min(5, priority))
    requirement_value = _first_non_none(payload, "requirement")
    requirement = None if requirement_value is None else str(requirement_value)
    done = 1 if _parse_bool(_first_non_none(payload, "done", default=False), False) else 0
    now = _now()

    with _connect(db_path) as connection:
        # 与日程一致：跨用户复用同一微任务 ID 必须得到 409，而不是 UNIQUE 约束 500。
        existing = _check_global_owner(connection, "microtasks", microtask_id, user_id, "Microtask")
        if existing is None:
            try:
                connection.execute(
                    """
                    INSERT INTO microtasks (
                        id, user_id, title, tag, minutes, priority, requirement, done, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (microtask_id, user_id, title, tag, minutes, priority, requirement, done, now, now),
                )
            except sqlite3.IntegrityError as exc:
                raise RepositoryConflictError(
                    f"Microtask id already exists: {microtask_id}"
                ) from exc
        else:
            connection.execute(
                """
                UPDATE microtasks
                SET title = ?, tag = ?, minutes = ?, priority = ?, requirement = ?, done = ?, updated_at = ?
                WHERE id = ? AND user_id = ?
                """,
                (title, tag, minutes, priority, requirement, done, now, microtask_id, user_id),
            )
        connection.commit()
        row = connection.execute(
            "SELECT * FROM microtasks WHERE id = ? AND user_id = ?",
            (microtask_id, user_id),
        ).fetchone()
        return _microtask_row_to_dict(row)


def list_microtasks(db_path: str | Path | None, user_id: str) -> list[dict[str, object]]:
    with _connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT *
            FROM microtasks
            WHERE user_id = ?
            ORDER BY done ASC, priority DESC, updated_at DESC, id DESC
            """,
            (user_id,),
        ).fetchall()
        return [_microtask_row_to_dict(row) for row in rows]


def delete_microtask(db_path: str | Path | None, user_id: str, microtask_id: str) -> None:
    with _connect(db_path) as connection:
        connection.execute(
            "DELETE FROM microtasks WHERE id = ? AND user_id = ?",
            (microtask_id, user_id),
        )
        connection.commit()


def batch_complete_microtasks(
    db_path: str | Path | None,
    user_id: str,
    task_ids: list[str],
    done: bool = True,
) -> list[dict[str, object]]:
    normalized = list(dict.fromkeys(str(task_id).strip() for task_id in task_ids if str(task_id).strip()))
    with _connect(db_path) as connection:
        for task_id in normalized:
            row = connection.execute("SELECT user_id FROM microtasks WHERE id = ?", (task_id,)).fetchone()
            if row is None:
                raise RepositoryNotFoundError(f"Microtask not found: {task_id}")
            if row["user_id"] != user_id:
                raise RepositoryConflictError(f"Microtask belongs to another user: {task_id}")
        now = _now()
        for task_id in normalized:
            connection.execute("UPDATE microtasks SET done = ?, updated_at = ? WHERE id = ? AND user_id = ?", (1 if done else 0, now, task_id, user_id))
        connection.commit()
        return [_microtask_row_to_dict(connection.execute("SELECT * FROM microtasks WHERE id = ? AND user_id = ?", (task_id, user_id)).fetchone()) for task_id in normalized]


def import_microtasks(
    db_path: str | Path | None,
    user_id: str,
    text: str,
) -> list[dict[str, object]]:
    payloads: list[dict[str, object]] = []
    for line in text.splitlines():
        title = line.strip()
        if not title:
            continue
        tag = "Imported"
        if " #" in title:
            title, tag = title.rsplit(" #", 1)
            title = title.strip()
            tag = tag.strip() or "Imported"
        payloads.append({"title": title, "tag": tag, "minutes": 15, "priority": 3, "done": False})
    if not payloads:
        raise RepositoryValidationError("Import text must contain at least one task.")
    results: list[dict[str, object]] = []
    with _connect(db_path) as connection:
        now = _now()
        for payload in payloads:
            task_id = uuid.uuid4().hex
            connection.execute("INSERT INTO microtasks (id, user_id, title, tag, minutes, priority, requirement, done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (task_id, user_id, payload["title"], payload["tag"], 15, 3, None, 0, now, now))
            results.append(_microtask_row_to_dict(connection.execute("SELECT * FROM microtasks WHERE id = ? AND user_id = ?", (task_id, user_id)).fetchone()))
        connection.commit()
    return results


def batch_schedule_microtasks(
    db_path: str | Path | None,
    user_id: str,
    task_ids: list[str],
    day: str,
    start: dict[str, object],
) -> list[dict[str, object]]:
    tasks = []
    with _connect(db_path) as connection:
        for task_id in dict.fromkeys(task_ids):
            row = connection.execute("SELECT * FROM microtasks WHERE id = ?", (task_id,)).fetchone()
            if row is None:
                raise RepositoryNotFoundError(f"Microtask not found: {task_id}")
            if row["user_id"] != user_id:
                raise RepositoryConflictError(f"Microtask belongs to another user: {task_id}")
            tasks.append(dict(row))
    start_minute = _parse_time(start)[0] * 60 + _parse_time(start)[1]
    payloads: list[dict[str, object]] = []
    for task in tasks:
        payloads.append({
            "id": f"microtask-schedule-{task['id']}",
            "day": day,
            "title": task["title"],
            "tag": task["tag"],
            "goalTaskId": task["id"],
            "height": _parse_float(task["minutes"], 15) * 80 / 60,
            "color": 0,
            "time": {"hour": start_minute // 60, "minute": start_minute % 60},
        })
        start_minute += int(task["minutes"])
    return upsert_schedules_batch(db_path, user_id, payloads)
