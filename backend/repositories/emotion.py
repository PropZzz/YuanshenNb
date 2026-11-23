"""emotion persistence; shared transactions stay with their owning domain."""
from __future__ import annotations

from .common import _check_global_owner
from .common import _connect
from .common import _iso_day
from .common import _now
from pathlib import Path
import sqlite3
import uuid


def _emotion_row_to_dict(row: sqlite3.Row | None) -> dict[str, object] | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "at": row["at"],
        "state": row["state"],
        "note": row["note"],
    }


def default_emotion_status() -> dict[str, object]:
    return {
        "id": None,
        "at": None,
        "state": "stable",
        "note": "No emotion check-in yet; using stable default.",
    }


def upsert_emotion_checkin(
    db_path: str | Path | None,
    user_id: str,
    payload: dict[str, object],
) -> dict[str, object]:
    checkin_id = str(payload.get("id") or uuid.uuid4().hex)
    at = str(payload.get("at") or _now())
    state = str(payload.get("state") or "stable")
    note_value = payload.get("note")
    note = None if note_value is None else str(note_value)
    day = _iso_day(at)
    now = _now()

    with _connect(db_path) as connection:
        _check_global_owner(connection, "emotion_checkins", checkin_id, user_id, "Emotion check-in")
        connection.execute(
            """
            DELETE FROM emotion_checkins
            WHERE user_id = ? AND substr(at, 1, 10) = ? AND id <> ?
            """,
            (user_id, day, checkin_id),
        )
        connection.execute(
            """
            INSERT INTO emotion_checkins (id, user_id, at, state, note, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                at = excluded.at,
                state = excluded.state,
                note = excluded.note,
                updated_at = excluded.updated_at
            WHERE emotion_checkins.user_id = excluded.user_id
            """,
            (checkin_id, user_id, at, state, note, now, now),
        )
        connection.commit()
        row = connection.execute(
            "SELECT * FROM emotion_checkins WHERE id = ? AND user_id = ?",
            (checkin_id, user_id),
        ).fetchone()
        return _emotion_row_to_dict(row) or default_emotion_status()


def list_emotion_checkins(
    db_path: str | Path | None,
    user_id: str,
    day: str,
) -> list[dict[str, object]]:
    with _connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT * FROM emotion_checkins
            WHERE user_id = ? AND substr(at, 1, 10) = ?
            ORDER BY at ASC, id ASC
            """,
            (user_id, day),
        ).fetchall()
        return [_emotion_row_to_dict(row) or {} for row in rows]


def get_current_emotion(
    db_path: str | Path | None,
    user_id: str,
) -> dict[str, object]:
    with _connect(db_path) as connection:
        row = connection.execute(
            """
            SELECT * FROM emotion_checkins
            WHERE user_id = ?
            ORDER BY at DESC, updated_at DESC, id DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
        return _emotion_row_to_dict(row) or default_emotion_status()


def get_latest_emotion_for_day(
    db_path: str | Path | None,
    user_id: str,
    day: str,
) -> dict[str, object] | None:
    with _connect(db_path) as connection:
        row = connection.execute(
            """
            SELECT * FROM emotion_checkins
            WHERE user_id = ? AND substr(at, 1, 10) = ?
            ORDER BY at DESC, updated_at DESC, id DESC
            LIMIT 1
            """,
            (user_id, day),
        ).fetchone()
        return _emotion_row_to_dict(row)
