import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ShieldCheck } from "@/components/ui/reference-icons";
import { apiClient, type ApiComponents } from "@/api/client";
import { isProblemCode } from "@/api/errors";
import { unwrap } from "@/api/unwrap";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, InlineError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useEnergy } from "@/features/energy/queries";
import {
  dayRange,
  isValidDay,
  localDate,
  localTime,
  monthDays,
  shiftDay,
  shiftMonth,
  weekDays,
} from "@/lib/datetime";
import { useAuthStore } from "@/stores/auth-store";
import { CalendarOptionsDrawer, useCalendarOptions } from "./calendar-options";
import { CalendarSummary } from "./calendar-summary";
import { CalendarToolbar, type CalendarView } from "./calendar-toolbar";
import { GanttMap, MonthMap } from "./calendar-views";
import { useInvalidateSchedule, useSchedules } from "./queries";
import { RescuePanel } from "./rescue-panel";
import { ScheduleDetail } from "./schedule-detail";
import { ScheduleEditor } from "./schedule-editor";
import { ScheduleImport } from "./schedule-import";
import { TimeMap } from "./time-map";
import "./calendar-drawers.css";

const secondaryKeys = [
  "time",
  "endTime",
  "new",
  "edit",
  "id",
  "detail",
  "options",
  "import",
  "rescue",
  "trigger",
  "return",
  "title",
  "duration",
  "notes",
];

function useClosingValue(value: string | null) {
  const [retained, setRetained] = useState(value);
  useEffect(() => {
    if (value) {
      setRetained(value);
      return;
    }
    const timer = window.setTimeout(() => setRetained(null), 260);
    return () => window.clearTimeout(timer);
  }, [value]);
  return value ?? retained;
}

function supportsCalendarDate(value: string | null | undefined, timezone: string): value is string {
  if (!isValidDay(value)) return false;
  try {
    const dates = monthDays(value);
    dayRange(dates[0], timezone, dates.length);
    return true;
  } catch {
    return false;
  }
}

export function CalendarPage() {
  const timezone = useAuthStore(s => s.user?.timezone ?? "Asia/Shanghai");
  const today = localDate(new Date(), timezone);
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const invalidate = useInvalidateSchedule();

  const [defaultView] = useState<CalendarView>(() => (window.innerWidth < 780 ? "day" : "week"));
  const requestedDay = params.get("day");
  const day = supportsCalendarDate(requestedDay, timezone) ? requestedDay : today;
  const view = (["day", "week", "month", "gantt"].includes(params.get("view") ?? "")
    ? params.get("view")
    : defaultView) as CalendarView;
  const ganttScale = params.get("scale") === "day" ? "day" : "week";

  const [selectionError, setSelectionError] = useState("");
  const [editing, setEditing] = useState<ApiComponents["ScheduleItemDTO"]>();
  const [detailItem, setDetailItem] = useState<ApiComponents["ScheduleItemDTO"]>();
  const [railOpen, setRailOpen] = useState(false);
  const [rescuePreview, setRescuePreview] = useState<ApiComponents["RescueOptionPlan"]>();
  const [overlapPending, setOverlapPending] = useState<{
    item: ApiComponents["ScheduleItemDTO"];
    startAt: string;
    endAt: string;
    detail: string;
  } | null>(null);

  function navigateCalendar(change: { day?: string; view?: CalendarView; scale?: "day" | "week" }) {
    if (change.day !== undefined && !supportsCalendarDate(change.day, timezone)) {
      setSelectionError("该日期无法显示，请重新选择有效日期。");
      return;
    }
    setSelectionError("");
    const next = new URLSearchParams(params);
    next.set("day", change.day ?? day);
    next.set("view", change.view ?? view);
    next.set("scale", change.scale ?? ganttScale);
    if (next.toString() !== params.toString()) setParams(next);
  }

  const setDay = (value: string) => navigateCalendar({ day: value });
  const setView = (value: CalendarView) => navigateCalendar({ view: value });
  const setGanttScale = (value: "day" | "week") => navigateCalendar({ scale: value });

  const days =
    view === "month"
      ? monthDays(day)
      : view === "day" || (view === "gantt" && ganttScale === "day")
        ? [day]
        : weekDays(day);
  const range = dayRange(days[0], timezone, days.length);
  const schedule = useSchedules(range.from, range.to);
  const energy = useEnergy(day);
  const displayOptions = useCalendarOptions();

  const newOpen = params.has("new");
  const rescueOpen = params.has("rescue");
  const detailId = params.get("detail");
  const editId = params.get("edit") ?? (newOpen ? params.get("id") : null);
  const retainedDetail = useClosingValue(detailId);
  const retainedEditor = useClosingValue(
    newOpen ? editId ?? "new" : params.has("import") && params.get("return") === "new" ? "new" : null,
  );
  const retainedOptions = useClosingValue(params.has("options") ? "options" : null);
  const retainedImport = useClosingValue(params.has("import") ? "import" : null);
  const editorItem =
    retainedEditor && retainedEditor !== "new"
      ? editing?.id === retainedEditor
        ? editing
        : schedule.data?.items.find(item => item.id === retainedEditor)
      : undefined;
  const requestedTrigger = params.get("trigger");
  const initialTrigger =
    requestedTrigger === "wearable_fatigue" || requestedTrigger === "team_meeting_overload"
      ? requestedTrigger
      : "urgent_task";

  function openSecondary(name: string, value = "1", extra: Record<string, string> = {}) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      secondaryKeys.forEach(key => next.delete(key));
      next.set(name, value);
      Object.entries(extra).forEach(([k, v]) => next.set(k, v));
      return next;
    });
  }

  function closeSecondary() {
    setParams(
      previous => {
        const next = new URLSearchParams(previous);
        secondaryKeys.forEach(key => next.delete(key));
        return next;
      },
      { replace: true },
    );
  }

  function openDetail(item: ApiComponents["ScheduleItemDTO"]) {
    setDetailItem(item);
    openSecondary("detail", item.id, { day: localDate(item.startAt, timezone), view, scale: ganttScale });
  }

  function edit(item: ApiComponents["ScheduleItemDTO"]) {
    setEditing(item);
    openSecondary("new", "1", { edit: item.id, day: localDate(item.startAt, timezone), view, scale: ganttScale });
  }

  function createAt(date: string, time = "09:00", endTime?: string) {
    openSecondary("new", "1", {
      day: date,
      time,
      ...(endTime ? { endTime } : {}),
      view,
      scale: ganttScale,
    });
  }

  function stepPeriod(direction: 1 | -1) {
    if (view === "month") setDay(shiftMonth(day, direction));
    else if (view === "day" || (view === "gantt" && ganttScale === "day")) setDay(shiftDay(day, direction));
    else setDay(shiftDay(day, direction * 7));
  }

  const moveOrResize = useMutation({
    mutationFn: async ({
      item,
      startAt,
      endAt,
      allowOverlap,
    }: {
      item: ApiComponents["ScheduleItemDTO"];
      startAt: string;
      endAt: string;
      allowOverlap?: boolean;
    }) =>
      unwrap(
        await apiClient.PATCH("/api/v1/schedule/items/{id}", {
          params: { path: { id: item.id } },
          body: { startAt, endAt, ...(allowOverlap ? { allowOverlap: true } : {}) },
        }),
      ),
    onSuccess: async (_, vars) => {
      setOverlapPending(null);
      await invalidate();
      toast.push({
        tone: "success",
        title: `已调整「${vars.item.title}」`,
        description: `${localTime(vars.startAt, timezone)}–${localTime(vars.endAt, timezone)}`,
      });
    },
    onError: (err, vars) => {
      if (isProblemCode(err, "CONFLICT_SCHEDULE_OVERLAP") && !vars.allowOverlap) {
        setOverlapPending({
          item: vars.item,
          startAt: vars.startAt,
          endAt: vars.endAt,
          detail: err instanceof Error ? err.message : "新时段与锁定日程存在冲突",
        });
      }
    },
  });

  const periodUnit =
    view === "month" ? "月" : view === "day" || (view === "gantt" && ganttScale === "day") ? "天" : "周";

  return (
    <div className="calendar-page">
      <CalendarToolbar
        day={day}
        today={today}
        timezone={timezone}
        view={view}
        periodUnit={periodUnit}
        weekly={view === "week" || (view === "gantt" && ganttScale === "week")}
        options={displayOptions.options}
        railOpen={railOpen}
        error={selectionError || (requestedDay && !supportsCalendarDate(requestedDay, timezone) ? "日期无效或超出可显示范围，已显示今天，请重新选择。" : undefined)}
        onSelectDay={setDay}
        onChangeView={setView}
        onStepPeriod={stepPeriod}
        onChangeOptions={displayOptions.update}
        onOpen={openSecondary}
        onToggleRail={() => setRailOpen(open => !open)}
        onRefresh={() => void schedule.refetch()}
      />

      {moveOrResize.error && !isProblemCode(moveOrResize.error, "CONFLICT_SCHEDULE_OVERLAP") && (
        <div className="my-3">
          <InlineError error={moveOrResize.error} />
        </div>
      )}

      {railOpen && (
        <CalendarSummary
          day={day}
          today={today}
          timezone={timezone}
          items={schedule.data?.items}
          scheduleError={schedule.isError}
          energy={energy.data}
          energyError={energy.isError}
        />
      )}

      <div className="calendar-workspace" data-rail-open={railOpen}>
        <RescuePanel
          key={day}
          day={day}
          initialTrigger={initialTrigger}
          forceOpen={rescueOpen}
          onClose={closeSecondary}
          showSidebar={railOpen}
          onStageChange={setRescuePreview}
        />

        <div className="calendar-map-column">
          {schedule.isPending ? (
            <div className="surface-card">
              <LoadingState label="正在读取时间地图" />
            </div>
          ) : schedule.isError ? (
            <div className="surface-card">
              <ErrorState error={schedule.error} retry={() => void schedule.refetch()} />
            </div>
          ) : (
            <>
              {view === "month" ? (
                <MonthMap
                  onOpenDay={date => navigateCalendar({ day: date, view: "day" })}
                  selectedDay={day}
                  days={days}
                  items={schedule.data.items}
                  timezone={timezone}
                  options={displayOptions.options}
                  onSelectDay={setDay}
                  onEdit={openDetail}
                  onCreate={createAt}
                />
              ) : view === "gantt" ? (
                <GanttMap
                  selectedDay={day}
                  days={days}
                  items={schedule.data.items}
                  timezone={timezone}
                  ganttScale={ganttScale}
                  options={displayOptions.options}
                  onScaleChange={setGanttScale}
                  onSelectDay={setDay}
                  onEdit={openDetail}
                  onCreate={createAt}
                />
              ) : (
                <TimeMap
                  selectedDay={day}
                  onSelectDay={setDay}
                  days={days}
                  items={schedule.data.items}
                  timezone={timezone}
                  energy={energy.data}
                  showEnergy={displayOptions.options.energyBands}
                  options={displayOptions.options}
                  onEdit={openDetail}
                  onCreate={createAt}
                  onMoveOrResize={(item, startAt, endAt) => moveOrResize.mutate({ item, startAt, endAt })}
                  rescuePreview={rescuePreview}
                />
              )}
              {schedule.data.items.length === 0 && view !== "gantt" && (
                <p className="calendar-empty-note">
                  <ShieldCheck size={13} className="inline mr-1" />
                  这段时间尚未安排日程。在时间地图空白处点击或上下拖拽，即可快速创建安排。
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {retainedDetail && (
        <ScheduleDetail
          key={`detail-${retainedDetail}`}
          open={!!detailId}
          id={retainedDetail}
          item={
            detailItem?.id === retainedDetail
              ? detailItem
              : schedule.data?.items.find(item => item.id === retainedDetail)
          }
          loading={schedule.isPending}
          error={schedule.error}
          retry={() => void schedule.refetch()}
          onClose={closeSecondary}
          onEdit={edit}
        />
      )}

      {retainedEditor && (retainedEditor === "new" || editorItem) && (
        <ScheduleEditor
          key={`editor-${editorItem?.id ?? `new-${day}-${params.get("time") ?? ""}-${params.get("endTime") ?? ""}-${params.get("title") ?? ""}`}`}
          open={newOpen}
          onClose={closeSecondary}
          day={day}
          item={editorItem}
          energy={energy.data}
          initialTime={params.get("time") ?? "09:00"}
          initialEndTime={params.get("endTime") ?? undefined}
          initialTitle={params.get("title") ?? ""}
          initialDuration={Number(params.get("duration") || "") || undefined}
          initialNotes={params.get("notes") ?? ""}
          onImport={() => openSecondary("import", "1", { return: "new" })}
        />
      )}

      {retainedEditor && retainedEditor !== "new" && !editorItem && (
        <ScheduleDetail
          open={newOpen}
          id={retainedEditor}
          loading={schedule.isPending}
          error={schedule.error}
          retry={() => void schedule.refetch()}
          onClose={closeSecondary}
          onEdit={edit}
        />
      )}

      {retainedOptions && (
        <CalendarOptionsDrawer
          open={params.has("options")}
          options={displayOptions.options}
          onChange={displayOptions.update}
          storageError={displayOptions.storageError}
          onClose={closeSecondary}
        />
      )}

      {retainedImport && (
        <ScheduleImport
          open={params.has("import")}
          referenceDay={day}
          existing={schedule.data?.items}
          onClose={() => (params.get("return") === "new" ? openSecondary("new") : closeSecondary())}
        />
      )}

      <Dialog
        open={!!overlapPending}
        onOpenChange={open => {
          if (!open && !moveOrResize.isPending) setOverlapPending(null);
        }}
        title="新时段与锁定安排冲突"
        description={overlapPending?.detail}
      >
        <p className="text-sm text-on-surface-variant leading-relaxed">
          你可以取消本次拖动让日程回到原位，或者确认强制重叠保存。
        </p>
        <div className="form-actions">
          <Button variant="outline" disabled={moveOrResize.isPending} onClick={() => setOverlapPending(null)}>
            取消移动
          </Button>
          <Button
            variant="secondary"
            pending={moveOrResize.isPending}
            onClick={() => {
              if (!overlapPending) return;
              moveOrResize.mutate({
                item: overlapPending.item,
                startAt: overlapPending.startAt,
                endAt: overlapPending.endAt,
                allowOverlap: true,
              });
            }}
          >
            强制重叠保存
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
