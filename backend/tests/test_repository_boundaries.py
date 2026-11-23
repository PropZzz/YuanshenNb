"""Protect module boundaries while exercising the original import surface."""
import importlib
import sqlite3

import pytest

from backend import repositories


@pytest.mark.parametrize("domain,name", [
    ("users", "create_user"), ("schedule", "upsert_schedule"),
    ("rescue", "apply_rescue"), ("events", "upsert_task_events"),
    ("microtasks", "upsert_microtask"), ("goals", "upsert_goal"),
    ("team", "upsert_team_member"), ("review", "get_scheduling_tuning"),
    ("settings", "get_user_settings"), ("emotion", "get_current_emotion"),
    ("energy", "get_current_energy"), ("sync", "pull_sync_changes"),
])
def test_legacy_import_uses_the_real_domain_function(domain, name):
    module = importlib.import_module(f"backend.repositories.{domain}")
    assert getattr(repositories, name) is getattr(module, name)
    assert getattr(module, name).__module__ == module.__name__


def test_schema_initialization_remains_idempotent_and_preserves_old_columns(tmp_path):
    from backend.schema import init_db
    database = tmp_path / "old.sqlite3"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE users (id TEXT PRIMARY KEY, contact_address TEXT UNIQUE NOT NULL, "
                           "display_name TEXT NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, "
                           "created_at TEXT NOT NULL, updated_at TEXT NOT NULL)")
        connection.execute("INSERT INTO users VALUES ('old', 'old@example.test', 'Old', 'salt', 'hash', 'then', 'then')")
    init_db(database)
    with sqlite3.connect(database) as connection:
        before = connection.execute("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
    init_db(database)
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name").fetchall() == before
        assert connection.execute("SELECT password_salt,password_hash FROM users WHERE id='old'").fetchone() == ('salt', 'hash')
    assert repositories.init_db is init_db
