"""Compatibility import surface for the domain repositories.

Routes and callers retain their existing imports; implementations live in the
explicit domain modules. Do not add database work to this facade.
"""

from .errors import (
    TaskEventConflictError,
    TaskEventBatchValidationError,
    RepositoryConflictError,
    RepositoryNotFoundError,
    RepositoryValidationError,
)

from .common import (
    _now,
    _parse_date,
    _parse_time,
    _first_non_none,
    _parse_int,
    _parse_float,
    _parse_bool,
    _connect,
    _row_to_dict,
    _iso_day,
    _check_global_owner,
)

from ..schema import (
    init_db,
)

from .users import (
    _password_salt,
    _password_hash,
    create_user,
    find_user_by_account,
    find_user_by_id,
    verify_user,
    update_user_profile,
    user_diagnostics,
)

from .schedule import (
    _schedule_row_to_dict,
    _save_schedule_constraints,
    _repair_legacy_schedule_constraints,
    _normalize_schedule_values,
    upsert_schedule,
    upsert_schedules_batch,
    schedule_baseline_hash,
    list_schedules,
    delete_schedule,
    _insert_schedule_on_connection,
    _delete_schedules_for_day_on_connection,
)

from .rescue import (
    replace_schedules_with_snapshot,
    undo_schedule_snapshot,
    list_rescue_snapshots,
    _insert_rescue_snapshot_on_connection,
    apply_rescue,
    undo_rescue,
)

from .sync import (
    record_sync_change,
    sync_status,
    pull_sync_changes,
    push_sync_changes,
)

from .microtasks import (
    _microtask_row_to_dict,
    upsert_microtask,
    list_microtasks,
    delete_microtask,
    batch_complete_microtasks,
    import_microtasks,
    batch_schedule_microtasks,
)

from .events import (
    _TASK_EVENT_UPSERT_SQL,
    _task_event_row_to_dict,
    _task_event_values,
    _upsert_task_event_on_connection,
    upsert_task_event,
    upsert_task_events,
    list_task_events,
)

from .review import (
    default_scheduling_tuning,
    get_scheduling_tuning,
    set_scheduling_tuning,
)

from .settings import (
    PREFERENCE_INT_RANGES,
    PREFERENCE_BOOLEAN_KEYS,
    PREFERENCE_ENUM_KEYS,
    default_user_preferences,
    _validate_user_preferences,
    get_user_settings,
    update_user_settings,
)

from .emotion import (
    _emotion_row_to_dict,
    default_emotion_status,
    upsert_emotion_checkin,
    list_emotion_checkins,
    get_current_emotion,
    get_latest_emotion_for_day,
)

from .energy import (
    _energy_row_to_dict,
    default_energy_status,
    upsert_energy_sample,
    get_current_energy,
    get_energy_profile,
)

from .goals import (
    _depends_on_list,
    _goal_task_row_to_dict,
    _list_goal_tasks_on_connection,
    _goal_row_to_dict,
    _normalize_goal_task_payload,
    _validate_goal_tasks,
    _insert_goal_tasks,
    list_goals,
    upsert_goal,
    delete_goal,
    add_goal_task,
    update_goal_task,
    schedule_next_goal_task,
)

from .team import (
    _filter_busy_by_day,
    _team_member_row_to_dict,
    upsert_team_member,
    list_team_members,
    update_team_member_permission,
    delete_team_member,
)

__all__ = [
    "TaskEventConflictError",
    "TaskEventBatchValidationError",
    "RepositoryConflictError",
    "RepositoryNotFoundError",
    "RepositoryValidationError",
    "init_db",
    "create_user",
    "find_user_by_account",
    "find_user_by_id",
    "verify_user",
    "update_user_profile",
    "user_diagnostics",
    "upsert_schedule",
    "upsert_schedules_batch",
    "schedule_baseline_hash",
    "replace_schedules_with_snapshot",
    "undo_schedule_snapshot",
    "list_rescue_snapshots",
    "record_sync_change",
    "sync_status",
    "pull_sync_changes",
    "push_sync_changes",
    "list_schedules",
    "delete_schedule",
    "upsert_microtask",
    "list_microtasks",
    "delete_microtask",
    "batch_complete_microtasks",
    "import_microtasks",
    "batch_schedule_microtasks",
    "upsert_task_event",
    "upsert_task_events",
    "list_task_events",
    "default_scheduling_tuning",
    "get_scheduling_tuning",
    "set_scheduling_tuning",
    "default_user_preferences",
    "get_user_settings",
    "update_user_settings",
    "default_emotion_status",
    "upsert_emotion_checkin",
    "list_emotion_checkins",
    "get_current_emotion",
    "get_latest_emotion_for_day",
    "default_energy_status",
    "upsert_energy_sample",
    "get_current_energy",
    "get_energy_profile",
    "list_goals",
    "upsert_goal",
    "delete_goal",
    "add_goal_task",
    "update_goal_task",
    "schedule_next_goal_task",
    "upsert_team_member",
    "list_team_members",
    "update_team_member_permission",
    "delete_team_member",
    "apply_rescue",
    "undo_rescue",
]
