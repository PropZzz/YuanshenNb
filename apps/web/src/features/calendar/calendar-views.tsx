import type { CSSProperties } from "react";
import { LockKeyhole, Plus, ShieldCheck } from "@/components/ui/reference-icons";
import type { ApiComponents } from "@/api/client";
import { Button } from "@/components/ui/button";
import { displayDay, localDate, localTime } from "@/lib/datetime";
import { defaultCalendarOptions, type CalendarOptions } from "./calendar-options";
import { categoryLabels } from "./queries";

type Item = ApiComponents["ScheduleItemDTO"];
const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function dayIndex(day: string) {
  return Date.parse(`${day}T00:00:00Z`) / 86_400_000;
}

function minuteOfDay(value: string, timeZone: string) {
  const [hour, minute] = localTime(value, timeZone).split(":").map(Number);
  return hour * 60 + minute;
}

function overlapsDay(item: Item, day: string, timeZone: string) {
  if (item.status === "cancelled") return false;
  const startDay = localDate(item.startAt, timeZone);
  const endDay = localDate(item.endAt, timeZone);
  return startDay <= day && (endDay > day || (endDay === day && minuteOfDay(item.endAt, timeZone) > 0));
}

export function MonthMap({
  selectedDay,
  days,
  items,
  timezone,
  options = defaultCalendarOptions,
  onSelectDay,
  onEdit,
  onCreate,
}: {
  selectedDay: string;
  days: string[];
  items: Item[];
  timezone: string;
  options?: CalendarOptions;
  onSelectDay: (day: string) => void;
  onEdit: (item: Item) => void;
  onCreate: (day: string, time?: string) => void;
}) {
  const today = localDate(new Date(), timezone);
  const currentMonth = selectedDay.slice(0, 7);

  return (
    <div className="surface-card time-map cal-month-map" role="region" aria-label="月视图日程网格">
      <div className="cal-month-weekdays">
        {weekdays.map(label => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="cal-month-grid">
        {days.map(date => {
          const outside = date.slice(0, 7) !== currentMonth;
          const isToday = date === today;
          const isSelected = date === selectedDay;
          const dayItems = items
            .filter(item => overlapsDay(item, date, timezone))
            .sort((a, b) => a.startAt.localeCompare(b.startAt));
          const visible = dayItems.slice(0, 3);
          const hiddenCount = Math.max(0, dayItems.length - visible.length);

          return (
            <div
              key={date}
              className={`cal-month-day ${outside ? "cal-outside" : ""} ${isSelected ? "cal-selected" : ""}`}
            >
              <div className="cal-month-day-head">
                <button
                  type="button"
                  className="cal-day-number"
                  aria-label={`选择 ${date}`}
                  aria-pressed={isSelected}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() => onSelectDay(date)}
                >
                  {Number(date.slice(-2))}
                </button>
                <button
                  type="button"
                  className="cal-month-add"
                  aria-label={`${date} 新增日程`}
                  onClick={() => {
                    onSelectDay(date);
                    onCreate(date, "09:00");
                  }}
                >
                  <Plus size={12} />
                </button>
              </div>
              <div className="cal-month-events">
                {visible.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className={`map-event cal-event-compact event-${item.category} ${
                      options.completionStatus && item.status === "completed" ? "is-complete" : ""
                    }`}
                    onClick={() => onEdit(item)}
                    aria-label={`${item.title} ${localTime(item.startAt, timezone)}至${localTime(item.endAt, timezone)}`}
                    title={`${item.title} (${localTime(item.startAt, timezone)}–${localTime(item.endAt, timezone)})`}
                  >
                    <span className="event-title">
                      {item.flexibility === "hard_locked" ? (
                        <LockKeyhole size={9} />
                      ) : item.flexibility === "focus_shield" ? (
                        <ShieldCheck size={9} />
                      ) : null}
                      {item.title}
                    </span>
                    <span className="event-time">
                      {localTime(item.startAt, timezone)}
                      {options.attributeTags ? ` · ${categoryLabels[item.category]}` : ""}
                    </span>
                  </button>
                ))}
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    className="cal-month-more"
                    onClick={() => onSelectDay(date)}
                  >
                    +{hiddenCount} 项日程
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <footer className="map-legend">
        <span>
          <i className="event-deep_work" />
          深度工作
        </span>
        <span>
          <i className="event-meeting" />
          协同会议
        </span>
        <span>
          <i className="event-recovery" />
          恢复缓冲
        </span>
        <span>
          <LockKeyhole size={11} />
          固定安排
        </span>
        <span className="ml-auto">{timezone}</span>
      </footer>
    </div>
  );
}

export function GanttMap({
  selectedDay,
  days,
  items,
  timezone,
  ganttScale,
  options = defaultCalendarOptions,
  onScaleChange,
  onSelectDay,
  onEdit,
  onCreate,
}: {
  selectedDay: string;
  days: string[];
  items: Item[];
  timezone: string;
  ganttScale: "week" | "day";
  options?: CalendarOptions;
  onScaleChange: (scale: "week" | "day") => void;
  onSelectDay: (day: string) => void;
  onEdit: (item: Item) => void;
  onCreate: (day: string, time?: string) => void;
}) {
  const now = new Date();
  const today = localDate(now, timezone);
  const nowMinute = minuteOfDay(now.toISOString(), timezone);
  const originDay = days[0];
  const originIndex = dayIndex(originDay);
  const totalMinutes = days.length * 1440;
  const columns = ganttScale === "day" ? 24 : days.length;

  const activeItems = items
    .filter(item => item.status !== "cancelled")
    .map(item => {
      const startDay = localDate(item.startAt, timezone);
      const endDay = localDate(item.endAt, timezone);
      const rawStart = (dayIndex(startDay) - originIndex) * 1440 + minuteOfDay(item.startAt, timezone);
      const rawEnd = (dayIndex(endDay) - originIndex) * 1440 + minuteOfDay(item.endAt, timezone);
      const clampedStart = Math.max(0, rawStart);
      const clampedEnd = Math.min(totalMinutes, rawEnd);
      return { item, rawStart, rawEnd, clampedStart, clampedEnd };
    })
    .filter(row => row.clampedEnd > row.clampedStart)
    .sort((a, b) => a.rawStart - b.rawStart || b.rawEnd - a.rawEnd || a.item.id.localeCompare(b.item.id));

  const showNow = options.nowLine && days.includes(today);
  const nowOffset = (dayIndex(today) - originIndex) * 1440 + nowMinute;
  const nowFraction = Math.min(1, Math.max(0, nowOffset / totalMinutes));

  return (
    <div className="surface-card time-map cal-gantt-map" role="region" aria-label="甘特时间轴">
      <div className="cal-gantt-tools">
        <strong>甘特时间轴</strong>
        <div role="group" aria-label="甘特时间尺度">
          <button
            type="button"
            aria-pressed={ganttScale === "week"}
            onClick={() => onScaleChange("week")}
          >
            按周
          </button>
          <button
            type="button"
            aria-pressed={ganttScale === "day"}
            onClick={() => onScaleChange("day")}
          >
            按日
          </button>
        </div>
      </div>
      <div
        className="cal-gantt-scroll"
        data-gantt-scale={ganttScale}
        style={{ "--gantt-columns": columns } as CSSProperties}
      >
        <div className="cal-gantt-grid">
          <div className="cal-gantt-head">
            <div className="cal-gantt-corner">
              <strong>日程 · {activeItems.length} 项</strong>
              <span>
                {ganttScale === "day"
                  ? `${selectedDay.slice(5).replace("-", "/")} · 每格 1 小时`
                  : "每格 1 天 · 可按日放大"}
              </span>
            </div>
            <div className="cal-gantt-days">
              {ganttScale === "day"
                ? Array.from({ length: 24 }, (_, hour) => (
                    <div className="cal-gantt-hour" key={hour}>
                      {String(hour).padStart(2, "0")}:00
                    </div>
                  ))
                : days.map(date => (
                    <button
                      type="button"
                      key={date}
                      className="cal-gantt-day"
                      aria-label={`选择 ${date}`}
                      aria-pressed={date === selectedDay}
                      aria-current={date === today ? "date" : undefined}
                      onClick={() => onSelectDay(date)}
                    >
                      <span>{displayDay(date, { weekday: "short" })}</span>
                      <strong>{date.slice(5).replace("-", "/")}</strong>
                      {date === today && <small>今天</small>}
                    </button>
                  ))}
            </div>
          </div>
          {activeItems.map(({ item, clampedStart, clampedEnd }) => {
            const startDay = localDate(item.startAt, timezone);
            const endDay = localDate(item.endAt, timezone);
            const startPct = (100 * clampedStart) / totalMinutes;
            const lengthPct = (100 * (clampedEnd - clampedStart)) / totalMinutes;

            return (
              <div className="cal-gantt-row" key={item.id}>
                <button
                  type="button"
                  className="cal-gantt-label"
                  onClick={() => onEdit(item)}
                  aria-label={`${item.title} ${localTime(item.startAt, timezone)}至${localTime(item.endAt, timezone)}`}
                >
                  <strong>
                    {item.flexibility === "hard_locked" ? (
                      <LockKeyhole size={11} />
                    ) : item.flexibility === "focus_shield" ? (
                      <ShieldCheck size={11} />
                    ) : null}
                    {item.title}
                  </strong>
                  <span>
                    {startDay.slice(5)} {localTime(item.startAt, timezone)} –{" "}
                    {endDay !== startDay ? `${endDay.slice(5)} ` : ""}
                    {localTime(item.endAt, timezone)}
                  </span>
                  <small>
                    <i className={`event-${item.category}`} />
                    {categoryLabels[item.category]} · {item.durationMinutes}m
                  </small>
                </button>
                <div className="cal-gantt-track">
                  {ganttScale === "day"
                    ? Array.from({ length: 24 }, (_, hour) => (
                        <span className="cal-gantt-cell" key={hour} aria-hidden="true" />
                      ))
                    : days.map(date => (
                        <span
                          className={`cal-gantt-cell ${date === selectedDay ? "cal-gantt-selected" : ""}`}
                          key={date}
                          aria-hidden="true"
                        />
                      ))}
                  <button
                    type="button"
                    className={`cal-gantt-bar event-${item.category} ${
                      options.completionStatus && item.status === "completed" ? "is-complete" : ""
                    }`}
                    style={
                      {
                        "--gantt-start": `${startPct}%`,
                        "--gantt-length": `${lengthPct}%`,
                      } as CSSProperties
                    }
                    onClick={() => onEdit(item)}
                    aria-label={`查看 ${item.title}`}
                    title={`${item.title} (${localTime(item.startAt, timezone)}–${localTime(item.endAt, timezone)})`}
                  >
                    <span>{item.title}</span>
                  </button>
                </div>
              </div>
            );
          })}
          {showNow && activeItems.length > 0 && (
            <div
              className="cal-gantt-now"
              style={{ "--gantt-now": nowFraction } as CSSProperties}
              aria-label={`当前时间 ${localTime(now.toISOString(), timezone)}`}
            >
              <span>现在</span>
            </div>
          )}
        </div>
        {activeItems.length === 0 && (
          <div className="cal-gantt-empty">
            <span>{ganttScale === "day" ? "这一天" : "本周"}还没有日程</span>
            <Button variant="outline" size="sm" onClick={() => onCreate(selectedDay, "09:00")}>
              <Plus size={14} />
              安排一项日程
            </Button>
          </div>
        )}
      </div>
      <footer className="map-legend">
        <span>
          <i className="event-deep_work" />
          深度工作
        </span>
        <span>
          <i className="event-meeting" />
          协同会议
        </span>
        <span>
          <i className="event-recovery" />
          恢复缓冲
        </span>
        <span>
          <LockKeyhole size={11} />
          固定安排
        </span>
        <span className="ml-auto">{timezone}</span>
      </footer>
    </div>
  );
}
