from starlette.testclient import TestClient

from backend.main import create_app


RESERVED_ENDPOINTS = [
    ("POST", "/auth/refresh"),
    ("POST", "/auth/password/reset-request"),
    ("POST", "/auth/password/reset-confirm"),
    ("POST", "/goals/decompose"),
    ("POST", "/notifications/devices"),
    ("DELETE", "/notifications/devices/device-1"),
    ("POST", "/notifications/test"),
    ("GET", "/devices"),
    ("POST", "/devices"),
    ("DELETE", "/devices/device-1"),
    ("POST", "/devices/device-1/samples"),
    ("GET", "/devices/device-1/status"),
    ("PUT", "/devices/device-1/permissions"),
    ("GET", "/integrations/providers"),
    ("POST", "/integrations/calendar-google/connect"),
    ("POST", "/integrations/calendar-google/callback"),
    ("DELETE", "/integrations/calendar-google"),
    ("POST", "/integrations/calendar-google/import"),
    ("GET", "/integrations/calendar-google/sync-status"),
    ("POST", "/ai/parse-task"),
    ("POST", "/ai/decompose-goal"),
    ("POST", "/ai/explain-plan"),
    ("POST", "/ai/review-suggestions"),
    ("POST", "/ai/tuning"),
    ("POST", "/files/upload"),
    ("GET", "/files/file-1"),
    ("DELETE", "/files/file-1"),
    ("POST", "/files/parse-task-list"),
    ("POST", "/sync/conflicts/conflict-1/resolve"),
]

# These paths now perform real operations. Keep their routing/auth assertions,
# while the domain suites cover persistence, isolation and transaction failures.
IMPLEMENTED_ENDPOINTS = [
    ("DELETE", "/events/event-1", 404),
    ("GET", "/reminders", 200),
    ("POST", "/reminders", 422),
    ("PUT", "/reminders/reminder-1", 404),
    ("DELETE", "/reminders/reminder-1", 404),
]


def _headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/auth/register",
        json={
            "contactAddress": "reserved@example.com",
            "displayName": "Reserved",
            "password": "secret123",
        },
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _request(client: TestClient, method: str, path: str, headers: dict[str, str] | None = None):
    return client.request(method, path, json={} if method in {"POST", "PUT"} else None, headers=headers)


def test_reserved_endpoints_require_authentication(tmp_path):
    with TestClient(create_app(tmp_path / "reserved.sqlite3")) as client:
        response = _request(client, "GET", "/diagnostics/summary")

    assert response.status_code == 401


def test_reserved_endpoints_return_explicit_reserved_error(tmp_path):
    with TestClient(create_app(tmp_path / "reserved.sqlite3")) as client:
        headers = _headers(client)

        for method, path in RESERVED_ENDPOINTS:
            response = _request(client, method, path, headers=headers)
            assert response.status_code == 501, f"{method} {path}"
            body = response.json()
            assert body["detail"]["code"] == "RESERVED_ENDPOINT"
            assert body["detail"]["status"] == "Reserved"


def test_implemented_reminder_and_event_paths_use_real_domain_responses(tmp_path):
    with TestClient(create_app(tmp_path / "implemented.sqlite3")) as client:
        headers = _headers(client)
        for method, path, expected in IMPLEMENTED_ENDPOINTS:
            assert _request(client, method, path).status_code == 401
            assert _request(client, method, path, headers=headers).status_code == expected


def test_reserved_endpoints_are_visible_in_openapi(tmp_path):
    with TestClient(create_app(tmp_path / "reserved.sqlite3")) as client:
        paths = client.get("/openapi.json").json()["paths"]

    expected_paths = {
        path.replace("goal-1", "{goal_id}")
        .replace("task-1", "{task_id}")
        .replace("event-1", "{event_id}")
        .replace("member-1", "{member_id}")
        .replace("reminder-1", "{reminder_id}")
        .replace("device-1", "{device_id}")
        .replace("calendar-google", "{provider}")
        .replace("file-1", "{file_id}")
        .replace("conflict-1", "{conflict_id}")
        for _, path in RESERVED_ENDPOINTS + [(method, path) for method, path, _ in IMPLEMENTED_ENDPOINTS]
    }

    assert expected_paths.issubset(paths.keys())
