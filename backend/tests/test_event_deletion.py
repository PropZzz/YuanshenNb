"""Delete erroneous events while retaining an atomic, owner-scoped audit."""

import json
import sqlite3

import pytest

from starlette.testclient import TestClient

from backend.main import create_app


def register(client, address="delete@example.com"):
    response = client.post("/auth/register", json={
        "contactAddress": address, "displayName": "Delete", "password": "secret123",
    })
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def event(event_id="complete-1", **overrides):
    payload = {"id": event_id, "taskId": "task-1", "title": "Work", "tag": "Work",
               "at": "2026-11-24T09:00:00", "type": "complete",
               "plannedMinutes": 50, "actualMinutes": 60, "reason": "mistake"}
    return {**payload, **overrides}


def test_delete_event_excludes_it_from_review_and_profile_but_retains_original_audit(tmp_path):
    database = tmp_path / "delete.sqlite3"
    with TestClient(create_app(database)) as client:
        headers = register(client)
        assert client.post("/events", headers=headers, json=event("start-1", type="start")).status_code == 200
        assert client.post("/events", headers=headers, json=event()).status_code == 200
        assert client.get("/review/weekly?week_start=2026-11-23", headers=headers).json()["completedCount"] == 1
        assert client.get("/profile/summary", headers=headers).json()["totalFocusMinutes"] == 60
        with sqlite3.connect(database) as connection:
            connection.row_factory = sqlite3.Row
            original = dict(connection.execute("SELECT * FROM task_events WHERE id='complete-1'").fetchone())
        response = client.delete("/events/complete-1", headers=headers)
        assert response.status_code == 204, response.text
        assert [entry["id"] for entry in client.get("/events", headers=headers).json()] == ["start-1"]
        review = client.get("/review/weekly?week_start=2026-11-23", headers=headers).json()
        assert review["completedCount"] == 0
        assert review["actualMinutesTotal"] == 0
        assert client.get("/profile/summary", headers=headers).json()["totalFocusMinutes"] == 0
        with sqlite3.connect(database) as connection:
            connection.row_factory = sqlite3.Row
            audit = dict(connection.execute("SELECT * FROM task_event_deletions").fetchone())
        assert audit["event_id"] == original["id"]
        assert audit["user_id"] == original["user_id"]
        assert audit["schema_version"] == 1
        assert audit["deleted_at"]
        assert json.loads(audit["payload_json"]) == original


def test_deleted_event_id_cannot_be_resurrected_by_single_or_batch_upload(tmp_path):
    with TestClient(create_app(tmp_path / "tombstone.sqlite3")) as client:
        headers = register(client)
        other = register(client, "other@example.com")
        assert client.post("/events", headers=headers, json=event()).status_code == 200
        assert client.delete("/events/complete-1", headers=headers).status_code == 204
        for owner in (headers, other):
            assert client.post("/events", headers=owner, json=event()).status_code == 409
            response = client.post("/events/batch", headers=owner, json=[event("new-event"), event()])
            assert response.status_code == 409
            assert client.get("/events", headers=owner).json() == []
        assert client.post("/events", headers=headers, json=event("corrected-event")).status_code == 200


def test_event_delete_auth_isolation_and_missing_ids_do_not_add_audit(tmp_path):
    database = tmp_path / "isolated.sqlite3"
    with TestClient(create_app(database)) as client:
        owner = register(client)
        other = register(client, "other@example.com")
        assert client.post("/events", headers=owner, json=event()).status_code == 200
        assert client.delete("/events/complete-1").status_code == 401
        for event_id in ("complete-1", "missing"):
            assert client.delete(f"/events/{event_id}", headers=other).status_code == 404
        assert client.delete("/events/missing", headers=owner).status_code == 404
        assert len(client.get("/events", headers=owner).json()) == 1
        with sqlite3.connect(database) as connection:
            assert connection.execute("SELECT COUNT(*) FROM task_event_deletions").fetchone()[0] == 0
        assert client.delete("/events/complete-1", headers=owner).status_code == 204
        assert client.delete("/events/complete-1", headers=owner).status_code == 404
        with sqlite3.connect(database) as connection:
            assert connection.execute("SELECT COUNT(*) FROM task_event_deletions").fetchone()[0] == 1


@pytest.mark.parametrize("failure", ["audit", "delete"])
def test_delete_transaction_rolls_back_event_and_audit_on_storage_failure(tmp_path, failure):
    database = tmp_path / "rollback.sqlite3"
    with TestClient(create_app(database), raise_server_exceptions=False) as client:
        headers = register(client)
        assert client.post("/events", headers=headers, json=event()).status_code == 200
        statement = ("BEFORE INSERT ON task_event_deletions" if failure == "audit"
                     else "BEFORE DELETE ON task_events")
        with sqlite3.connect(database) as connection:
            connection.execute(f"CREATE TRIGGER fail_write {statement} BEGIN SELECT RAISE(ABORT, 'disk failure'); END")
        response = client.delete("/events/complete-1", headers=headers)
        assert response.status_code == 500
        assert [entry["id"] for entry in client.get("/events", headers=headers).json()] == ["complete-1"]
        with sqlite3.connect(database) as connection:
            assert connection.execute("SELECT COUNT(*) FROM task_event_deletions").fetchone()[0] == 0
            connection.execute("DROP TRIGGER fail_write")
        assert client.delete("/events/complete-1", headers=headers).status_code == 204


def test_event_delete_and_upload_race_cannot_resurrect_deleted_id(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    database = tmp_path / "concurrent.sqlite3"
    with TestClient(create_app(database)) as client:
        headers = register(client)
        assert client.post("/events", headers=headers, json=event()).status_code == 200
        barrier = Barrier(2)

        def remove():
            barrier.wait(timeout=5)
            return client.delete("/events/complete-1", headers=headers)

        def upload():
            barrier.wait(timeout=5)
            return client.post("/events", headers=headers, json=event(title="Updated"))

        with ThreadPoolExecutor(max_workers=2) as pool:
            deleted = pool.submit(remove)
            uploaded = pool.submit(upload)
            assert deleted.result(timeout=15).status_code == 204
            upload_status = uploaded.result(timeout=15).status_code
        assert upload_status in {200, 409}
        assert client.get("/events", headers=headers).json() == []
        with sqlite3.connect(database) as connection:
            audits = connection.execute("SELECT payload_json FROM task_event_deletions").fetchall()
        assert len(audits) == 1
        assert json.loads(audits[0][0])["title"] == ("Updated" if upload_status == 200 else "Work")
    with TestClient(create_app(database)) as restarted:
        assert restarted.post("/events", headers=headers, json=event()).status_code == 409


def test_backup_restore_keeps_reminder_and_deleted_id_audit(tmp_path):
    from pathlib import Path

    from deploy.database_maintenance import backup_database, restore_database

    database = tmp_path / "live.sqlite3"
    restored_database = tmp_path / "restored.sqlite3"
    with TestClient(create_app(database)) as client:
        headers = register(client)
        assert client.post("/schedule", headers=headers, json={
            "id": "schedule-1", "title": "Schedule", "tag": "Work", "day": "2026-11-24",
            "time": {"hour": 9, "minute": 0},
        }).status_code == 200
        reminder = client.post("/reminders", headers=headers, json={"scheduleId": "schedule-1"}).json()
        assert client.post("/events", headers=headers, json=event()).status_code == 200
        assert client.delete("/events/complete-1", headers=headers).status_code == 204
    saved = backup_database(database, tmp_path / "backups")
    assert saved["counts"]["reminders"] == 1
    assert saved["counts"]["task_event_deletions"] == 1
    restore_database(Path(saved["database"]), restored_database)
    with TestClient(create_app(restored_database)) as client:
        assert client.get("/reminders", headers=headers).json() == [reminder]
        assert client.get("/events", headers=headers).json() == []
        assert client.post("/events", headers=headers, json=event()).status_code == 409


@pytest.mark.parametrize("batch", [False, True])
def test_upload_response_remains_valid_if_delete_commits_immediately_after_upload(tmp_path, monkeypatch, batch):
    """Deterministically interleave DELETE at the database commit boundary."""
    from backend.repositories import common
    from backend.repositories.events import delete_task_event, upsert_task_event, upsert_task_events

    database = tmp_path / "response-race.sqlite3"
    with TestClient(create_app(database)) as client:
        headers = register(client)
        user_id = client.get("/auth/me", headers=headers).json()["id"]
    deleted = False

    class InterleavedConnection(sqlite3.Connection):
        def commit(self):
            nonlocal deleted
            was_writing = self.in_transaction
            super().commit()
            if was_writing and not deleted:
                deleted = True
                delete_task_event(database, user_id, "complete-1")

    # Real SQLite connections/transactions; only control the competing request's timing.
    monkeypatch.setattr(common, "get_connection", lambda _: sqlite3.connect(database, factory=InterleavedConnection))
    if batch:
        stored = upsert_task_events(database, user_id, [event()])[0]
    else:
        stored = upsert_task_event(database, user_id, event())
    assert stored["id"] == "complete-1"
    assert stored["title"] == "Work"
    assert deleted
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM task_events").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM task_event_deletions").fetchone()[0] == 1
