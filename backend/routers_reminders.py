from datetime import date

from fastapi import APIRouter, Depends, Request, Response

from .auth import current_user_id
from .repositories.reminders import create_reminder, delete_reminder, list_reminders, update_reminder
from .schemas_reminders import ReminderCreate, ReminderOut, ReminderUpdate


router = APIRouter(prefix="/reminders", tags=["reminders"])


@router.get("", response_model=list[ReminderOut])
def get_reminders(
    request: Request, day: date | None = None, user_id: str = Depends(current_user_id),
) -> list[dict[str, object]]:
    return list_reminders(request.app.state.db_path, user_id, day)


@router.post("", response_model=ReminderOut, status_code=201)
def post_reminder(
    payload: ReminderCreate, request: Request, user_id: str = Depends(current_user_id),
) -> dict[str, object]:
    return create_reminder(request.app.state.db_path, user_id, **payload.model_dump())


@router.put("/{reminder_id}", response_model=ReminderOut)
def put_reminder(
    reminder_id: str, payload: ReminderUpdate, request: Request, user_id: str = Depends(current_user_id),
) -> dict[str, object]:
    return update_reminder(request.app.state.db_path, user_id, reminder_id, **payload.model_dump())


@router.delete("/{reminder_id}", status_code=204)
def remove_reminder(
    reminder_id: str, request: Request, user_id: str = Depends(current_user_id),
) -> Response:
    delete_reminder(request.app.state.db_path, user_id, reminder_id)
    return Response(status_code=204)
