import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowRight, LockKeyhole, ShieldCheck } from "@/components/ui/reference-icons";
import type { ApiComponents } from "@/api/client";
import { displayDay, localDate, localDateTimeToISO, localTime, minuteLabel } from "@/lib/datetime";
import { tierLabels } from "@/features/energy/queries";
import { layoutDayEvents } from "./calendar-layout";
import { defaultCalendarOptions, type CalendarOptions } from "./calendar-options";
import { AttributeLegend, ScheduleLocation, ScheduleMeta, readScheduleNotes, scheduleStyle } from "./schedule-presentation";

type Item = ApiComponents["ScheduleItemDTO"];
type RescuePlan = ApiComponents["RescueOptionPlan"];
type RescueDiff = ApiComponents["RescueDiffItem"];

function minuteOfDay(iso: string, timezone: string): number {
  const hhmm = localTime(iso, timezone);
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

function isoFromDayMinute(day: string, minute: number, timezone: string): string {
  const clamped = Math.max(0, Math.min(1440, minute));
  if (clamped === 1440) {
    const startMs = Date.parse(localDateTimeToISO(`${day}T00:00`, timezone));
    return new Date(startMs + 86_400_000).toISOString();
  }
  return localDateTimeToISO(`${day}T${minuteLabel(clamped)}`, timezone);
}

interface DragCreateState {
  pointerId: number;
  day: string;
  anchorMinute: number;
  currentMinute: number;
  moved: boolean;
}

interface DragMoveState {
  pointerId: number;
  kind: "move" | "resize";
  item: Item;
  originDay: string;
  originStartMinute: number;
  originEndMinute: number;
  durationMinutes: number;
  pointerOffsetMinute: number;
  startX: number;
  startY: number;
  targetDay: string;
  targetStartMinute: number;
  targetEndMinute: number;
  moved: boolean;
}

export function TimeMap({
  selectedDay,
  onSelectDay,
  days,
  items,
  timezone,
  energy,
  showEnergy,
  onEdit,
  onCreate,
  onMoveOrResize,
  rescuePreview,
  options = defaultCalendarOptions,
}: {
  selectedDay?: string;
  onSelectDay?: (day: string) => void;
  days: string[];
  items: Item[];
  timezone: string;
  energy?: ApiComponents["EnergyTodayResponse"];
  showEnergy: boolean;
  onEdit: (item: Item) => void;
  onCreate: (day: string, time?: string, endTime?: string) => void;
  onMoveOrResize?: (item: Item, startAt: string, endAt: string) => void;
  rescuePreview?: RescuePlan;
  options?: CalendarOptions;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dayButtons = useRef(new Map<string, HTMLButtonElement>());
  const dayColumnRefs = useRef(new Map<string, HTMLDivElement>());

  const [now, setNow] = useState(() => new Date());
  const today = localDate(now, timezone);
  const nowMinutes = Number(localTime(now, timezone).slice(0, 2)) * 60 + Number(localTime(now, timezone).slice(3));

  const events = days.map(day => ({ day, events: layoutDayEvents(items, day, timezone) }));
  const allEvents = events.flatMap(day => day.events);
  const hourHeight = options.hourHeight;

  const rescueMinutes = (rescuePreview?.diffItems ?? []).flatMap(diff => {
    const out: number[] = [];
    if (days.includes(localDate(diff.afterStartAt, timezone))) {
      out.push(Math.floor(minuteOfDay(diff.afterStartAt, timezone) / 60), Math.ceil(minuteOfDay(diff.afterEndAt, timezone) / 60));
    }
    return out;
  });

  const startHour = Math.max(
    0,
    Math.min(
      options.startHour,
      ...allEvents.map(event => Math.floor(event.startMinute / 60)),
      ...rescueMinutes,
      ...(days.includes(today) ? [Math.floor(nowMinutes / 60)] : []),
    ),
  );
  const endHour = Math.min(
    24,
    Math.max(
      options.endHour,
      ...allEvents.map(event => Math.ceil(event.endMinute / 60)),
      ...rescueMinutes,
      ...(days.includes(today) ? [Math.floor(nowMinutes / 60) + 1] : []),
    ),
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (scroll.current) {
      scroll.current.scrollTop =
        options.autoScroll && days.includes(today) ? Math.max(0, (nowMinutes / 60 - startHour - 1) * hourHeight) : 0;
    }
  }, [days.join(","), options.autoScroll, hourHeight, startHour]);

  const columns = `${options.timeRuler ? 58 : 0}px repeat(${days.length}, minmax(${days.length > 1 ? "110" : "220"}px,1fr))`;
  const [slot, setSlot] = useState<{ day: string; minute: number; kind: "pointer" | "keyboard" } | null>(null);
  const [hoveredHour, setHoveredHour] = useState<ApiComponents["HourlyEnergyPoint"] | null>(null);
  const [dragCreate, setDragCreate] = useState<DragCreateState | null>(null);
  const dragCreateRef = useRef<DragCreateState | null>(null);
  const [dragMove, setDragMove] = useState<DragMoveState | null>(null);
  const dragMoveRef = useRef<DragMoveState | null>(null);
  const suppressNextClick = useRef(false);
  const help = useId();
  const pointerHint=slot?.kind==='pointer'&&!dragCreate?.moved&&!dragMove?.moved&&!rescuePreview&&slot.minute>=startHour*60&&slot.minute<endHour*60?slot:null;
  const pointerHintTop=pointerHint?Math.max(10,Math.min((endHour-startHour)*hourHeight-10,(pointerHint.minute/60-startHour)*hourHeight)):0;

  useEffect(() => {
    setSlot(previous => (previous?.day === selectedDay ? previous : null));
    setHoveredHour(null);
  }, [selectedDay, showEnergy]);

  const clampMinute = (value: number) => Math.max(startHour * 60, Math.min(endHour * 60 - 15, 1425, value));
  const initialMinute = clampMinute(9 * 60);

  useEffect(() => {
    if (slot?.kind === "keyboard") {
      scroll.current?.querySelector<HTMLElement>("[data-slot-preview]")?.scrollIntoView?.({
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [slot]);

  function minuteFromClientY(element: HTMLElement, clientY: number, snap = 15): number {
    if (!Number.isFinite(clientY)) return startHour * 60;
    const rect = element.getBoundingClientRect();
    const raw = ((clientY - rect.top) / hourHeight) * 60 + startHour * 60;
    return Math.max(startHour * 60, Math.min(endHour * 60, Math.floor(raw / snap) * snap));
  }

  function pointerMinute(button: HTMLButtonElement, clientY: number) {
    return clampMinute(minuteFromClientY(button, clientY, 15));
  }

  function dayFromClientX(clientX: number, fallbackDay: string): string {
    for (const day of days) {
      const col = dayColumnRefs.current.get(day);
      if (!col) continue;
      const rect = col.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) {
        return day;
      }
    }
    return fallbackDay;
  }

  function moveSlot(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    const current = slot?.day === day ? slot.minute : initialMinute;
    let minute = current;
    let target = day;
    if (event.key === "ArrowUp") minute = current - 15;
    else if (event.key === "ArrowDown") minute = current + 15;
    else if (event.key === "Home") minute = startHour * 60;
    else if (event.key === "End") minute = endHour * 60 - 15;
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      target = days[Math.max(0, Math.min(days.length - 1, days.indexOf(day) + (event.key === "ArrowRight" ? 1 : -1)))];
    } else return;
    event.preventDefault();
    setSlot({ day: target, minute: clampMinute(minute), kind: "keyboard" });
    if (target !== day) {
      dayButtons.current.get(target)?.focus({ preventScroll: true });
      onSelectDay?.(target);
    }
  }

  // Drag-to-Create Pointer Handlers
  function handleCreatePointerDown(event: ReactPointerEvent<HTMLButtonElement>, day: string) {
    if (rescuePreview || (event.button !== undefined && event.button !== 0)) return;
    const pointerId = event.pointerId ?? 1;
    const anchorMinute = clampMinute(minuteFromClientY(event.currentTarget, event.clientY, 15));
    setSlot(event.pointerType==='mouse'?{day,minute:anchorMinute,kind:'pointer'}:null);
    setHoveredHour(null);
    try {
      event.currentTarget.setPointerCapture?.(pointerId);
    } catch {
      // Ignore capture errors in synthetic browsers
    }
    const next: DragCreateState = {
      pointerId,
      day,
      anchorMinute,
      currentMinute: anchorMinute + 30,
      moved: false,
    };
    dragCreateRef.current = next;
    setDragCreate(next);
  }

  function handleCreatePointerMove(event: ReactPointerEvent<HTMLButtonElement>, day: string) {
    const pointerId = event.pointerId ?? 1;
    const active = dragCreateRef.current;
    if (active && active.pointerId === pointerId && active.day === day) {
      const next = Math.max(startHour * 60, Math.min(endHour * 60, minuteFromClientY(event.currentTarget, event.clientY, 15)));
      const updated: DragCreateState = {
        ...active,
        currentMinute: next,
        moved: active.moved || Math.abs(next - active.anchorMinute) >= 15,
      };
      dragCreateRef.current = updated;
      setDragCreate(updated);
      return;
    }
    if (event.pointerType === "mouse") {
      const minute = pointerMinute(event.currentTarget, event.clientY);
      setSlot(previous=>previous?.day===day&&previous.minute===minute&&previous.kind==='pointer'?previous:{day,minute,kind:'pointer'});
      setHoveredHour(showEnergy && energy?.localDay === day
        ? energy.hourlyCurve.find(point => Math.floor(minuteOfDay(point.hourStartAt, timezone) / 60) === Math.floor(minute / 60)) ?? null
        : null);
    }
  }

  function handleCreatePointerUp(event: ReactPointerEvent<HTMLButtonElement>, day: string) {
    const pointerId = event.pointerId ?? 1;
    const active = dragCreateRef.current;
    if (!active || active.pointerId !== pointerId || active.day !== day) return;
    dragCreateRef.current = null;
    setDragCreate(null);
    if (active.moved) {
      suppressNextClick.current = true;
      const startM = Math.min(active.anchorMinute, active.currentMinute);
      const endM = Math.min(endHour * 60, Math.max(startM + 15, Math.max(active.anchorMinute, active.currentMinute)));
      onCreate(day, minuteLabel(startM), minuteLabel(Math.min(1435, endM)));
    }
  }

  // Drag-to-Move & Resize Pointer Handlers
  function handleEventPointerDown(
    event: ReactPointerEvent<HTMLElement>,
    item: Item,
    day: string,
    startMinute: number,
    endMinute: number,
    kind: "move" | "resize",
  ) {
    if (rescuePreview || !onMoveOrResize || item.meetingProposalId || (event.button !== undefined && event.button !== 0)) return;
    event.stopPropagation();
    const pointerId = event.pointerId ?? 1;
    const clientX = Number.isFinite(event.clientX) ? event.clientX : 0;
    const clientY = Number.isFinite(event.clientY) ? event.clientY : 0;
    const col = dayColumnRefs.current.get(day);
    const pointerMin = col ? minuteFromClientY(col, clientY, 15) : startMinute;
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(pointerId);
    } catch {
      // Ignore synthetic capture failures
    }
    const next: DragMoveState = {
      pointerId,
      kind,
      item,
      originDay: day,
      originStartMinute: startMinute,
      originEndMinute: endMinute,
      durationMinutes: Math.max(15, endMinute - startMinute),
      pointerOffsetMinute: Math.max(0, pointerMin - startMinute),
      startX: clientX,
      startY: clientY,
      targetDay: day,
      targetStartMinute: startMinute,
      targetEndMinute: endMinute,
      moved: false,
    };
    dragMoveRef.current = next;
    setDragMove(next);
  }

  function handleEventPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const pointerId = event.pointerId ?? 1;
    const active = dragMoveRef.current;
    if (!active || active.pointerId !== pointerId) return;
    const clientX = Number.isFinite(event.clientX) ? event.clientX : active.startX;
    const clientY = Number.isFinite(event.clientY) ? event.clientY : active.startY;
    const dist = Math.hypot(clientX - active.startX, clientY - active.startY);
    const moved = active.moved || dist >= 6;
    if (!moved) return;

    const targetDay = active.kind === "move" ? dayFromClientX(clientX, active.originDay) : active.originDay;
    const col = dayColumnRefs.current.get(targetDay) ?? bodyRef.current;
    if (!col) return;

    if (active.kind === "move") {
      const pointerMin = minuteFromClientY(col, clientY, 15);
      const nextStart = Math.max(
        startHour * 60,
        Math.min(endHour * 60 - active.durationMinutes, pointerMin - active.pointerOffsetMinute),
      );
      const snappedStart = Math.round(nextStart / 15) * 15;
      const updated: DragMoveState = {
        ...active,
        moved: true,
        targetDay,
        targetStartMinute: snappedStart,
        targetEndMinute: snappedStart + active.durationMinutes,
      };
      dragMoveRef.current = updated;
      setDragMove(updated);
    } else {
      const pointerMin = minuteFromClientY(col, clientY, 15);
      const nextEnd = Math.max(active.originStartMinute + 15, Math.min(endHour * 60, pointerMin));
      const updated: DragMoveState = {
        ...active,
        moved: true,
        targetEndMinute: nextEnd,
      };
      dragMoveRef.current = updated;
      setDragMove(updated);
    }
  }

  function handleEventPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const pointerId = event.pointerId ?? 1;
    const active = dragMoveRef.current;
    if (!active || active.pointerId !== pointerId) return;
    dragMoveRef.current = null;
    setDragMove(null);
    if (!active.moved) return;

    suppressNextClick.current = true;
    const changed =
      active.targetDay !== active.originDay ||
      active.targetStartMinute !== active.originStartMinute ||
      active.targetEndMinute !== active.originEndMinute;
    if (changed && onMoveOrResize) {
      const nextStartAt = isoFromDayMinute(active.targetDay, active.targetStartMinute, timezone);
      const nextEndAt = isoFromDayMinute(active.targetDay, active.targetEndMinute, timezone);
      onMoveOrResize(active.item, nextStartAt, nextEndAt);
    }
  }

  // Group Rescue diffItems by day for Visual Ghost-Timeline
  const diffByDay = new Map<string, { ghosts: RescueDiff[]; targets: RescueDiff[] }>();
  if (rescuePreview) {
    for (const day of days) diffByDay.set(day, { ghosts: [], targets: [] });
    for (const diff of rescuePreview.diffItems) {
      if (diff.beforeStartAt && diff.beforeEndAt && (diff.op === "move" || diff.op === "defer")) {
        const bDay = localDate(diff.beforeStartAt, timezone);
        diffByDay.get(bDay)?.ghosts.push(diff);
      }
      const aDay = localDate(diff.afterStartAt, timezone);
      if (diff.op !== "unchanged") {
        diffByDay.get(aDay)?.targets.push(diff);
      }
    }
  }

  const movedOrDeferredIds = new Set(
    (rescuePreview?.diffItems ?? [])
      .filter(d => d.itemId && (d.op === "move" || d.op === "defer"))
      .map(d => d.itemId!),
  );

  return (
    <div className={`surface-card time-map ${rescuePreview ? "is-rescue-staging" : ""}`}>
      <div className="time-map-scroll" ref={scroll} tabIndex={0} aria-label="日程时间地图">
        <div className="time-map-inner" data-view={days.length === 1 ? "day" : "week"} style={{ minWidth: days.length > 1 ? "780px" : undefined }}>
          <div className="time-map-dates" style={{ gridTemplateColumns: columns }}>
            <div className="map-timezone">
              {options.timeRuler && (
                <>
                  GMT
                  {new Intl.DateTimeFormat("en", { timeZone: timezone, timeZoneName: "shortOffset" })
                    .formatToParts(now)
                    .find(part => part.type === "timeZoneName")
                    ?.value.replace("GMT", "")}
                </>
              )}
            </div>
            {days.map(day => (
              <button
                type="button"
                key={day}
                className={`map-date ${day === today ? "today " : ""}${day === selectedDay ? "selected" : ""}`}
                aria-label={`选择 ${day}`}
                aria-pressed={day === selectedDay}
                aria-current={day === today ? "date" : undefined}
                onClick={() => onSelectDay?.(day)}
              >
                <span>{displayDay(day, { weekday: "short" })}</span>
                <strong>{Number(day.slice(-2))}</strong>
                <small>{events.find(value => value.day === day)?.events.length ?? 0} 项安排</small>
                {showEnergy && energy?.localDay === day && <span className="map-date-energy" title={`${energy.score} 分 · ${tierLabels[energy.tier] ?? "精力预测"}`}>精力 {energy.score}</span>}
              </button>
            ))}
          </div>

          <div
            ref={bodyRef}
            className="time-map-body"
            data-hour-height={hourHeight}
            style={{ gridTemplateColumns: columns, height: (endHour - startHour) * hourHeight }}
          >
            {options.timeRuler ? (
              <div className="map-hours">
                {Array.from({ length: endHour - startHour }, (_, index) => {
                  const hour = startHour + index;
                  return (
                    <span key={hour} style={{ top: index * hourHeight }}>
                      {minuteLabel(hour * 60)}
                    </span>
                  );
                })}
                {hoveredHour && (
                  <div
                    className="map-energy-tooltip"
                    data-pointer-time-hint={pointerHint?true:undefined}
                    style={{
                      top: Math.max(
                        6,
                        (Number(localTime(hoveredHour.hourStartAt, timezone).slice(0, 2)) - startHour) * hourHeight,
                      ),
                    }}
                  >
                    <strong>{pointerHint?minuteLabel(pointerHint.minute):localTime(hoveredHour.hourStartAt, timezone)}</strong>
                    <span>
                      {hoveredHour.score} 分 · {tierLabels[hoveredHour.tier]}
                    </span>
                  </div>
                )}
                {pointerHint&&!hoveredHour&&<time data-pointer-time-hint className="map-pointer-time" aria-hidden="true" style={{top:pointerHintTop}}>{minuteLabel(pointerHint.minute)}</time>}
              </div>
            ) : (
              <div aria-hidden="true" />
            )}

            {events.map(({ day, events: dayEvents }) => {
              const dayDiffs = diffByDay.get(day);
              return (
                <div
                  className="map-day"
                  data-day={day}
                  data-selected={day === selectedDay}
                  key={day}
                  ref={node => {
                    if (node) dayColumnRefs.current.set(day, node);
                    else dayColumnRefs.current.delete(day);
                  }}
                  style={{ backgroundSize: `100% ${hourHeight}px` }}
                >
                  {showEnergy && energy?.localDay === day && (
                    <>
                      <div className="map-energy-wash" aria-hidden="true">
                        {energy.hourlyCurve
                          .filter(point => {
                            const hour = Number(localTime(point.hourStartAt, timezone).slice(0, 2));
                            return hour >= startHour && hour < endHour;
                          })
                          .map(point => (
                            <i
                              key={point.hourStartAt}
                              className={`energy-wash-${point.tier}`}
                              style={{
                                top: (Number(localTime(point.hourStartAt, timezone).slice(0, 2)) - startHour) * hourHeight,
                                height: hourHeight,
                              }}
                            />
                          ))}
                      </div>
                    </>
                  )}

                  {options.buffersAndReminders &&
                    energy?.localDay === day &&
                    energy.focusShields.map((window, index) => {
                      const start =
                        localDate(window.startAt, timezone) === day
                          ? Math.max(
                              startHour * 60,
                              Number(localTime(window.startAt, timezone).slice(0, 2)) * 60 +
                                Number(localTime(window.startAt, timezone).slice(3)),
                            )
                          : startHour * 60;
                      const end =
                        localDate(window.endAt, timezone) === day
                          ? Math.min(
                              endHour * 60,
                              Number(localTime(window.endAt, timezone).slice(0, 2)) * 60 +
                                Number(localTime(window.endAt, timezone).slice(3)),
                            )
                          : endHour * 60;
                      return end > start ? (
                        <div
                          key={index}
                          className="map-focus-window"
                          title={`深度保护窗口 ${localTime(window.startAt, timezone)}–${localTime(window.endAt, timezone)} · 均值 ${window.avgScore} 分`}
                          aria-label={`深度保护窗口 ${localTime(window.startAt, timezone)}至${localTime(window.endAt, timezone)}`}
                          style={{
                            top: (start / 60 - startHour) * hourHeight,
                            height: ((end - start) / 60) * hourHeight,
                          }}
                        >
                          <span>
                            <ShieldCheck size={11} aria-hidden="true" />
                            专注保护窗 · 均值 {window.avgScore}
                          </span>
                        </div>
                      ) : null;
                    })}

                  <button
                    type="button"
                    className="map-day-create"
                    ref={button => {
                      if (button) dayButtons.current.set(day, button);
                      else dayButtons.current.delete(day);
                    }}
                    aria-describedby={help}
                    aria-label={`${day} 新增日程`}
                    aria-description={`已选 ${minuteLabel(slot?.day === day ? slot.minute : initialMinute)}`}
                    onKeyDown={event => moveSlot(event, day)}
                    onFocus={event => {
                      if(!event.currentTarget.matches(':focus-visible'))return;
                      setSlot(previous =>
                        previous?.day === day
                          ? previous
                          : { day, minute: initialMinute, kind: "keyboard" },
                      );
                    }}
                    onBlur={()=>{setSlot(previous=>previous?.day===day?null:previous);setHoveredHour(null);}}
                    onPointerDown={event => handleCreatePointerDown(event, day)}
                    onPointerMove={event => handleCreatePointerMove(event, day)}
                    onPointerUp={event => handleCreatePointerUp(event, day)}
                    onPointerCancel={() => { dragCreateRef.current = null; setDragCreate(null);setSlot(previous=>previous?.day===day?null:previous);setHoveredHour(null); }}
                    onPointerLeave={() => { setSlot(previous => (previous?.kind === "pointer"&&previous.day===day ? null : previous)); setHoveredHour(null); }}
                    onClick={event => {
                      if (suppressNextClick.current) {
                        suppressNextClick.current = false;
                        return;
                      }
                      onCreate(
                        day,
                        minuteLabel(
                          event.detail === 0
                            ? slot?.day === day
                              ? slot.minute
                              : initialMinute
                            : pointerMinute(event.currentTarget, event.clientY),
                        ),
                      );
                    }}
                  />

                  {!options.timeRuler&&pointerHint?.day===day&&<time data-pointer-time-hint className="map-pointer-time is-in-grid" aria-hidden="true" style={{top:pointerHintTop}}>{minuteLabel(pointerHint.minute)}</time>}

                  {dragCreate && dragCreate.moved && dragCreate.day === day && (
                    <div
                      className="map-drag-create-preview"
                      aria-hidden="true"
                      style={{
                        top: (Math.min(dragCreate.anchorMinute, dragCreate.currentMinute) / 60 - startHour) * hourHeight,
                        height: Math.max(
                          20,
                          (Math.abs(dragCreate.currentMinute - dragCreate.anchorMinute) / 60) * hourHeight,
                        ),
                      }}
                    >
                      <span>
                        + {minuteLabel(Math.min(dragCreate.anchorMinute, dragCreate.currentMinute))}–
                        {minuteLabel(
                          Math.max(
                            Math.min(dragCreate.anchorMinute, dragCreate.currentMinute) + 15,
                            Math.max(dragCreate.anchorMinute, dragCreate.currentMinute),
                          ),
                        )}
                      </span>
                    </div>
                  )}

                  {!dragCreate?.moved && slot?.kind==='keyboard' && slot.day === day && slot.minute >= startHour * 60 && slot.minute < endHour * 60 && (
                    <div
                      data-slot-preview
                      className="map-slot-preview"
                      aria-hidden="true"
                      style={{
                        top: (slot.minute / 60 - startHour) * hourHeight,
                        height: Math.max(20, hourHeight / 4),
                      }}
                    >
                      + {minuteLabel(slot.minute)}
                    </div>
                  )}

                  {dayEvents.map(event => {
                    const isDraggedOut = dragMove?.moved && dragMove.item.id === event.item.id;
                    const isRescueReplaced = movedOrDeferredIds.has(event.item.id);
                    const notes=readScheduleNotes(event.item.notes).notes;
                    return (
                      <div
                        key={event.item.id}
                        className={`map-event-wrap ${isDraggedOut ? "is-dragging-source" : ""} ${
                          isRescueReplaced ? "is-rescue-hidden" : ""
                        }`}
                        style={{
                          top: (event.startMinute / 60 - startHour) * hourHeight,
                          height: Math.max(27, ((event.endMinute - event.startMinute) / 60) * hourHeight - 3),
                          left: `calc(${(event.column / event.columns) * 100}% + 7px)`,
                          width: `calc(${100 / event.columns}% - 12px)`,
                        }}
                      >
                        <button
                          type="button"
                          data-attribute={event.item.presentation?.attributeTag}
                          title={`${event.item.title} (${localTime(event.item.startAt, timezone)}–${localTime(event.item.endAt, timezone)})${event.item.notes ? `\n${event.item.notes}` : ""}${event.item.meetingProposalId ? "\n团队会议请在团队页调整" : ""}`}
                          className={`map-event event-${event.item.category} ${
                            options.completionStatus && event.item.status === "completed" ? "is-complete" : ""
                          } ${!event.item.meetingProposalId && onMoveOrResize && !rescuePreview ? "is-draggable" : ""}`}
                          style={scheduleStyle(event.item)}
                          onPointerDown={e =>
                            handleEventPointerDown(
                              e,
                              event.item,
                              day,
                              event.startMinute,
                              event.endMinute,
                              "move",
                            )
                          }
                          onPointerMove={handleEventPointerMove}
                          onPointerUp={handleEventPointerUp}
                          onPointerCancel={() => { dragMoveRef.current = null; setDragMove(null); }}
                          onClick={() => {
                            if (suppressNextClick.current) {
                              suppressNextClick.current = false;
                              return;
                            }
                            onEdit(event.item);
                          }}
                          aria-label={`${event.item.title} ${localTime(event.item.startAt, timezone)}至${localTime(event.item.endAt, timezone)}`}
                        >
                          <span className="event-heading">
                            <span className="event-title">
                              {event.item.flexibility === "hard_locked" ? (
                                <LockKeyhole size={10} />
                              ) : event.item.flexibility === "focus_shield" ? (
                                <ShieldCheck size={10} />
                              ) : null}
                              <span className="event-title-text">{event.item.title}</span>
                            </span>
                            <span className="event-time">
                              {localTime(event.item.startAt, timezone)}–{localTime(event.item.endAt, timezone)}
                            </span>
                          </span>
                          <ScheduleLocation item={event.item}/>
                          <ScheduleMeta item={event.item} options={options} />
                          {notes && <span className="event-detail">{notes}</span>}
                        </button>
                        {!event.item.meetingProposalId && onMoveOrResize && !rescuePreview && (
                          <div
                            role="presentation"
                            data-resize-handle
                            className="map-event-resize-handle"
                            title="拖拽底边调整时长"
                            onPointerDown={e =>
                              handleEventPointerDown(
                                e,
                                event.item,
                                day,
                                event.startMinute,
                                event.endMinute,
                                "resize",
                              )
                            }
                            onPointerMove={handleEventPointerMove}
                            onPointerUp={handleEventPointerUp}
                            onPointerCancel={() => { dragMoveRef.current = null; setDragMove(null); }}
                          />
                        )}
                      </div>
                    );
                  })}

                  {dragMove?.moved && dragMove.targetDay === day && (
                    <div
                      className="map-drag-move-preview"
                      aria-hidden="true"
                      style={{
                        top: (dragMove.targetStartMinute / 60 - startHour) * hourHeight,
                        height: Math.max(
                          24,
                          ((dragMove.targetEndMinute - dragMove.targetStartMinute) / 60) * hourHeight - 3,
                        ),
                      }}
                    >
                      <strong>{dragMove.item.title}</strong>
                      <span>
                        {minuteLabel(dragMove.targetStartMinute)}–{minuteLabel(dragMove.targetEndMinute)}
                      </span>
                    </div>
                  )}

                  {/* Ghost-Timeline Rescue Layer */}
                  {dayDiffs?.ghosts.map((diff, idx) => {
                    const bStart = minuteOfDay(diff.beforeStartAt!, timezone);
                    const bEnd = Math.max(bStart + 15, minuteOfDay(diff.beforeEndAt!, timezone));
                    return (
                      <div
                        key={`ghost-${diff.itemId ?? diff.title}-${idx}`}
                        className="map-rescue-ghost"
                        style={{
                          top: (bStart / 60 - startHour) * hourHeight,
                          height: Math.max(26, ((bEnd - bStart) / 60) * hourHeight - 3),
                        }}
                      >
                        <span className="rescue-pill-tag">原时段</span>
                        <strong>{diff.title}</strong>
                        <small>
                          {localTime(diff.beforeStartAt!, timezone)}–{localTime(diff.beforeEndAt!, timezone)}
                        </small>
                      </div>
                    );
                  })}

                  {dayDiffs?.targets.map((diff, idx) => {
                    const aStart = minuteOfDay(diff.afterStartAt, timezone);
                    const aEnd = Math.max(aStart + 15, minuteOfDay(diff.afterEndAt, timezone));
                    return (
                      <div
                        key={`target-${diff.itemId ?? diff.title}-${idx}`}
                        className={`map-rescue-target op-${diff.op}`}
                        style={{
                          top: (aStart / 60 - startHour) * hourHeight,
                          height: Math.max(30, ((aEnd - aStart) / 60) * hourHeight - 3),
                        }}
                      >
                        <span className="rescue-pill-tag">
                          {diff.op === "create" ? "新增" : diff.op === "defer" ? "顺延" : "调整后"}
                        </span>
                        <strong>{diff.title}</strong>
                        <small>
                          {diff.beforeStartAt && (
                            <>
                              {localTime(diff.beforeStartAt, timezone)} <ArrowRight size={10} className="inline" />{" "}
                            </>
                          )}
                          {localTime(diff.afterStartAt, timezone)}–{localTime(diff.afterEndAt, timezone)}
                        </small>
                        <em>{diff.reasonLabel}</em>
                      </div>
                    );
                  })}

                  {day === today && options.nowLine && (
                    <div
                      className="map-now-line"
                      style={{ top: (nowMinutes / 60 - startHour) * hourHeight }}
                      aria-label={`当前时间 ${minuteLabel(nowMinutes)}`}
                    >
                      <span>现在 {minuteLabel(nowMinutes)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p id={help} className="sr-only">
        上下方向键选择 15 分钟时间点，左右方向键切换日期，Home 和 End 到达首尾，按回车打开新增日程；桌面端可拖拽新建、移动或调整日程时长。
      </p>

      <footer className="map-legend">
        {options.attributeTags && <AttributeLegend items={items} />}
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
