"""Reminder configuration and schedule projection through the public API."""

import sqlite3

import pytest
from starlette.testclient import TestClient

from backend.main import create_app


DAY = "2026-11-24"


def register(client, address="reminders@example.com"):
    response = client.post("/auth/register", json={
        "contactAddress": address, "displayName": "Reminder", "password": "secret123",
    })
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


@pytest.fixture
def api(tmp_path):
    with TestClient(create_app(tmp_path / "reminders.sqlite3")) as client:
        yield client, register(client)


def schedule(client, headers, **changes):
    data = {"id": "schedule-1", "day": DAY, "title": "Review", "tag": "Work",
            "time": {"hour": 9, "minute": 0}, "reminderMinutesBefore": 10}
    data.update(changes)
    response = client.post("/schedule", headers=headers, json=data)
    assert response.status_code == 200, response.text
    return response.json()


def test_reminder_crud_persists_configuration_and_effective_time(api):
    client, headers = api
    schedule(client, headers)
    response = client.post("/reminders", headers=headers, json={"scheduleId": "schedule-1"})
    assert response.status_code == 201, response.text
    reminder = response.json()
    assert reminder == {
        "id": reminder["id"], "scheduleId": "schedule-1", "enabled": True,
        "minutesBefore": 10, "usesScheduleOffset": True, "status": "ready",
        "triggerAtLocal": "2026-11-24T08:50:00", "unavailableReason": None,
    }
    assert client.get("/reminders", headers=headers).json() == [reminder]
    updated = client.put(f"/reminders/{reminder['id']}", headers=headers,
                         json={"enabled": False, "minutesBefore": 30})
    assert updated.status_code == 200, updated.text
    assert updated.json()["status"] == "disabled"
    assert updated.json()["triggerAtLocal"] is None
    assert updated.json()["minutesBefore"] == 30
    assert updated.json()["usesScheduleOffset"] is False
    assert client.delete(f"/reminders/{reminder['id']}", headers=headers).status_code == 204
    assert client.get("/reminders", headers=headers).json() == []


def test_reminder_follows_edits_and_survives_schedule_removal_and_restore(api):
    client, headers = api
    entry = schedule(client, headers)
    created = client.post("/reminders", headers=headers, json={"scheduleId": entry["id"]}).json()
    schedule(client, headers, day="2026-11-25", time={"hour": 0, "minute": 5}, reminderMinutesBefore=20)
    updated = client.get("/reminders", headers=headers).json()[0]
    assert updated["triggerAtLocal"] == "2026-11-24T23:45:00"
    assert updated["minutesBefore"] == 20
    client.delete("/schedule/schedule-1", headers=headers)
    missing = client.get("/reminders", headers=headers)
    assert missing.status_code == 200, missing.text
    assert missing.json()[0]["id"] == created["id"]
    assert missing.json()[0]["status"] == "unavailable"
    assert missing.json()[0]["unavailableReason"] == "scheduleMissing"
    assert missing.json()[0]["triggerAtLocal"] is None
    schedule(client, headers, time={"hour": 10, "minute": 0})
    assert client.get("/reminders", headers=headers).json()[0]["triggerAtLocal"] == "2026-11-24T09:50:00"


@pytest.mark.parametrize("changes,day,state,trigger,reason", [
    ({"repeat": "daily"}, "2026-11-26", "ready", "2026-11-26T08:50:00", None),
    ({"repeat": "daily"}, "2026-11-23", "notScheduled", None, None),
    ({"repeat": "weekly"}, "2026-12-01", "ready", "2026-12-01T08:50:00", None),
    ({"repeat": "weekly"}, "2026-11-25", "notScheduled", None, None),
    ({"repeat": "daily", "repeatUntil": "2026-11-25"}, "2026-11-25", "ready", "2026-11-25T08:50:00", None),
    ({"repeat": "daily", "repeatUntil": "2026-11-25"}, "2026-11-26", "notScheduled", None, None),
    ({"day": "2026-01-31", "repeat": "monthly"}, "2026-03-28", "ready", "2026-03-28T08:50:00", None),
    ({"day": "2026-01-31", "repeat": "monthly"}, "2026-03-31", "notScheduled", None, None),
    ({"day": None}, DAY, "ready", "2026-11-24T08:50:00", None),
    ({"day": None}, None, "unavailable", None, "dateRequired"),
    ({"repeat": "yearly"}, DAY, "unavailable", None, "unsupportedRepeat"),
    ({"time": {"hour": 25}}, DAY, "unavailable", None, "invalidSchedule"),
    ({"reminderMinutesBefore": -5}, DAY, "unavailable", None, "invalidSchedule"),
    ({}, "9999-12-31", "notScheduled", None, None),
])
def test_reminder_projects_occurrence_without_inventing_utc_or_bad_times(api, changes, day, state, trigger, reason):
    client, headers = api
    schedule(client, headers, **changes)
    # Configuration is saved even when a legacy schedule cannot be projected.
    response = client.post("/reminders", headers=headers, json={"scheduleId": "schedule-1"})
    assert response.status_code == 201, response.text
    response = client.get("/reminders", headers=headers, params={"day": day} if day else {})
    assert response.status_code == 200, response.text
    reminder = response.json()[0]
    assert (reminder["status"], reminder["triggerAtLocal"], reminder["unavailableReason"]) == (state, trigger, reason)


def test_reminder_isolation_and_duplicate_creation(api):
    client, owner = api
    other = register(client, "other@example.com")
    schedule(client, owner)
    response = client.post("/reminders", headers=owner, json={"scheduleId": "schedule-1"})
    assert response.status_code == 201
    reminder = response.json()
    assert client.get("/reminders", headers=other).json() == []
    assert client.post("/reminders", headers=other, json={"scheduleId": "schedule-1"}).status_code == 404
    assert client.post("/reminders", headers=owner, json={"scheduleId": "missing"}).status_code == 404
    assert client.post("/reminders", headers=owner, json={"scheduleId": "schedule-1"}).status_code == 409
    for reminder_id in (reminder["id"], "missing"):
        assert client.put(f"/reminders/{reminder_id}", headers=other, json={"enabled": False}).status_code == 404
        assert client.delete(f"/reminders/{reminder_id}", headers=other).status_code == 404
    assert client.get("/reminders", headers=owner).json() == [reminder]
    assert client.delete(f"/reminders/{reminder['id']}", headers=owner).status_code == 204
    assert client.delete(f"/reminders/{reminder['id']}", headers=owner).status_code == 404


@pytest.mark.parametrize("method,path,body", [
    ("GET", "/reminders", None), ("POST", "/reminders", {"scheduleId": "s"}),
    ("PUT", "/reminders/r", {"enabled": True}), ("DELETE", "/reminders/r", None),
])
def test_reminders_require_auth(api, method, path, body):
    client, _ = api
    assert client.request(method, path, json=body).status_code == 401


@pytest.mark.parametrize("field,value", [
    ("minutesBefore", -1), ("minutesBefore", 10081), ("minutesBefore", True),
    ("minutesBefore", "10"), ("minutesBefore", 1.5), ("enabled", "false"),
    ("enabled", None), ("minutesBefor", 5), ("id", "client-id"),
])
def test_invalid_reminder_body_is_rejected_without_modifying_saved_config(api, field, value):
    client, headers = api
    schedule(client, headers)
    created = client.post("/reminders", headers=headers, json={"scheduleId": "schedule-1"}).json()
    body = {"scheduleId": "schedule-1", field: value}
    assert client.post("/reminders", headers=headers, json=body).status_code == 422
    assert client.put(f"/reminders/{created['id']}", headers=headers, json={field: value}).status_code == 422
    assert client.get("/reminders", headers=headers).json() == [created]


def test_reminder_override_and_reset_to_live_schedule_offset(api):
    client, headers = api
    schedule(client, headers)
    created = client.post("/reminders", headers=headers, json={"scheduleId": "schedule-1", "minutesBefore": 0}).json()
    schedule(client, headers, reminderMinutesBefore=20)
    assert client.get("/reminders", headers=headers).json()[0]["triggerAtLocal"] == "2026-11-24T09:00:00"
    updated = client.put(f"/reminders/{created['id']}", headers=headers, json={"minutesBefore": None})
    assert updated.status_code == 200
    assert updated.json()["triggerAtLocal"] == "2026-11-24T08:40:00"
    assert client.get("/reminders?day=bad", headers=headers).status_code == 422
    assert client.put(f"/reminders/{created['id']}", headers=headers, json={"scheduleId": "other"}).status_code == 422


def test_reminder_configuration_and_time_survive_rescue_apply_and_undo(api):
    client, headers = api
    before = schedule(client, headers)
    reminder = client.post("/reminders", headers=headers, json={"scheduleId": "schedule-1"}).json()
    options = client.post("/schedule/rescue/options", headers=headers, json={
        "day": DAY, "currentEntries": [before], "energy": "medium",
        "urgentTask": {"id": "urgent", "title": "Urgent", "durationMinutes": 30,
                       "priority": 5, "load": "high", "tag": "Urgent", "due": f"{DAY}T18:00:00+08:00"},
        "windows": [{"start": {"hour": 8}, "end": {"hour": 18}}],
    })
    assert options.status_code == 200, options.text
    response = client.post("/schedule/rescue/apply", headers=headers, json={
        "day": DAY, "baselineHash": options.json()["baselineHash"], "strategy": "protectDeadline",
        "before": [before], "after": [{**before, "time": {"hour": 11, "minute": 0}}],
    })
    assert response.status_code == 200, response.text
    projected = client.get("/reminders", headers=headers).json()[0]
    assert projected["id"] == reminder["id"]
    assert projected["triggerAtLocal"] == "2026-11-24T10:50:00"
    undone = client.post("/schedule/rescue/undo", headers=headers, json={"snapshotId": response.json()["snapshotId"]})
    assert undone.status_code == 200, undone.text
    assert client.get("/reminders", headers=headers).json() == [reminder]


def test_bad_legacy_offset_is_visible_as_unavailable_not_response_validation_failure(api):
    client, headers = api
    schedule(client, headers)
    client.post("/reminders", headers=headers, json={"scheduleId": "schedule-1"})
    with sqlite3.connect(client.app.state.db_path) as connection:
        connection.execute("UPDATE schedules SET reminder_minutes_before = 'bad'")
    response = client.get("/reminders", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()[0]["status"] == "unavailable"
    assert response.json()[0]["unavailableReason"] == "invalidSchedule"
    assert response.json()[0]["minutesBefore"] is None


def test_export_contains_only_current_users_reminder_configuration(api):
    client, headers = api
    other = register(client, "export-other@example.com")
    schedule(client, headers)
    created = client.post("/reminders", headers=headers, json={"scheduleId": "schedule-1"}).json()
    exported = client.get("/profile/export", headers=headers).json()
    assert [item["id"] for item in exported["reminders"]] == [created["id"]]
    assert client.get("/profile/export", headers=other).json()["reminders"] == []


def test_legacy_database_adds_tables_idempotently_and_preserves_data_across_restart(tmp_path):
    from backend.schema import init_db

    database = tmp_path / "legacy.sqlite3"
    with sqlite3.connect(database) as connection:
        connection.execute("""CREATE TABLE users (
            id TEXT PRIMARY KEY, contact_address TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
            password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )""")
        connection.execute("INSERT INTO users VALUES ('legacy', 'old@example.com', 'Old', 'salt', 'hash', 'old', 'old')")
    init_db(database)
    init_db(database)
    with TestClient(create_app(database)) as client:
        headers = register(client)
        schedule(client, headers)
        created = client.post("/reminders", headers=headers, json={"scheduleId": "schedule-1"}).json()
    init_db(database)
    with TestClient(create_app(database)) as client:
        assert client.get("/reminders", headers=headers).json() == [created]
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT * FROM users WHERE id='legacy'").fetchone() == (
            'legacy', 'old@example.com', 'Old', 'salt', 'hash', 'old', 'old',
        )
        assert connection.execute("SELECT COUNT(*) FROM task_event_deletions").fetchone()[0] == 0
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_failed_reminder_update_keeps_saved_configuration_for_retry(tmp_path):
    database = tmp_path / "rollback.sqlite3"
    with TestClient(create_app(database), raise_server_exceptions=False) as client:
        headers = register(client)
        schedule(client, headers)
        created = client.post("/reminders", headers=headers, json={"scheduleId": "schedule-1"}).json()
        with sqlite3.connect(database) as connection:
            connection.execute("CREATE TRIGGER fail_update BEFORE UPDATE ON reminders BEGIN SELECT RAISE(ABORT, 'disk failure'); END")
        response = client.put(f"/reminders/{created['id']}", headers=headers, json={"enabled": False})
        assert response.status_code == 500
        assert client.get("/reminders", headers=headers).json() == [created]
        with sqlite3.connect(database) as connection:
            connection.execute("DROP TRIGGER fail_update")
        assert client.put(f"/reminders/{created['id']}", headers=headers, json={"enabled": False}).status_code == 200


def test_concurrent_reminder_creation_has_one_winner(api):
    from concurrent.futures import ThreadPoolExecutor

    client, headers = api
    schedule(client, headers)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: client.post("/reminders", headers=headers, json={"scheduleId": "schedule-1"}), range(2)))
    assert sorted(response.status_code for response in results) == [201, 409]
    assert len(client.get("/reminders", headers=headers).json()) == 1


def test_create_storage_error_is_not_disguised_as_duplicate_conflict(tmp_path):
    database = tmp_path / "create-failure.sqlite3"
    with TestClient(create_app(database), raise_server_exceptions=False) as client:
        headers = register(client)
        schedule(client, headers)
        with sqlite3.connect(database) as connection:
            connection.execute("CREATE TRIGGER fail_insert BEFORE INSERT ON reminders BEGIN SELECT RAISE(ABORT, 'write failure'); END")
        response = client.post("/reminders", headers=headers, json={"scheduleId": "schedule-1"})
        assert response.status_code == 500
        assert client.get("/reminders", headers=headers).json() == []
