"""Schedule-relative reminder configuration, separate from notification delivery."""

from datetime import datetime
from typing import Literal

from pydantic import ConfigDict, Field, StrictBool

from .schemas import APIModel


class ReminderUpdate(APIModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    enabled: StrictBool = True
    minutes_before: int | None = Field(default=None, alias="minutesBefore", strict=True, ge=0, le=10080)


class ReminderCreate(ReminderUpdate):
    schedule_id: str = Field(alias="scheduleId", min_length=1, max_length=256, pattern=r"\S")


class ReminderOut(APIModel):
    id: str
    schedule_id: str = Field(alias="scheduleId")
    enabled: bool
    minutes_before: int | None = Field(alias="minutesBefore")
    uses_schedule_offset: bool = Field(alias="usesScheduleOffset")
    status: Literal["ready", "disabled", "notScheduled", "unavailable"]
    trigger_at_local: datetime | None = Field(alias="triggerAtLocal")
    unavailable_reason: Literal["scheduleMissing", "dateRequired", "invalidSchedule", "unsupportedRepeat"] | None = Field(alias="unavailableReason")
