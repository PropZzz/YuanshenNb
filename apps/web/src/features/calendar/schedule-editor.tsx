import { useId, useMemo, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlarmClock,
  AlertTriangle,
  CalendarDays,
  CheckCheck,
  Clock3,
  FileUp,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
} from "@/components/ui/reference-icons";
import { apiClient, type ApiComponents } from "@/api/client";
import { assertSuccess, unwrap } from "@/api/unwrap";
import { Button } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/date-time-field";
import { Drawer } from "@/components/ui/drawer";
import { InlineError, Notice } from "@/components/ui/states";
import { localDateTimeToISO, localInput, localTime } from "@/lib/datetime";
import { useAuthStore } from "@/stores/auth-store";
import { categoryLabels, loadLabels, useInvalidateSchedule } from "./queries";
import { scheduleAttributes } from "./schedule-presentation";

type Item = ApiComponents["ScheduleItemDTO"];

function findSuggestedWindow(
  energy: ApiComponents["EnergyTodayResponse"] | undefined,
  durationMinutes: number,
  timezone: string,
): { start: string; end: string; score: number; label: string } | null {
  if (!energy) return null;
  if (energy.focusShields.length > 0) {
    const shield = [...energy.focusShields].sort((a, b) => b.avgScore - a.avgScore)[0];
    const startMs = Date.parse(shield.startAt);
    const endMs = Math.min(Date.parse(shield.endAt), startMs + durationMinutes * 60_000);
    if (endMs > startMs) {
      return {
        start: localInput(new Date(startMs).toISOString(), timezone),
        end: localInput(new Date(endMs).toISOString(), timezone),
        score: shield.avgScore,
        label: `${localTime(shield.startAt, timezone)}–${localTime(new Date(endMs).toISOString(), timezone)} 专注保护窗`,
      };
    }
  }
  const peak = [...energy.hourlyCurve]
    .filter(p => p.tier === "peak" || p.tier === "steady")
    .sort((a, b) => b.score - a.score)[0];
  if (!peak) return null;
  const startMs = Date.parse(peak.hourStartAt);
  const endMs = startMs + durationMinutes * 60_000;
  return {
    start: localInput(new Date(startMs).toISOString(), timezone),
    end: localInput(new Date(endMs).toISOString(), timezone),
    score: peak.score,
    label: `${localTime(peak.hourStartAt, timezone)}–${localTime(new Date(endMs).toISOString(), timezone)} 高精力时段`,
  };
}

export function ScheduleEditor({
  open,
  onClose,
  day,
  item,
  energy,
  onImport,
  initialTime = "09:00",
  initialEndTime,
  initialTitle = "",
  initialDuration,
  initialNotes = "",
}: {
  open: boolean;
  onClose: () => void;
  day: string;
  item?: Item;
  energy?: ApiComponents["EnergyTodayResponse"];
  onImport?: () => void;
  initialTime?: string;
  initialEndTime?: string;
  initialTitle?: string;
  initialDuration?: number;
  initialNotes?: string;
}) {
  const timezone = useAuthStore(s => s.user?.timezone ?? "Asia/Shanghai");
  const invalidate = useInvalidateSchedule();
  const choiceName = useId();
  const [attribute, setAttribute] = useState(item?.presentation?.attributeTag ?? "");

  const safeTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(initialTime) ? initialTime : "09:00";
  const initialStart = item ? localInput(item.startAt, timezone) : `${day}T${safeTime}`;
  const defaultMinutes =
    initialDuration && Number.isInteger(initialDuration) && initialDuration >= 5 && initialDuration <= 1440
      ? initialDuration
      : 60;
  const computedInitialEnd = item
    ? localInput(item.endAt, timezone)
    : initialEndTime && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(initialEndTime)
      ? `${day}T${initialEndTime}`
      : localInput(
          new Date(Date.parse(localDateTimeToISO(initialStart, timezone)) + defaultMinutes * 60_000).toISOString(),
          timezone,
        );

  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(computedInitialEnd);
  const [title, setTitle] = useState(item?.title ?? initialTitle);
  const [notes, setNotes] = useState(item?.notes ?? initialNotes);
  const [deadline, setDeadline] = useState(item?.deadlineAt ? localInput(item.deadlineAt, timezone) : "");
  const [allowOverlap, setAllowOverlap] = useState(false);
  const [category, setCategory] = useState<Item["category"]>(item?.category ?? "deep_work");
  const [load, setLoad] = useState<Item["cognitiveLoad"]>(item?.cognitiveLoad ?? "medium");
  const [protection, setProtection] = useState<Item["flexibility"]>(item?.flexibility ?? "flexible");
  const [reminder, setReminder] = useState(item?.reminderMinutes ?? 30);
  const [validation, setValidation] = useState<unknown>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useMutation({
    mutationFn: async (body: ApiComponents["CreateScheduleItemRequest"]) =>
      item
        ? unwrap(
            await apiClient.PATCH("/api/v1/schedule/items/{id}", {
              params: { path: { id: item.id } },
              body: { ...body, ...(!body.deadlineAt ? { clearDeadline: true } : {}) },
            }),
          )
        : unwrap(await apiClient.POST("/api/v1/schedule/items", { body })),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (item) {
        assertSuccess(await apiClient.DELETE("/api/v1/schedule/items/{id}", { params: { path: { id: item.id } } }));
      }
    },
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });

  const complete = useMutation({
    mutationFn: async () => {
      if (item) {
        unwrap(
          await apiClient.PATCH("/api/v1/schedule/items/{id}", {
            params: { path: { id: item.id } },
            body: { status: item.status === "completed" ? "planned" : "completed" },
          }),
        );
      }
    },
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });

  const pending = save.isPending || remove.isPending || complete.isPending;

  let duration = 0;
  try {
    duration = Math.round(
      (Date.parse(localDateTimeToISO(end, timezone)) - Date.parse(localDateTimeToISO(start, timezone))) / 60_000,
    );
  } catch {
    // Incomplete input stays editable; submit handles validation
  }

  function setDuration(minutes: number) {
    try {
      if (minutes >= 5 && minutes <= 1440) {
        setEnd(
          localInput(
            new Date(Date.parse(localDateTimeToISO(start, timezone)) + minutes * 60_000).toISOString(),
            timezone,
          ),
        );
      }
    } catch {
      setValidation(new Error("请先填写完整的开始时间"));
    }
  }

  // Non-blocking lookup against server energy curve for high-load tasks in low-energy windows
  const lowEnergyAdvice = useMemo(() => {
    if (load !== "high" || !energy || !energy.hourlyCurve.length) return null;
    try {
      const startMs = Date.parse(localDateTimeToISO(start, timezone));
      const endMs = Date.parse(localDateTimeToISO(end, timezone));
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
      const startDay = start.slice(0, 10);
      if (energy.localDay !== startDay) return null;

      const overlappingPoints = energy.hourlyCurve.filter(point => {
        const ptStart = Date.parse(point.hourStartAt);
        const ptEnd = ptStart + 3_600_000;
        return ptStart < endMs && ptEnd > startMs;
      });
      const strained = overlappingPoints.filter(p => p.tier === "strained" || p.tier === "depleted");
      if (strained.length === 0) return null;

      const lowest = [...strained].sort((a, b) => a.score - b.score)[0];
      const suggestion = findSuggestedWindow(energy, Math.max(15, Math.min(180, duration || 60)), timezone);
      return {
        lowestScore: lowest.score,
        lowestTime: localTime(lowest.hourStartAt, timezone),
        suggestion,
      };
    } catch {
      return null;
    }
  }, [duration, end, energy, load, start, timezone]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidation(null);
    const form = new FormData(event.currentTarget);
    try {
      const startAt = localDateTimeToISO(start, timezone);
      const endAt = localDateTimeToISO(end, timezone);
      if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error("结束时间需要晚于开始时间");
      const trimmedTitle = String(form.get("title") ?? "").trim();
      if (!trimmedTitle) throw new Error("请填写日程标题");
      const rawDeadline = String(form.get("deadlineAt") ?? "");

      const presentation: ApiComponents["SchedulePresentation"] = {
        ...(attribute ? { attributeTag: attribute as NonNullable<Item["presentation"]>["attributeTag"] } : {}),
        ...(item?.presentation?.goalId && item.presentation.goalTitle
          ? { goalId: item.presentation.goalId, goalTitle: item.presentation.goalTitle }
          : {}),
      };

      save.mutate({
        title: trimmedTitle,
        notes: String(form.get("notes") ?? ""),
        category,
        cognitiveLoad: load,
        flexibility: protection,
        startAt,
        endAt,
        ...(rawDeadline ? { deadlineAt: localDateTimeToISO(rawDeadline, timezone) } : {}),
        reminderMinutes: reminder,
        allowOverlap: form.get("allowOverlap") === "on",
        presentation,
      });
    } catch (error) {
      setValidation(error);
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={value => {
        if (!value && !pending) onClose();
      }}
      title={item ? "编辑日程" : "新增日程"}
      className="calendar-drawer schedule-editor-drawer"
    >
      <form onSubmit={submit} className="calendar-drawer-stack schedule-editor-form">
        <fieldset disabled={pending} className="calendar-drawer-stack">
          {onImport && !item && (
            <button type="button" className="calendar-import-shortcut" onClick={onImport}>
              <FileUp size={16} />
              导入课表或已有日程
              <span>Excel / CSV / ICS</span>
            </button>
          )}

          <section className="calendar-schedule-title">
            <label className="calendar-title-label" htmlFor="schedule-editor-title">
              <span>日程主题</span>
              <small>必填项</small>
            </label>
            <div className="calendar-field-group">
              <label className="field schedule-title-field">
                <textarea
                  id="schedule-editor-title"
                  name="title"
                  aria-label="日程标题"
                  required
                  maxLength={200}
                  value={title}
                  onChange={event => setTitle(event.target.value)}
                  placeholder="输入日程名称…"
                  rows={2}
                  autoFocus
                />
              </label>
            </div>
          </section>

          <label className="field">
            备注（可选）
            <textarea
              name="notes"
              rows={2}
              maxLength={4000}
              value={notes}
              onChange={event => setNotes(event.target.value)}
              placeholder="地点、准备事项或其他说明…"
            />
          </label>

          <section className="calendar-option-section">
            <h3>
              <Tag size={15} /> 日程属性标签
            </h3>
            <div className="calendar-category-chips calendar-reference-tags" role="group" aria-label="日程属性标签">
              {scheduleAttributes.map(tag => (
                <button
                  type="button"
                  key={tag.id}
                  data-attribute={tag.id}
                  aria-pressed={attribute === tag.id}
                  onClick={() => {
                    setAttribute(attribute === tag.id ? "" : tag.id);
                    setCategory(tag.category);
                  }}
                  style={{ "--event-accent": tag.color } as import("react").CSSProperties}
                >
                  <i style={{ background: tag.color }} />
                  {tag.label}
                </button>
              ))}
            </div>
            <div className="calendar-category-chips calendar-persisted-categories" role="group" aria-label="日程类型">
              {Object.entries(categoryLabels).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  data-category={value}
                  aria-pressed={category === value}
                  onClick={() => {
                    setCategory(value as Item["category"]);
                    if (scheduleAttributes.find(tag => tag.id === attribute)?.category !== value) {
                      setAttribute("");
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <input type="hidden" name="category" value={category} />
          </section>

          <section className="calendar-field-group calendar-editor-time">
            <h3>
              <Clock3 size={16} /> 日期、时间与时长
            </h3>
            <DateTimeField
              timezone={timezone}
              label="开始时间"
              name="startAt"
              type="datetime-local"
              required
              value={start}
              onChange={setStart}
            />
            <div className="calendar-editor-end-duration">
              <DateTimeField
                timezone={timezone}
                label="结束时间"
                name="endAt"
                type="datetime-local"
                required
                value={end}
                onChange={setEnd}
              />
              <label className="field">
                时长（分钟）
                <input
                  type="number"
                  aria-label="时长（分钟）"
                  min={5}
                  max={1440}
                  step={5}
                  value={duration || ""}
                  onChange={event => setDuration(Number(event.target.value))}
                />
              </label>
            </div>
            <p className="calendar-field-note">{timezone} · 完整起止日期支持跨天</p>
          </section>

          <section className="calendar-field-group calendar-load-assessment">
            <div className="calendar-load-heading">
              <h3>认知负荷评估</h3>
              <strong>
                {load === "high" ? "高负荷 (5/5)" : load === "medium" ? "中等 (3/5)" : "低负荷 (1/5)"}
              </strong>
            </div>
            <div className="calendar-load-gauge" aria-label={`自选认知负荷：${loadLabels[load]}`}>
              {Array.from({ length: 5 }, (_, index) => (
                <i
                  key={index}
                  data-filled={index < (load === "high" ? 5 : load === "medium" ? 3 : 1)}
                  data-index={index}
                />
              ))}
            </div>
            <div className="calendar-pills" role="group" aria-label="认知负荷">
              {Object.entries(loadLabels).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-label={label}
                  aria-pressed={load === value}
                  onClick={() => setLoad(value as Item["cognitiveLoad"])}
                >
                  {value === "high" ? "高负荷" : value === "medium" ? "中负荷" : "低负荷"}
                </button>
              ))}
            </div>
            <input type="hidden" name="cognitiveLoad" value={load} />

            {lowEnergyAdvice && (
              <div
                role="status"
                className="mt-2 rounded-xl border border-energy-strained/35 bg-energy-strained-bg p-3 text-xs text-energy-strained"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <div className="flex-1">
                    <strong>精力低谷提醒</strong>
                    <p className="mt-0.5 leading-relaxed opacity-90">
                      所选时段在 {lowEnergyAdvice.lowestTime} 左右预测精力偏低（{lowEnergyAdvice.lowestScore} 分），安排高负荷任务容易加速疲劳。
                      {lowEnergyAdvice.suggestion ? `建议改至 ${lowEnergyAdvice.suggestion.label}（${lowEnergyAdvice.suggestion.score} 分）。` : ""}
                    </p>
                    {lowEnergyAdvice.suggestion && (
                      <button
                        type="button"
                        className="mt-2 inline-flex items-center gap-1 rounded-lg bg-surface-container-lowest px-2.5 py-1 text-xs font-semibold text-primary shadow-xs hover:bg-surface-container"
                        onClick={() => {
                          setStart(lowEnergyAdvice.suggestion!.start);
                          setEnd(lowEnergyAdvice.suggestion!.end);
                        }}
                      >
                        <Sparkles size={12} /> 采用建议时段
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          <fieldset className="calendar-field-group calendar-constraints">
            <legend>
              <ShieldCheck size={16} /> 排期约束（单选）
            </legend>
            {(
              [
                { value: "flexible", label: "排期灵活性微调", note: "允许在你确认的救援方案中调整时间" },
                { value: "hard_locked", label: "硬约束防挤压锁定", note: "保持原定时段，重排时锁定不移动" },
                { value: "focus_shield", label: "深度专注保护", note: "标记为专注保护时段，团队排会尽量避开" },
              ] as const
            ).map(mode => (
              <label
                className="calendar-constraint-choice"
                key={mode.value}
                data-selected={protection === mode.value}
              >
                <input
                  type="radio"
                  name={choiceName}
                  value={mode.value}
                  checked={protection === mode.value}
                  onChange={() => setProtection(mode.value)}
                />
                <span>
                  <strong>{mode.label}</strong>
                  <small>{mode.note}</small>
                </span>
              </label>
            ))}
            <input name="flexibility" type="hidden" value={protection} />
          </fieldset>

          <section className="calendar-option-section">
            <h3>
              <AlarmClock size={15} /> 提前提醒
            </h3>
            <div className="calendar-pills" role="group" aria-label="提前提醒">
              {[10, 30, 0].map(minutes => (
                <button
                  type="button"
                  key={minutes}
                  aria-pressed={reminder === minutes}
                  onClick={() => setReminder(minutes)}
                >
                  {minutes ? `提前 ${minutes} 分钟` : "不提醒"}
                </button>
              ))}
            </div>
            {![0, 10, 30].includes(reminder) && (
              <p className="calendar-field-note">当前提醒：提前 {reminder} 分钟，保存时保留。</p>
            )}
            <input name="reminderMinutes" type="hidden" value={reminder} />
          </section>

          <DateTimeField
            timezone={timezone}
            label="截止时间（可选）"
            name="deadlineAt"
            type="datetime-local"
            value={deadline}
            onChange={setDeadline}
          />

          <label className="calendar-overlap">
            <input
              type="checkbox"
              name="allowOverlap"
              checked={allowOverlap}
              onChange={event => setAllowOverlap(event.target.checked)}
            />
            我确认允许与已有日程重叠
          </label>
        </fieldset>

        <InlineError error={validation ?? save.error ?? remove.error ?? complete.error} />
        {confirmDelete && <Notice>删除后，此日程会从你的时间地图中移除。团队会议请在团队页取消或拒绝。</Notice>}

        <div className="calendar-drawer-actions">
          <Button type="submit" pending={pending}>
            <CalendarDays size={16} />
            {item ? "保存修改" : "保存日程"}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            取消
          </Button>
          {item && (
            <div className="calendar-editor-secondary">
              <Button
                variant={confirmDelete ? "danger" : "ghost"}
                size="sm"
                disabled={pending || !!item.meetingProposalId}
                onClick={() => (confirmDelete ? remove.mutate() : setConfirmDelete(true))}
              >
                <Trash2 size={14} />
                {confirmDelete ? "确认删除" : "删除"}
              </Button>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => complete.mutate()}>
                <CheckCheck size={14} />
                {item.status === "completed" ? "重新打开" : "标记完成"}
              </Button>
            </div>
          )}
        </div>
      </form>
    </Drawer>
  );
}
