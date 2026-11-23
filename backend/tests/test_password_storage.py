"""Credential compatibility at the public repository and HTTP boundaries."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import sqlite3

import pytest
from starlette.testclient import TestClient

from backend.main import create_app
from backend.repositories import create_user, init_db, verify_user


def stored(database):
    with sqlite3.connect(database) as connection:
        return connection.execute(
            "SELECT id, password_salt, password_hash FROM users WHERE contact_address = ?",
            ("legacy@example.test",),
        ).fetchone()


def legacy_database(database):
    init_db(database)
    salt = "legacy-uuid-salt"
    digest = hashlib.sha256(f"{salt}:old-password".encode()).hexdigest()
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("legacy-id", "legacy@example.test", "Legacy", salt, digest, "2026-01-01", "2026-01-01"),
        )
    return stored(database)


def test_new_registration_uses_salted_pbkdf2_and_keeps_http_contract(tmp_path):
    database = tmp_path / "new.sqlite3"
    with TestClient(create_app(database)) as client:
        response = client.post("/auth/register", json={
            "contactAddress": "legacy@example.test", "displayName": "New", "password": "new-password",
        })
        assert response.status_code == 200
        assert set(response.json()) == {"accessToken", "tokenType", "user"}
        assert set(response.json()["user"]) == {"id", "contactAddress", "displayName"}
        first = stored(database)
        assert first[2].startswith("pbkdf2_sha256$600000$")
        assert len(first[1]) >= 32
        assert "new-password" not in response.text
        assert client.post("/auth/login", json={
            "contactAddress": "legacy@example.test", "password": "new-password",
        }).status_code == 200
        assert client.post("/auth/login", json={
            "contactAddress": "legacy@example.test", "password": "wrong-password",
        }).status_code == 401
        create_user(database, "other@example.test", "Other", "new-password")
        with sqlite3.connect(database) as connection:
            salts = connection.execute("SELECT password_salt FROM users").fetchall()
        assert salts[0] != salts[1]


def test_legacy_wrong_password_never_changes_credentials(tmp_path):
    database = tmp_path / "wrong.sqlite3"
    before = legacy_database(database)
    assert verify_user(database, "legacy@example.test", "wrong-password") is None
    assert stored(database) == before


def test_legacy_login_upgrades_once_and_preserves_existing_session_and_schedule(tmp_path):
    database = tmp_path / "legacy.sqlite3"
    before = legacy_database(database)
    from backend.auth import issue_token
    from backend.repositories import list_schedules, upsert_schedule
    token = issue_token("legacy-id", database)
    upsert_schedule(database, "legacy-id", {"id": "keep", "title": "Keep", "tag": "Work"})
    with TestClient(create_app(database)) as client:
        response = client.post("/auth/login", json={
            "contactAddress": "legacy@example.test", "password": "old-password",
        })
        assert response.status_code == 200
        upgraded = stored(database)
        assert upgraded[0] == before[0]
        assert upgraded[1] != before[1]
        assert upgraded[2].startswith("pbkdf2_sha256$600000$")
        assert verify_user(database, "legacy@example.test", "old-password")["id"] == "legacy-id"
        assert stored(database) == upgraded
        assert client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200
        assert list_schedules(database, "legacy-id")[0]["id"] == "keep"


@pytest.mark.parametrize("digest", [
    "", "unknown$600000$" + "a" * 64, "pbkdf2_sha256$bad$" + "a" * 64,
    "pbkdf2_sha256$999999999999$" + "a" * 64, "pbkdf2_sha256$600000$not-hex", "A" * 64,
])
def test_malformed_stored_credentials_fail_closed_without_rewrite(tmp_path, digest):
    database = tmp_path / "malformed.sqlite3"
    legacy_database(database)
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE users SET password_hash = ?", (digest,))
    before = stored(database)
    assert verify_user(database, "legacy@example.test", "old-password") is None
    assert stored(database) == before


def test_concurrent_legacy_logins_do_not_overwrite_an_already_upgraded_hash(tmp_path):
    database = tmp_path / "concurrent.sqlite3"
    legacy_database(database)
    with ThreadPoolExecutor(max_workers=2) as pool:
        users = list(pool.map(lambda _: verify_user(database, "legacy@example.test", "old-password"), range(2)))
    assert all(user["id"] == "legacy-id" for user in users)
    assert stored(database)[2].startswith("pbkdf2_sha256$600000$")
    assert verify_user(database, "legacy@example.test", "old-password") is not None


def test_failed_legacy_upgrade_rolls_back_without_invalidating_existing_session(tmp_path):
    from backend.auth import issue_token, resolve_token
    database = tmp_path / "upgrade-failed.sqlite3"
    before = legacy_database(database)
    token = issue_token("legacy-id", database)
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TRIGGER reject_upgrade BEFORE UPDATE OF password_hash ON users "
                           "BEGIN SELECT RAISE(ABORT, 'upgrade rejected'); END")
    with pytest.raises(sqlite3.IntegrityError, match="upgrade rejected"):
        verify_user(database, "legacy@example.test", "old-password")
    assert stored(database) == before
    assert resolve_token(token, database) == "legacy-id"
    with sqlite3.connect(database) as connection:
        connection.execute("DROP TRIGGER reject_upgrade")
    assert verify_user(database, "legacy@example.test", "old-password") is not None


def test_legacy_upgrade_cannot_authorize_a_concurrently_replaced_password(tmp_path, monkeypatch):
    from backend.repositories import users
    from backend.passwords import hash_password, new_salt
    database = tmp_path / "credential-changed.sqlite3"
    legacy_database(database)
    replacement_salt = new_salt()
    replacement = hash_password("replacement-password", replacement_salt)
    actual_hash = users._password_hash

    def changed_before_upgrade(password, salt):
        with sqlite3.connect(database) as connection:
            connection.execute("UPDATE users SET password_salt=?, password_hash=? WHERE id='legacy-id'",
                               (replacement_salt, replacement))
        return actual_hash(password, salt)

    monkeypatch.setattr(users, "_password_hash", changed_before_upgrade)
    assert verify_user(database, "legacy@example.test", "old-password") is None
    assert stored(database)[1:] == (replacement_salt, replacement)
    assert verify_user(database, "legacy@example.test", "replacement-password") is not None


@pytest.mark.parametrize("account_kind", ["absent", "legacy", "corrupt", "low-cost", "current"])
def test_failed_logins_do_current_cost_kdf_work_without_exposing_account_existence(tmp_path, monkeypatch, account_kind):
    from backend import passwords
    database = tmp_path / "work.sqlite3"
    legacy_database(database)
    real_pbkdf2 = hashlib.pbkdf2_hmac
    if account_kind in {"low-cost", "current"}:
        count = 100_000 if account_kind == "low-cost" else 600_000
        digest = real_pbkdf2("sha256", b"old-password", b"salt", count).hex()
        with sqlite3.connect(database) as connection:
            connection.execute("UPDATE users SET password_salt='salt', password_hash=?", (f"pbkdf2_sha256${count}${digest}",))
    elif account_kind == "corrupt":
        with sqlite3.connect(database) as connection:
            connection.execute("UPDATE users SET password_hash='corrupt'")
    rounds = []

    def recorded(algorithm, password, salt, iterations):
        rounds.append(iterations)
        return real_pbkdf2(algorithm, password, salt, iterations)

    monkeypatch.setattr(passwords.hashlib, "pbkdf2_hmac", recorded)
    contact = "missing@example.test" if account_kind == "absent" else "legacy@example.test"
    assert verify_user(database, contact, "wrong-password") is None
    assert sum(rounds) == 600_000


def test_successful_low_cost_pbkdf2_login_upgrades_the_work_factor(tmp_path):
    database = tmp_path / "low-cost.sqlite3"
    legacy_database(database)
    digest = hashlib.pbkdf2_hmac("sha256", b"old-password", b"salt", 100_000).hex()
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE users SET password_salt='salt', password_hash=?", (f"pbkdf2_sha256$100000${digest}",))
    assert verify_user(database, "legacy@example.test", "old-password") is not None
    assert stored(database)[2].startswith("pbkdf2_sha256$600000$")


def test_concurrent_duplicate_registration_returns_200_and_409_not_500(tmp_path, monkeypatch):
    from threading import Barrier
    from backend.repositories import users
    database = tmp_path / "duplicate.sqlite3"
    barrier = Barrier(2)
    actual_hash = users._password_hash

    def synchronized_hash(password, salt):
        digest = actual_hash(password, salt)
        barrier.wait(timeout=10)
        return digest

    monkeypatch.setattr(users, "_password_hash", synchronized_hash)
    with TestClient(create_app(database)) as client:
        def register(_):
            return client.post("/auth/register", json={
                "contactAddress": "duplicate@example.test", "displayName": "Duplicate", "password": "test-password",
            }).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(register, range(2))) == [200, 409]
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM settings").fetchone()[0] == 1
