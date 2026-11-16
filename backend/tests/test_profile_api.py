from __future__ import annotations

from datetime import date, timedelta

from starlette.testclient import TestClient

from backend.main import create_app


def _register(client: TestClient, contact: str) -> dict[str, str]:
    response = client.post(
        "/auth/register",
        json={
            "contactAddress": contact,
            "displayName": "林知行",
            "password": "secret123",
        },
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _complete_event(event_id: str, at: str, **overrides):
    payload = {
        "id": event_id,
        "taskId": "task-1",
        "title": "架构编码",
        "tag": "架构编码",
        "load": "medium",
        "at": at,
        "type": "complete",
        "plannedMinutes": 50,
        "actualMinutes": 45,
        "interruptions": 0,
    }
    payload.update(overrides)
    return payload


def test_profile_summary_empty_account(tmp_path):
    with TestClient(create_app(tmp_path / "profile.sqlite3")) as client:
        headers = _register(client, "empty@example.com")
        summary = client.get("/profile/summary", headers=headers).json()

        assert summary["streakDays"] == 0
        assert summary["totalFocusHours"] == 0
        assert summary["resistanceIndex"] is None
        assert summary["level"]["level"] == 1
        assert len(summary["weeklySeries"]) == 7
        assert summary["peakSession"] is None
        assert summary["microtaskCycle"]["thisWeek"]["created"] == 0
        assert summary["timeStructure"]["segments"] == []


def test_profile_summary_computes_real_metrics(tmp_path):
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    with TestClient(create_app(tmp_path / "profile.sqlite3")) as client:
        headers = _register(client, "stats@example.com")
        # 周一一次 135 分钟会话（零打断）+ 周二一次 25 分钟（1 次打断）
        client.post("/events", headers=headers, json=_complete_event(
            "e-mon", f"{week_start.isoformat()}T09:30:00", plannedMinutes=135, actualMinutes=135,
        ))
        client.post("/events", headers=headers, json=_complete_event(
            "e-tue", f"{(week_start + timedelta(days=1)).isoformat()}T14:00:00",
            plannedMinutes=25, actualMinutes=25, interruptions=1, tag="方案评审",
        ))
        client.post("/microtasks", headers=headers, json={"title": "写周报", "tag": "杂务", "minutes": 20, "priority": 3})

        summary = client.get("/profile/summary", headers=headers).json()

        assert summary["totalFocusMinutes"] == 160
        assert summary["totalFocusHours"] == 2.7
        assert summary["streakDays"] >= 1  # 今天未结算时至少连续到昨天
        assert summary["level"]["level"] == 1
        # 平均每次会话 0.5 次打断 → 1 - 0.5/5 = 0.9
        assert summary["resistanceIndex"] == 0.9
        # 波峰是最长的周一会话，带起止时间
        peak = summary["peakSession"]
        assert peak["weekday"] == "周一"
        assert peak["start"] == "09:30"
        assert peak["end"] == "11:45"
        assert peak["minutes"] == 135
        # 周一维持率 100%
        assert summary["weeklySeries"][0]["retention"] == 100.0
        # 时间结构按标签聚合
        tags = {segment["tag"]: segment["percent"] for segment in summary["timeStructure"]["segments"]}
        assert tags["架构编码"] == round(135 / 160 * 100, 1)
        assert summary["timeStructure"]["totalHours"] == 2.7
        # 履约率：本周下发 1、未完结
        cycle = summary["microtaskCycle"]
        assert cycle["thisWeek"]["created"] == 1
        assert cycle["thisWeek"]["completed"] == 0
        assert cycle["thisWeek"]["rate"] == 0.0


def test_profile_summary_isolated_per_user(tmp_path):
    with TestClient(create_app(tmp_path / "profile.sqlite3")) as client:
        headers_a = _register(client, "user-a@example.com")
        headers_b = _register(client, "user-b@example.com")
        client.post("/events", headers=headers_a, json=_complete_event("e-1", "2026-11-02T09:30:00"))

        summary_a = client.get("/profile/summary", headers=headers_a).json()
        summary_b = client.get("/profile/summary", headers=headers_b).json()
        assert summary_a["totalFocusMinutes"] == 45
        assert summary_b["totalFocusMinutes"] == 0


def test_settings_preferences_roundtrip_and_validation(tmp_path):
    with TestClient(create_app(tmp_path / "profile.sqlite3")) as client:
        headers = _register(client, "prefs@example.com")

        default = client.get("/settings", headers=headers).json()["preferences"]
        assert default["pomodoroFocusMinutes"] == 25
        assert default["mutedApps"] == []

        saved = client.put("/settings", headers=headers, json={
            "preferences": {"pomodoroFocusMinutes": 40, "mutedApps": ["微信 (桌面端)"]},
        })
        assert saved.status_code == 200
        preferences = saved.json()["preferences"]
        assert preferences["pomodoroFocusMinutes"] == 40
        assert preferences["mutedApps"] == ["微信 (桌面端)"]
        # 未提交的键保持原值（按键合并）
        assert preferences["focusSound"] == "deep-theta"

        invalid = client.put("/settings", headers=headers, json={
            "preferences": {"pomodoroFocusMinutes": 999},
        })
        assert invalid.status_code == 422
        unknown = client.put("/settings", headers=headers, json={
            "preferences": {"unknownKey": 1},
        })
        assert unknown.status_code == 422
        duplicate = client.put("/settings", headers=headers, json={
            "preferences": {"mutedApps": ["A", "A"]},
        })
        assert duplicate.status_code == 422


def test_profile_security_and_export(tmp_path):
    with TestClient(create_app(tmp_path / "profile.sqlite3")) as client:
        headers = _register(client, "audit@example.com")
        client.post("/events", headers=headers, json=_complete_event("e-1", "2026-11-02T09:30:00"))
        client.post("/microtasks", headers=headers, json={"title": "写周报", "tag": "杂务", "minutes": 20, "priority": 3})

        security = client.get("/profile/security", headers=headers).json()
        assert security["activeSessions"] >= 1
        assert security["dataCounts"]["task_events"] == 1
        assert security["dataCounts"]["microtasks"] == 1
        assert security["contactAddress"] == "audit@example.com"
        assert "preferences" in security

        export = client.get("/profile/export", headers=headers)
        assert export.status_code == 200
        assert "attachment" in export.headers["content-disposition"]
        payload = export.json()
        assert payload["format"] == "ruanchuang.full-export/v1"
        assert payload["profile"]["contactAddress"] == "audit@example.com"
        assert len(payload["taskEvents"]) == 1
        assert len(payload["microtasks"]) == 1
        assert "settings" in payload

        # 未登录访问一律拒绝
        assert client.get("/profile/summary").status_code == 401
        assert client.get("/profile/export").status_code == 401
