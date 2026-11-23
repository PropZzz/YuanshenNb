"""energy persistence; shared transactions stay with their owning domain."""
from __future__ import annotations

from .common import _check_global_owner
from .common import _connect
from .common import _first_non_none
from .common import _now
from .common import _parse_int
from pathlib import Path
import sqlite3
import uuid


def _energy_row_to_dict(row: sqlite3.Row | None) -> dict[str, object] | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "at": row["at"],
        "level": row["level"],
        "status": row["status"],
        "description": row["description"],
        "batteryPercent": row["battery_percent"],
        "emotion": row["emotion"],
        "flowState": row["flow_state"],
        "source": row["source"],
    }


def default_energy_status() -> dict[str, object]:
    return {
        "id": None,
        "at": None,
        "level": "medium",
        "status": "flow",
        "description": "No recent energy sample; using balanced default.",
        "batteryPercent": 85,
        "emotion": "stable",
        "flowState": "normal",
        "source": "default",
    }


def upsert_energy_sample(
    db_path: str | Path | None,
    user_id: str,
    payload: dict[str, object],
) -> dict[str, object]:
    sample_id = str(payload.get("id") or uuid.uuid4().hex)
    at = str(payload.get("at") or _now())
    level = str(payload.get("level") or "medium")
    status_value = str(payload.get("status") or "flow")
    description = str(payload.get("description") or "")
    battery_percent = _parse_int(
        _first_non_none(payload, "batteryPercent", "battery_percent", default=85),
        85,
    )
    emotion = str(payload.get("emotion") or "stable")
    flow_state = str(_first_non_none(payload, "flowState", "flow_state", default="normal"))
    source = str(payload.get("source") or "manual")
    now = _now()

    with _connect(db_path) as connection:
        _check_global_owner(connection, "energy_samples", sample_id, user_id, "Energy sample")
        connection.execute(
            """
            INSERT INTO energy_samples (
                id, user_id, at, level, status, description, battery_percent,
                emotion, flow_state, source, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                at = excluded.at,
                level = excluded.level,
                status = excluded.status,
                description = excluded.description,
                battery_percent = excluded.battery_percent,
                emotion = excluded.emotion,
                flow_state = excluded.flow_state,
                source = excluded.source,
                updated_at = excluded.updated_at
            WHERE energy_samples.user_id = excluded.user_id
            """,
            (
                sample_id,
                user_id,
                at,
                level,
                status_value,
                description,
                battery_percent,
                emotion,
                flow_state,
                source,
                now,
                now,
            ),
        )
        connection.commit()
        row = connection.execute(
            "SELECT * FROM energy_samples WHERE id = ? AND user_id = ?",
            (sample_id, user_id),
        ).fetchone()
        return _energy_row_to_dict(row) or default_energy_status()


def get_current_energy(
    db_path: str | Path | None,
    user_id: str,
) -> dict[str, object]:
    with _connect(db_path) as connection:
        row = connection.execute(
            """
            SELECT * FROM energy_samples
            WHERE user_id = ?
            ORDER BY at DESC, updated_at DESC, id DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
        return _energy_row_to_dict(row) or default_energy_status()


def get_energy_profile(
    db_path: str | Path | None,
    user_id: str,
) -> dict[str, object]:
    with _connect(db_path) as connection:
        aggregate = connection.execute(
            """
            SELECT COUNT(*) AS sample_count, AVG(battery_percent) AS average_battery_percent
            FROM energy_samples
            WHERE user_id = ?
            """,
            (user_id,),
        ).fetchone()
        latest = connection.execute(
            """
            SELECT level FROM energy_samples
            WHERE user_id = ?
            ORDER BY at DESC, updated_at DESC, id DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
        count = int(aggregate["sample_count"] if aggregate else 0)
        average = aggregate["average_battery_percent"] if aggregate else None
        return {
            "sampleCount": count,
            "latestLevel": latest["level"] if latest is not None else "medium",
            "averageBatteryPercent": int(round(float(average))) if average is not None else 85,
        }
