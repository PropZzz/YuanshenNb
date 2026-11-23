"""review persistence; shared transactions stay with their owning domain."""
from __future__ import annotations

from .common import _connect
from .common import _first_non_none
from .common import _now
from .common import _parse_float
from pathlib import Path
import json


def default_scheduling_tuning() -> dict[str, object]:
    return {
        "defaultDurationMultiplier": 1.0,
        "tagDurationMultiplier": {},
        "highLoadPenaltyWhenLowEnergy": 1.0,
    }


def get_scheduling_tuning(
    db_path: str | Path | None,
    user_id: str,
) -> dict[str, object]:
    with _connect(db_path) as connection:
        row = connection.execute(
            "SELECT scheduling_tuning_json FROM settings WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return default_scheduling_tuning()
        try:
            raw = json.loads(row["scheduling_tuning_json"])
        except json.JSONDecodeError:
            return default_scheduling_tuning()
        if not isinstance(raw, dict):
            return default_scheduling_tuning()
        return {
            **default_scheduling_tuning(),
            **raw,
            "tagDurationMultiplier": raw.get("tagDurationMultiplier") or {},
        }


def set_scheduling_tuning(
    db_path: str | Path | None,
    user_id: str,
    tuning: dict[str, object],
) -> dict[str, object]:
    normalized = {
        "defaultDurationMultiplier": _parse_float(
            _first_non_none(tuning, "defaultDurationMultiplier", "default_duration_multiplier", default=1.0),
            1.0,
        ),
        "tagDurationMultiplier": tuning.get("tagDurationMultiplier")
        if isinstance(tuning.get("tagDurationMultiplier"), dict)
        else {},
        "highLoadPenaltyWhenLowEnergy": _parse_float(
            _first_non_none(
                tuning,
                "highLoadPenaltyWhenLowEnergy",
                "high_load_penalty_when_low_energy",
                default=1.0,
            ),
            1.0,
        ),
    }
    normalized["tagDurationMultiplier"] = {
        str(key): _parse_float(value, 1.0)
        for key, value in dict(normalized["tagDurationMultiplier"]).items()
    }
    now = _now()
    with _connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO settings (user_id, scheduling_tuning_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                scheduling_tuning_json = excluded.scheduling_tuning_json,
                updated_at = excluded.updated_at
            """,
            (user_id, json.dumps(normalized, ensure_ascii=False), now),
        )
        connection.commit()
    return normalized
