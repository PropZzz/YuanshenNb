"""users persistence; shared transactions stay with their owning domain."""
from __future__ import annotations

from ..passwords import hash_password
from ..passwords import needs_upgrade
from ..passwords import new_salt
from ..passwords import verify_password
from .common import _connect
from .common import _now
from .common import _row_to_dict
from .errors import RepositoryNotFoundError
from .errors import RepositoryValidationError
from .review import default_scheduling_tuning
from pathlib import Path
import json
import uuid


def _password_salt() -> str:
    return new_salt()


def _password_hash(password: str, salt: str) -> str:
    return hash_password(password, salt)


def create_user(
    db_path: str | Path | None,
    contact_address: str,
    display_name: str,
    password: str,
) -> dict[str, object]:
    with _connect(db_path) as connection:
        existing = connection.execute(
            "SELECT id FROM users WHERE contact_address = ?",
            (contact_address,),
        ).fetchone()
        if existing is not None:
            raise ValueError("user already exists")

        user_id = uuid.uuid4().hex
        salt = _password_salt()
        password_hash = _password_hash(password, salt)
        now = _now()
        inserted = connection.execute(
            """
            INSERT INTO users (id, contact_address, display_name, password_salt, password_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(contact_address) DO NOTHING
            """,
            (user_id, contact_address, display_name, salt, password_hash, now, now),
        )
        if inserted.rowcount == 0:
            raise ValueError("user already exists")
        connection.execute(
            """
            INSERT INTO settings (user_id, scheduling_tuning_json, updated_at)
            VALUES (?, ?, ?)
            """,
            (user_id, json.dumps(default_scheduling_tuning()), now),
        )
        connection.commit()
        return {
            "id": user_id,
            "contactAddress": contact_address,
            "displayName": display_name,
            "passwordSalt": salt,
            "passwordHash": password_hash,
        }


def find_user_by_account(db_path: str | Path | None, contact_address: str) -> dict[str, object] | None:
    with _connect(db_path) as connection:
        row = connection.execute(
            """
            SELECT
                id,
                contact_address AS contactAddress,
                display_name AS displayName,
                password_salt AS passwordSalt,
                password_hash AS passwordHash
            FROM users
            WHERE contact_address = ?
            """,
            (contact_address,),
        ).fetchone()
        return _row_to_dict(row)


def find_user_by_id(db_path: str | Path | None, user_id: str) -> dict[str, object] | None:
    with _connect(db_path) as connection:
        row = connection.execute(
            """
            SELECT
                id,
                contact_address AS contactAddress,
                display_name AS displayName,
                password_salt AS passwordSalt,
                password_hash AS passwordHash
            FROM users
            WHERE id = ?
            """,
            (user_id,),
        ).fetchone()
        return _row_to_dict(row)


def verify_user(db_path: str | Path | None, contact_address: str, password: str) -> dict[str, object] | None:
    user = find_user_by_account(db_path, contact_address)
    if user is None:
        # Same current-cost KDF work as a wrong password on a modern account.
        verify_password(password, "", "")
        return None
    if not verify_password(password, str(user["passwordSalt"]), str(user["passwordHash"])):
        return None
    if needs_upgrade(str(user["passwordHash"])):
        salt = _password_salt()
        encoded = _password_hash(password, salt)
        with _connect(db_path) as connection:
            connection.execute(
                "UPDATE users SET password_salt = ?, password_hash = ?, updated_at = ? "
                "WHERE id = ? AND password_salt = ? AND password_hash = ?",
                (salt, encoded, _now(), user["id"], user["passwordSalt"], user["passwordHash"]),
            )
            connection.commit()
        # A concurrent credential change must not authorize a stale password.
        current = find_user_by_account(db_path, contact_address)
        if current is None or not verify_password(password, str(current["passwordSalt"]), str(current["passwordHash"])):
            return None
        return current
    return user


def update_user_profile(
    db_path: str | Path | None,
    user_id: str,
    display_name: str | None = None,
) -> dict[str, object]:
    with _connect(db_path) as connection:
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise RepositoryNotFoundError(f"User not found: {user_id}")
        if display_name is not None:
            normalized = display_name.strip()
            if not normalized:
                raise RepositoryValidationError("displayName must not be blank")
            connection.execute(
                "UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?",
                (normalized, _now(), user_id),
            )
        connection.commit()
        return find_user_by_id(db_path, user_id) or {}


def user_diagnostics(db_path: str | Path | None, user_id: str) -> dict[str, object]:
    tables = (
        "schedules",
        "microtasks",
        "task_events",
        "emotion_checkins",
        "energy_samples",
        "goals",
        "goal_tasks",
        "team_members",
    )
    with _connect(db_path) as connection:
        counts = {
            table: int(
                connection.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", (user_id,)
                ).fetchone()[0]
            )
            for table in tables
        }
        last_event = connection.execute(
            "SELECT MAX(created_at) FROM task_events WHERE user_id = ?", (user_id,)
        ).fetchone()[0]
        return {"counts": counts, "lastEventAt": last_event, "database": "sqlite"}
