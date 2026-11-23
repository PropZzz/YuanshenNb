"""sync persistence; shared transactions stay with their owning domain."""
from __future__ import annotations

from .common import _connect
from .common import _now
from .errors import RepositoryValidationError
from .microtasks import upsert_microtask
from .schedule import upsert_schedule
from pathlib import Path
import json
import sqlite3


def record_sync_change(
    connection: sqlite3.Connection,
    user_id: str,
    entity: str,
    entity_id: str,
    operation: str,
    payload: dict[str, object],
) -> int:
    cursor = connection.execute(
        "INSERT INTO sync_changes (user_id, entity, entity_id, operation, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, entity, entity_id, operation, json.dumps(payload, ensure_ascii=False), _now()),
    )
    return int(cursor.lastrowid)


def sync_status(db_path: str | Path | None, user_id: str) -> dict[str, object]:
    with _connect(db_path) as connection:
        latest = connection.execute("SELECT COALESCE(MAX(cursor), 0) FROM sync_changes WHERE user_id = ?", (user_id,)).fetchone()[0]
        count = connection.execute("SELECT COUNT(*) FROM sync_changes WHERE user_id = ?", (user_id,)).fetchone()[0]
        return {"cursor": int(latest), "changeCount": int(count), "pending": 0, "conflicts": 0}


def pull_sync_changes(db_path: str | Path | None, user_id: str, since: int) -> dict[str, object]:
    if since < 0:
        raise RepositoryValidationError("since must be a non-negative cursor")
    with _connect(db_path) as connection:
        rows = connection.execute(
            "SELECT cursor, entity, entity_id, operation, payload_json, created_at FROM sync_changes WHERE user_id = ? AND cursor > ? ORDER BY cursor ASC",
            (user_id, since),
        ).fetchall()
        changes = [
            {"cursor": int(row["cursor"]), "entity": row["entity"], "entityId": row["entity_id"], "operation": row["operation"], "payload": json.loads(row["payload_json"]), "createdAt": row["created_at"]}
            for row in rows
        ]
        latest = max([since, *[change["cursor"] for change in changes]])
        return {"cursor": latest, "changes": changes, "conflicts": []}


def push_sync_changes(db_path: str | Path | None, user_id: str, changes: list[dict[str, object]]) -> dict[str, object]:
    normalized: list[tuple[str, str, str, dict[str, object]]] = []
    for change in changes:
        entity = str(change.get("entity") or "")
        operation = str(change.get("operation") or "upsert")
        payload = change.get("payload") if isinstance(change.get("payload"), dict) else {}
        entity_id = str(payload.get("id") or "")
        if entity not in {"schedule", "microtask"} or operation != "upsert" or not entity_id:
            raise RepositoryValidationError("sync supports upsert changes for schedule or microtask entities with an id")
        normalized.append((entity, operation, entity_id, payload))
    with _connect(db_path) as connection:
        applied: list[str] = []
        for entity, operation, entity_id, payload in normalized:
            if entity == "schedule":
                upsert_schedule(db_path, user_id, payload)
            else:
                upsert_microtask(db_path, user_id, payload)
            record_sync_change(connection, user_id, entity, entity_id, operation, payload)
            applied.append(entity_id)
        connection.commit()
        latest = connection.execute("SELECT COALESCE(MAX(cursor), 0) FROM sync_changes WHERE user_id = ?", (user_id,)).fetchone()[0]
        return {"cursor": int(latest), "applied": applied, "conflicts": []}
