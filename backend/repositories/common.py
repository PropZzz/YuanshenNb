"""common persistence; shared transactions stay with their owning domain."""
from __future__ import annotations
from contextlib import contextmanager
from typing import Iterator

from ..database import get_connection
from .errors import RepositoryConflictError
from ..schema import init_db
from datetime import date
from datetime import datetime
from datetime import timezone
from pathlib import Path
import sqlite3


def _now() -> str:
    # 保持既有的“无时区 UTC 字符串”格式（YYYY-MM-DDTHH:MM:SS），
    # 但不再使用 Python 3.12+ 已弃用的 datetime.utcnow()。
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def _parse_date(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        text = value.strip()
        return text or None
    return None


def _parse_time(value: object) -> tuple[int, int]:
    if isinstance(value, dict):
        hour_raw = value.get("hour", 0)
        minute_raw = value.get("minute", 0)
        hour = int(hour_raw) if hour_raw is not None else 0
        minute = int(minute_raw) if minute_raw is not None else 0
        return hour, minute
    return 0, 0


def _first_non_none(payload: dict[str, object], *keys: str, default: object | None = None) -> object | None:
    for key in keys:
        if key in payload and payload[key] is not None:
            return payload[key]
    return default


def _parse_int(value: object | None, default: int) -> int:
    if value is None:
        return default
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return default
        try:
            return int(text)
        except ValueError:
            return default
    return default


def _parse_float(value: object | None, default: float) -> float:
    if value is None:
        return default
    if isinstance(value, bool):
        return float(int(value))
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return default
        try:
            return float(text)
        except ValueError:
            return default
    return default


def _parse_bool(value: object | None, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"true", "1", "yes", "y", "on"}:
            return True
        if text in {"false", "0", "no", "n", "off", ""}:
            return False
    return bool(value)


@contextmanager
def _connect(db_path: str | Path | None = None) -> Iterator[sqlite3.Connection]:
    connection = get_connection(db_path)
    try:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        init_db(db_path, connection)
        yield connection
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, object] | None:
    if row is None:
        return None
    return dict(row)


def _iso_day(value: object | None) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    text = str(value or "").strip()
    if "T" in text:
        return text.split("T", 1)[0]
    if len(text) >= 10:
        return text[:10]
    return text


def _check_global_owner(
    connection: sqlite3.Connection,
    table: str,
    item_id: str,
    user_id: str,
    label: str,
) -> sqlite3.Row | None:
    row = connection.execute(
        f"SELECT user_id FROM {table} WHERE id = ?",
        (item_id,),
    ).fetchone()
    if row is not None and row["user_id"] != user_id:
        raise RepositoryConflictError(f"{label} id already belongs to another user: {item_id}")
    return row
