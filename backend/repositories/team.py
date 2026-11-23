"""team persistence; shared transactions stay with their owning domain."""
from __future__ import annotations

from .common import _check_global_owner
from .common import _connect
from .common import _first_non_none
from .common import _iso_day
from .common import _now
from .errors import RepositoryConflictError
from .errors import RepositoryNotFoundError
from pathlib import Path
import json
import sqlite3
import uuid


def _filter_busy_by_day(busy: object, day: str | None = None) -> list[dict[str, object]]:
    if not isinstance(busy, list):
        return []
    out: list[dict[str, object]] = []
    for item in busy:
        if not isinstance(item, dict):
            continue
        mapped = dict(item)
        if day is not None and _iso_day(mapped.get("day")) != day:
            continue
        out.append(mapped)
    return out


def _team_member_row_to_dict(row: sqlite3.Row, day: str | None = None) -> dict[str, object]:
    try:
        busy = json.loads(row["busy_json"])
    except json.JSONDecodeError:
        busy = []
    return {
        "memberId": row["id"],
        "displayName": row["display_name"],
        "role": row["role"],
        "energy": row["energy"],
        "permission": row["permission"],
        "busy": _filter_busy_by_day(busy, day),
    }


def upsert_team_member(
    db_path: str | Path | None,
    user_id: str,
    payload: dict[str, object],
    member_id: str | None = None,
) -> dict[str, object]:
    resolved_id = str(member_id or _first_non_none(payload, "memberId", "member_id") or uuid.uuid4().hex)
    display_name = str(_first_non_none(payload, "displayName", "display_name", default=""))
    role = str(payload.get("role") or "")
    energy = str(payload.get("energy") or "medium")
    permission = str(payload.get("permission") or "freeBusy")
    busy = payload.get("busy") if isinstance(payload.get("busy"), list) else []
    now = _now()

    with _connect(db_path) as connection:
        _check_global_owner(connection, "team_members", resolved_id, user_id, "Team member")
        connection.execute(
            """
            INSERT INTO team_members (
                id, user_id, display_name, role, energy, permission, busy_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                display_name = excluded.display_name,
                role = excluded.role,
                energy = excluded.energy,
                permission = excluded.permission,
                busy_json = excluded.busy_json,
                updated_at = excluded.updated_at
            WHERE team_members.user_id = excluded.user_id
            """,
            (
                resolved_id,
                user_id,
                display_name,
                role,
                energy,
                permission,
                json.dumps(busy, ensure_ascii=False),
                now,
                now,
            ),
        )
        connection.commit()
        row = connection.execute(
            "SELECT * FROM team_members WHERE id = ? AND user_id = ?",
            (resolved_id, user_id),
        ).fetchone()
        if row is None:
            raise RepositoryNotFoundError(f"Team member not found: {resolved_id}")
        return _team_member_row_to_dict(row)


def list_team_members(
    db_path: str | Path | None,
    user_id: str,
    day: str | None = None,
) -> list[dict[str, object]]:
    with _connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT * FROM team_members
            WHERE user_id = ?
            ORDER BY display_name ASC, id ASC
            """,
            (user_id,),
        ).fetchall()
        return [_team_member_row_to_dict(row, day) for row in rows]


def update_team_member_permission(
    db_path: str | Path | None,
    user_id: str,
    member_id: str,
    permission: str,
) -> dict[str, object]:
    with _connect(db_path) as connection:
        row = connection.execute(
            "SELECT * FROM team_members WHERE id = ? AND user_id = ?",
            (member_id, user_id),
        ).fetchone()
        if row is None:
            if connection.execute("SELECT user_id FROM team_members WHERE id = ?", (member_id,)).fetchone() is not None:
                raise RepositoryConflictError(f"Team member belongs to another user: {member_id}")
            raise RepositoryNotFoundError(f"Team member not found: {member_id}")
        connection.execute(
            """
            UPDATE team_members
            SET permission = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (permission, _now(), member_id, user_id),
        )
        connection.commit()
        updated = connection.execute(
            "SELECT * FROM team_members WHERE id = ? AND user_id = ?",
            (member_id, user_id),
        ).fetchone()
        if updated is None:
            raise RepositoryNotFoundError(f"Team member not found: {member_id}")
        return _team_member_row_to_dict(updated)


def delete_team_member(db_path: str | Path | None, user_id: str, member_id: str) -> None:
    with _connect(db_path) as connection:
        connection.execute(
            "DELETE FROM team_members WHERE id = ? AND user_id = ?",
            (member_id, user_id),
        )
        connection.commit()
