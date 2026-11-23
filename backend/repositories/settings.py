"""settings persistence; shared transactions stay with their owning domain."""
from __future__ import annotations

from .common import _connect
from .common import _now
from .errors import RepositoryValidationError
from .review import default_scheduling_tuning
from pathlib import Path
import json


PREFERENCE_INT_RANGES: dict[str, tuple[int, int]] = {
    "pomodoroFocusMinutes": (15, 120),
    "pomodoroShortBreakMinutes": (1, 30),
    "pomodoroLongBreakMinutes": (5, 60),
    "pomodoroCycles": (2, 8),
}

PREFERENCE_BOOLEAN_KEYS = frozenset({
    "pomodoroAutoStart", "doNotDisturb", "pushFilter", "profileCompact",
})

PREFERENCE_ENUM_KEYS: dict[str, frozenset[str]] = {
    "focusSound": frozenset({"deep-theta", "rainforest", "server-fan", "silent"}),
    "profileColorTone": frozenset({"teal", "gray", "jade"}),
}


def default_user_preferences() -> dict[str, object]:
    """默认的“我的”页卡片偏好，与前端占位控件保持一致。"""
    return {
        "pomodoroFocusMinutes": 25,
        "pomodoroShortBreakMinutes": 5,
        "pomodoroLongBreakMinutes": 15,
        "pomodoroCycles": 4,
        "pomodoroAutoStart": True,
        "focusSound": "deep-theta",
        "doNotDisturb": True,
        "pushFilter": True,
        "mutedApps": [],
        "profileColorTone": "teal",
        "profileCompact": False,
    }


def _validate_user_preferences(values: dict[str, object]) -> dict[str, object]:
    """校验并规整偏好键值；未知键直接拒绝，避免前端拼写错误被静默吞掉。"""
    validated: dict[str, object] = {}
    for key, value in values.items():
        if key in PREFERENCE_INT_RANGES:
            minimum, maximum = PREFERENCE_INT_RANGES[key]
            if isinstance(value, bool) or not isinstance(value, int):
                raise RepositoryValidationError(f"{key} must be an integer")
            if not minimum <= value <= maximum:
                raise RepositoryValidationError(f"{key} must be between {minimum} and {maximum}")
            validated[key] = value
        elif key in PREFERENCE_BOOLEAN_KEYS:
            if not isinstance(value, bool):
                raise RepositoryValidationError(f"{key} must be a boolean")
            validated[key] = value
        elif key in PREFERENCE_ENUM_KEYS:
            if value not in PREFERENCE_ENUM_KEYS[key]:
                raise RepositoryValidationError(f"{key} must be one of {sorted(PREFERENCE_ENUM_KEYS[key])}")
            validated[key] = value
        elif key == "mutedApps":
            if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                raise RepositoryValidationError("mutedApps must be a list of strings")
            normalized = [item.strip() for item in value if item.strip()]
            if len(normalized) != len(set(normalized)):
                raise RepositoryValidationError("mutedApps must not contain duplicates")
            if len(normalized) > 20:
                raise RepositoryValidationError("mutedApps supports at most 20 entries")
            if any(len(item) > 40 for item in normalized):
                raise RepositoryValidationError("mutedApps entries must be at most 40 characters")
            validated[key] = normalized
        else:
            raise RepositoryValidationError(f"unknown preference key: {key}")
    return validated


def get_user_settings(db_path: str | Path | None, user_id: str) -> dict[str, object]:
    with _connect(db_path) as connection:
        row = connection.execute(
            "SELECT theme_mode, locale, favorite_device_id, preferences_json FROM settings WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return {
                "themeMode": "system",
                "locale": "zh_CN",
                "favoriteDeviceId": None,
                "preferences": default_user_preferences(),
            }
        try:
            stored = json.loads(row["preferences_json"] or "{}")
        except json.JSONDecodeError:
            stored = {}
        preferences = {
            **default_user_preferences(),
            **{key: value for key, value in stored.items() if key in default_user_preferences()},
        }
        return {
            "themeMode": row["theme_mode"] or "system",
            "locale": row["locale"] or "zh_CN",
            "favoriteDeviceId": row["favorite_device_id"],
            "preferences": preferences,
        }


def update_user_settings(
    db_path: str | Path | None,
    user_id: str,
    values: dict[str, object],
) -> dict[str, object]:
    current = get_user_settings(db_path, user_id)
    theme_mode = str(values.get("themeMode", current["themeMode"]) or "system")
    locale = str(values.get("locale", current["locale"]) or "zh_CN")
    favorite = values.get("favoriteDeviceId", current["favoriteDeviceId"])
    if theme_mode not in {"system", "light", "dark"}:
        raise RepositoryValidationError("themeMode must be system, light, or dark")
    if locale not in {"zh_CN", "en_US"}:
        raise RepositoryValidationError("locale must be zh_CN or en_US")
    # 偏好按键合并：前端只提交变化的那一项（例如拖动滑杆），其余保持原值。
    preferences_patch = values.get("preferences")
    preferences = current["preferences"]
    if isinstance(preferences_patch, dict):
        preferences = {
            **preferences,
            **_validate_user_preferences(preferences_patch),
        }
    now = _now()
    with _connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO settings (user_id, scheduling_tuning_json, theme_mode, locale, favorite_device_id, preferences_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                theme_mode = excluded.theme_mode,
                locale = excluded.locale,
                favorite_device_id = excluded.favorite_device_id,
                preferences_json = excluded.preferences_json,
                updated_at = excluded.updated_at
            """,
            (
                user_id,
                json.dumps(default_scheduling_tuning()),
                theme_mode,
                locale,
                favorite,
                json.dumps(preferences, ensure_ascii=False),
                now,
            ),
        )
        connection.commit()
    return {
        "themeMode": theme_mode,
        "locale": locale,
        "favoriteDeviceId": favorite,
        "preferences": preferences,
    }
