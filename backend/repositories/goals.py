"""goals persistence; shared transactions stay with their owning domain."""
from __future__ import annotations

from .common import _check_global_owner
from .common import _connect
from .common import _first_non_none
from .common import _now
from .common import _parse_bool
from .common import _parse_int
from .errors import RepositoryConflictError
from .errors import RepositoryNotFoundError
from .errors import RepositoryValidationError
from .schedule import upsert_schedule
from pathlib import Path
import json
import sqlite3
import uuid


def _depends_on_list(value: object | None) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item).strip()]


def _goal_task_row_to_dict(row: sqlite3.Row) -> dict[str, object]:
    try:
        depends_on_raw = json.loads(row["depends_on_json"])
    except json.JSONDecodeError:
        depends_on_raw = []
    return {
        "id": row["id"],
        "title": row["title"],
        "durationMinutes": row["duration_minutes"],
        "load": row["load"],
        "tag": row["tag"],
        "done": bool(row["done"]),
        "dependsOn": _depends_on_list(depends_on_raw),
    }


def _list_goal_tasks_on_connection(
    connection: sqlite3.Connection,
    user_id: str,
    goal_id: str,
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT * FROM goal_tasks
        WHERE user_id = ? AND goal_id = ?
        ORDER BY position ASC, created_at ASC, id ASC
        """,
        (user_id, goal_id),
    ).fetchall()
    return [_goal_task_row_to_dict(row) for row in rows]


def _goal_row_to_dict(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
) -> dict[str, object]:
    return {
        "id": row["id"],
        "title": row["title"],
        "due": row["due"],
        "priority": row["priority"],
        "tasks": _list_goal_tasks_on_connection(connection, row["user_id"], row["id"]),
    }


def _normalize_goal_task_payload(payload: dict[str, object], task_id: str | None = None) -> dict[str, object]:
    resolved_id = str(task_id or payload.get("id") or uuid.uuid4().hex)
    return {
        "id": resolved_id,
        "title": str(payload.get("title") or ""),
        "durationMinutes": _parse_int(
            _first_non_none(payload, "durationMinutes", "duration_minutes", default=30),
            30,
        ),
        "load": str(payload.get("load") or "medium"),
        "tag": str(payload.get("tag") or "Goal"),
        "done": _parse_bool(payload.get("done"), False),
        "dependsOn": _depends_on_list(_first_non_none(payload, "dependsOn", "depends_on", default=[])),
    }


def _validate_goal_tasks(tasks: list[dict[str, object]]) -> None:
    ids = [str(task["id"]) for task in tasks]
    if len(ids) != len(set(ids)):
        raise RepositoryValidationError("Goal task IDs must be unique within a goal.")
    id_set = set(ids)
    graph: dict[str, list[str]] = {}
    for task in tasks:
        task_id = str(task["id"])
        deps = _depends_on_list(task.get("dependsOn"))
        if task_id in deps:
            raise RepositoryValidationError("Goal task cannot depend on itself.")
        missing = [dep for dep in deps if dep not in id_set]
        if missing:
            raise RepositoryValidationError(f"Goal task depends on missing task: {missing[0]}")
        graph[task_id] = deps

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node: str) -> None:
        if node in visiting:
            raise RepositoryValidationError("Goal task dependencies must not contain cycles.")
        if node in visited:
            return
        visiting.add(node)
        for dep in graph.get(node, []):
            visit(dep)
        visiting.remove(node)
        visited.add(node)

    for task_id in ids:
        visit(task_id)


def _insert_goal_tasks(
    connection: sqlite3.Connection,
    user_id: str,
    goal_id: str,
    tasks: list[dict[str, object]],
    now: str,
    *,
    validate: bool = True,
    start_position: int = 0,
) -> None:
    if validate:
        _validate_goal_tasks(tasks)
    for offset, task in enumerate(tasks):
        position = start_position + offset
        task_id = str(task["id"])
        existing = connection.execute(
            "SELECT user_id, goal_id FROM goal_tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        if existing is not None and (
            existing["user_id"] != user_id or existing["goal_id"] != goal_id
        ):
            raise RepositoryConflictError(f"Goal task id already exists: {task_id}")
        connection.execute(
            """
            INSERT INTO goal_tasks (
                id, goal_id, user_id, title, duration_minutes, load, tag, done,
                depends_on_json, position, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                duration_minutes = excluded.duration_minutes,
                load = excluded.load,
                tag = excluded.tag,
                done = excluded.done,
                depends_on_json = excluded.depends_on_json,
                position = excluded.position,
                updated_at = excluded.updated_at
            WHERE goal_tasks.user_id = excluded.user_id AND goal_tasks.goal_id = excluded.goal_id
            """,
            (
                task_id,
                goal_id,
                user_id,
                str(task.get("title") or ""),
                _parse_int(task.get("durationMinutes"), 30),
                str(task.get("load") or "medium"),
                str(task.get("tag") or "Goal"),
                1 if _parse_bool(task.get("done"), False) else 0,
                json.dumps(_depends_on_list(task.get("dependsOn")), ensure_ascii=False),
                position,
                now,
                now,
            ),
        )


def list_goals(db_path: str | Path | None, user_id: str) -> list[dict[str, object]]:
    with _connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT * FROM goals
            WHERE user_id = ?
            ORDER BY priority DESC, due ASC, updated_at DESC, id ASC
            """,
            (user_id,),
        ).fetchall()
        return [_goal_row_to_dict(connection, row) for row in rows]


def upsert_goal(
    db_path: str | Path | None,
    user_id: str,
    payload: dict[str, object],
) -> dict[str, object]:
    goal_id = str(payload.get("id") or uuid.uuid4().hex)
    title = str(payload.get("title") or "")
    due = str(payload.get("due") or _now())
    priority = max(1, min(5, _parse_int(payload.get("priority"), 3)))
    tasks_payload = payload.get("tasks")
    tasks = [
        _normalize_goal_task_payload(dict(task))
        for task in tasks_payload
        if isinstance(task, dict)
    ] if isinstance(tasks_payload, list) else []
    now = _now()

    with _connect(db_path) as connection:
        _check_global_owner(connection, "goals", goal_id, user_id, "Goal")
        connection.execute(
            """
            INSERT INTO goals (id, user_id, title, due, priority, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                due = excluded.due,
                priority = excluded.priority,
                updated_at = excluded.updated_at
            WHERE goals.user_id = excluded.user_id
            """,
            (goal_id, user_id, title, due, priority, now, now),
        )
        connection.execute(
            "DELETE FROM goal_tasks WHERE goal_id = ? AND user_id = ?",
            (goal_id, user_id),
        )
        _insert_goal_tasks(connection, user_id, goal_id, tasks, now)
        connection.commit()
        row = connection.execute(
            "SELECT * FROM goals WHERE id = ? AND user_id = ?",
            (goal_id, user_id),
        ).fetchone()
        if row is None:
            raise RepositoryNotFoundError(f"Goal not found: {goal_id}")
        return _goal_row_to_dict(connection, row)


def delete_goal(db_path: str | Path | None, user_id: str, goal_id: str) -> None:
    with _connect(db_path) as connection:
        connection.execute(
            "DELETE FROM goals WHERE id = ? AND user_id = ?",
            (goal_id, user_id),
        )
        connection.commit()


def add_goal_task(
    db_path: str | Path | None,
    user_id: str,
    goal_id: str,
    payload: dict[str, object],
) -> dict[str, object]:
    now = _now()
    with _connect(db_path) as connection:
        goal = connection.execute(
            "SELECT * FROM goals WHERE id = ? AND user_id = ?",
            (goal_id, user_id),
        ).fetchone()
        if goal is None:
            if connection.execute("SELECT user_id FROM goals WHERE id = ?", (goal_id,)).fetchone() is not None:
                raise RepositoryConflictError(f"Goal belongs to another user: {goal_id}")
            raise RepositoryNotFoundError(f"Goal not found: {goal_id}")

        task = _normalize_goal_task_payload(payload)
        existing = connection.execute(
            "SELECT user_id, goal_id FROM goal_tasks WHERE id = ?",
            (task["id"],),
        ).fetchone()
        if existing is not None:
            raise RepositoryConflictError(f"Goal task id already exists: {task['id']}")

        tasks = _list_goal_tasks_on_connection(connection, user_id, goal_id)
        tasks.append(task)
        _validate_goal_tasks(tasks)
        _insert_goal_tasks(
            connection,
            user_id,
            goal_id,
            [task],
            now,
            validate=False,
            start_position=len(tasks) - 1,
        )
        connection.commit()
        return _goal_row_to_dict(connection, goal)


def update_goal_task(
    db_path: str | Path | None,
    user_id: str,
    goal_id: str,
    task_id: str,
    payload: dict[str, object],
) -> dict[str, object]:
    now = _now()
    with _connect(db_path) as connection:
        goal = connection.execute(
            "SELECT * FROM goals WHERE id = ? AND user_id = ?",
            (goal_id, user_id),
        ).fetchone()
        if goal is None:
            if connection.execute("SELECT user_id FROM goals WHERE id = ?", (goal_id,)).fetchone() is not None:
                raise RepositoryConflictError(f"Goal belongs to another user: {goal_id}")
            raise RepositoryNotFoundError(f"Goal not found: {goal_id}")

        existing_task = connection.execute(
            "SELECT user_id, goal_id FROM goal_tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        if existing_task is None or existing_task["goal_id"] != goal_id or existing_task["user_id"] != user_id:
            if existing_task is not None and existing_task["user_id"] != user_id:
                raise RepositoryConflictError(f"Goal task belongs to another user: {task_id}")
            raise RepositoryNotFoundError(f"Goal task not found: {task_id}")

        updated_task = _normalize_goal_task_payload(payload, task_id=task_id)
        tasks = [
            updated_task if task["id"] == task_id else task
            for task in _list_goal_tasks_on_connection(connection, user_id, goal_id)
        ]
        _validate_goal_tasks(tasks)
        connection.execute(
            """
            UPDATE goal_tasks
            SET title = ?, duration_minutes = ?, load = ?, tag = ?, done = ?,
                depends_on_json = ?, updated_at = ?
            WHERE id = ? AND goal_id = ? AND user_id = ?
            """,
            (
                str(updated_task.get("title") or ""),
                _parse_int(updated_task.get("durationMinutes"), 30),
                str(updated_task.get("load") or "medium"),
                str(updated_task.get("tag") or "Goal"),
                1 if _parse_bool(updated_task.get("done"), False) else 0,
                json.dumps(_depends_on_list(updated_task.get("dependsOn")), ensure_ascii=False),
                now,
                task_id,
                goal_id,
                user_id,
            ),
        )
        connection.commit()
        return _goal_row_to_dict(connection, goal)


def schedule_next_goal_task(
    db_path: str | Path | None,
    user_id: str,
    goal_id: str,
    day: str,
    start: dict[str, object],
) -> dict[str, object]:
    with _connect(db_path) as connection:
        goal = connection.execute("SELECT * FROM goals WHERE id = ? AND user_id = ?", (goal_id, user_id)).fetchone()
        if goal is None:
            if connection.execute("SELECT user_id FROM goals WHERE id = ?", (goal_id,)).fetchone() is not None:
                raise RepositoryConflictError(f"Goal belongs to another user: {goal_id}")
            raise RepositoryNotFoundError(f"Goal not found: {goal_id}")
        tasks = _list_goal_tasks_on_connection(connection, user_id, goal_id)
    completed = {str(task["id"]) for task in tasks if task.get("done")}
    selected = next(
        (task for task in tasks if not task.get("done") and set(_depends_on_list(task.get("dependsOn"))).issubset(completed)),
        None,
    )
    if selected is None:
        raise RepositoryValidationError("No executable goal task is available.")
    return upsert_schedule(
        db_path,
        user_id,
        {
            "id": f"goal-schedule-{selected['id']}",
            "day": day,
            "title": selected["title"],
            "tag": selected["tag"],
            "load": selected["load"],
            "goalId": goal_id,
            "goalTaskId": selected["id"],
            "height": int(selected["durationMinutes"]) * 80 / 60,
            "color": 0,
            "time": start,
        },
    )
