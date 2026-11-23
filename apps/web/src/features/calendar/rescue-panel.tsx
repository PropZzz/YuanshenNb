import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronDown,
  History,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Undo2,
  X,
  Zap,
} from "@/components/ui/reference-icons";
import { apiClient, type ApiComponents } from "@/api/client";
import { isProblemCode } from "@/api/errors";
import { unwrap } from "@/api/unwrap";
import { Button } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/date-time-field";
import { Drawer } from "@/components/ui/drawer";
import { ErrorState, InlineError, LoadingState, Notice } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { localDate, localDateTimeToISO, localTime } from "@/lib/datetime";
import { useAuthStore } from "@/stores/auth-store";
import { strategyLabels, useInvalidateSchedule, useRescueHistory } from "./queries";

const descriptions: Record<ApiComponents["RescueStrategy"], string> = {
  protect_deadline: "优先保护截止时间，重排可移动日程。",
  protect_recovery: "保留恢复缓冲，降低连续高负荷。",
  minimize_changes: "尽量保留原有节奏，减少任务位移。",
};

function secureOperationId() {
  const source = globalThis.crypto;
  if (typeof source?.randomUUID === "function") return source.randomUUID();
  if (typeof source?.getRandomValues !== "function") {
    throw new Error("浏览器不支持安全请求标识，请使用支持加密随机数的浏览器");
  }
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface RescueStagingController {
  activeOption?: ApiComponents["RescueOptionPlan"];
  stagingBar: React.ReactNode;
}

export function RescuePanel({
  day,
  forceOpen,
  onClose,
  initialTrigger = "urgent_task",
  showSidebar = true,
  onStageChange,
}: {
  day: string;
  forceOpen: boolean;
  onClose: () => void;
  initialTrigger?: ApiComponents["RescueTriggerReason"];
  showSidebar?: boolean;
  onStageChange?: (plan: ApiComponents["RescueOptionPlan"] | undefined) => void;
}) {
  const timezone = useAuthStore(s => s.user?.timezone ?? "Asia/Shanghai");
  const history = useRescueHistory();
  const invalidate = useInvalidateSchedule();
  const toast = useToast();

  const [open, setOpen] = useState(forceOpen);
  const [request, setRequest] = useState<ApiComponents["RescueOptionsRequest"]>();
  const [selected, setSelected] = useState<ApiComponents["RescueStrategy"]>("protect_deadline");
  const [validation, setValidation] = useState<unknown>(null);
  const [undoId, setUndoId] = useState<string>();
  const [notice, setNotice] = useState("");
  const [triggerReason, setTriggerReason] = useState<ApiComponents["RescueTriggerReason"]>(initialTrigger);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [duration, setDuration] = useState(75);
  const [load, setLoad] = useState<ApiComponents["CognitiveLoad"]>("high");
  const [deadline, setDeadline] = useState(`${day}T18:00`);
  const [now, setNow] = useState(Date.now());
  const [showDiffList, setShowDiffList] = useState(false);

  const operation = useRef<{ fingerprint: string; key: string } | null>(null);
  const requestSeq = useRef(0);

  const options = useMutation({
    mutationFn: async ({ body }: { body: ApiComponents["RescueOptionsRequest"]; seq: number }) =>
      unwrap(await apiClient.POST("/api/v1/schedule/rescue/options", { body })),
    onSuccess: (data, variables) => {
      if (variables.seq !== requestSeq.current) {
        options.reset();
        return;
      }
      const firstFeasible = data.options.find(opt => opt.feasible)?.strategy ?? data.options[0]?.strategy;
      if (firstFeasible) setSelected(firstFeasible);
      if (onStageChange) {
        setOpen(false);
      }
    },
  });

  const undoById = useMutation({
    mutationFn: async (snapshotId: string) =>
      unwrap(await apiClient.POST("/api/v1/schedule/rescue/undo", { body: { snapshotId } })),
    onSuccess: async () => {
      await invalidate();
      setUndoId(undefined);
      setNotice("已原子撤销本次调整，恢复原有日程。");
      toast.push({ tone: "info", title: "已原子撤销本次救援调整", description: "原有日程已恢复。" });
    },
  });

  const apply = useMutation({
    mutationFn: async () => {
      const option = options.data?.options.find(item => item.strategy === selected);
      if (!option?.feasible || !request || !options.data) {
        throw new Error("请先生成可执行的救援方案");
      }
      const body: ApiComponents["RescueApplyRequest"] = {
        ...request,
        strategy: selected,
        baselineVersion: options.data.baselineVersion,
        expectedOptionHash: option.optionHash,
      };
      const fingerprint = JSON.stringify(body);
      if (operation.current?.fingerprint !== fingerprint) {
        operation.current = { fingerprint, key: secureOperationId() };
      }
      return unwrap(
        await apiClient.POST("/api/v1/schedule/rescue/apply", {
          params: { header: { "Idempotency-Key": operation.current.key } },
          body,
        }),
      );
    },
    onSuccess: async result => {
      await invalidate();
      operation.current = null;
      setNotice("已应用救援方案；可随时一键撤销。");
      setOpen(false);
      options.reset();
      setRequest(undefined);
      onStageChange?.(undefined);
      onClose();
      toast.push({
        tone: "success",
        title: `已应用「${strategyLabels[result.strategy]}」`,
        description: `共更新 ${result.appliedItems.length} 项日程，已生成可撤销快照。`,
        action: {
          label: "撤销本次调整",
          onClick: async () => {
            await undoById.mutateAsync(result.snapshotId);
          },
        },
      });
    },
  });

  const current = options.data?.options.find(option => option.strategy === selected);
  const staleConflict = isProblemCode(apply.error, "STALE_BASELINE_VERSION");

  useEffect(() => {
    onStageChange?.(options.data ? current : undefined);
  }, [current, onStageChange, options.data]);

  function resetPreview() {
    requestSeq.current++;
    options.reset();
    apply.reset();
    setRequest(undefined);
    setValidation(null);
    operation.current = null;
  }

  useEffect(() => {
    setOpen(forceOpen);
    if (forceOpen) {
      setTriggerReason(initialTrigger);
      resetPreview();
    }
  }, [forceOpen, initialTrigger]);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [open]);

  function closeDrawer() {
    if (!apply.isPending) {
      setOpen(false);
      if (!options.data) {
        onClose();
      }
    }
  }

  function exitStaging() {
    if (apply.isPending) return;
    resetPreview();
    setOpen(false);
    onStageChange?.(undefined);
    onClose();
  }

  let remaining: number | undefined;
  try {
    remaining = Math.ceil((Date.parse(localDateTimeToISO(deadline, timezone)) - now) / 60_000);
  } catch {
    // Validated at submit
  }

  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidation(null);
    apply.reset();
    operation.current = null;
    try {
      let urgentTask: ApiComponents["UrgentTaskDTO"] | undefined;
      if (triggerReason === "urgent_task") {
        const deadlineAt = localDateTimeToISO(deadline, timezone);
        const trimmedTitle = title.trim();
        if (!trimmedTitle) throw new Error("请填写紧急任务名称");
        if (Date.parse(deadlineAt) <= Date.now()) throw new Error("截止时间必须晚于现在");
        if (!Number.isInteger(duration) || duration < 5 || duration > 1440) {
          throw new Error("任务时长必须是 5 至 1440 分钟的整数");
        }
        urgentTask = {
          title: trimmedTitle,
          durationMinutes: duration,
          cognitiveLoad: load,
          deadlineAt,
          notes,
        };
      }
      const body: ApiComponents["RescueOptionsRequest"] = {
        day,
        triggerReason,
        ...(urgentTask ? { urgentTask } : {}),
      };
      const seq = ++requestSeq.current;
      setRequest(body);
      options.mutate({ body, seq });
    } catch (error) {
      setValidation(error);
    }
  }

  function recomputeStale() {
    if (!request) return;
    apply.reset();
    operation.current = null;
    const seq = ++requestSeq.current;
    options.mutate({ body: request, seq });
  }

  const deferredItems = current?.diffItems.filter(diff => diff.op === "defer") ?? [];

  return (
    <>
      {/* Visual Ghost-Timeline Staging Comparison Bar (renders above calendar grid when options exist and input drawer is collapsed) */}
      {!open && options.data && (
        <section className="rescue-staging-bar surface-card" aria-label="救援方案推演对比">
          <div className="rescue-staging-head">
            <div>
              <span className="eyebrow">GHOST TIMELINE STAGING · 三方案实时比对</span>
              <h2>
                {request?.urgentTask?.title ??
                  (triggerReason === "wearable_fatigue" ? "疲劳恢复与精力保护" : "团队会议后的负荷调整")}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" disabled={apply.isPending} onClick={() => setOpen(true)}>
                修改条件
              </Button>
              <Button variant="ghost" size="sm" disabled={apply.isPending} onClick={exitStaging}>
                <X size={14} /> 保留原日程
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!current?.feasible}
                pending={apply.isPending}
                onClick={() => apply.mutate()}
              >
                <Zap size={14} /> 确认应用当前方案
              </Button>
            </div>
          </div>

          <div className="rescue-option-grid" role="radiogroup" aria-label="选择救援策略">
            {options.data.options.map((option, index) => (
              <button
                key={option.strategy}
                type="button"
                className={`rescue-option ${selected === option.strategy ? "selected" : ""}`}
                aria-pressed={selected === option.strategy}
                disabled={apply.isPending}
                onClick={() => {
                  setSelected(option.strategy);
                  apply.reset();
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="eyebrow">
                    方案 {String.fromCharCode(65 + index)} · {option.feasible ? "可执行" : "当前无解"}
                  </span>
                  <span className="text-[11px] font-semibold">延后 {option.deferredCount} 项</span>
                </div>
                <h3>{strategyLabels[option.strategy]}</h3>
                <div className="rescue-option-metrics">
                  <span>
                    <strong>{option.movedCount}</strong>任务位移
                  </span>
                  <span>
                    <strong>
                      {option.recoveryMinutes}
                      <small>m</small>
                    </strong>
                    恢复缓冲
                  </span>
                  <span>
                    <strong>{option.overdueRiskCount}</strong>逾期风险
                  </span>
                </div>
                <p>{option.summary}</p>
              </button>
            ))}
          </div>

          {deferredItems.length > 0 && (
            <div className="rescue-deferred-tray">
              <strong>顺延至后续工作日 ({deferredItems.length})</strong>
              <div className="flex flex-wrap gap-2">
                {deferredItems.map((diff, index) => (
                  <span key={`${diff.itemId ?? diff.title}-${index}`} className="badge badge-warning">
                    {diff.title} → {localDate(diff.afterStartAt, timezone).slice(5)}{" "}
                    {localTime(diff.afterStartAt, timezone)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {staleConflict && (
            <div role="alert" className="inline-error items-center justify-between">
              <span>日程刚刚发生变化（版本已更新），需要按最新日程重新计算三方案对比。</span>
              <Button size="sm" variant="secondary" pending={options.isPending} onClick={recomputeStale}>
                <RefreshCw size={13} /> 重新计算最新方案
              </Button>
            </div>
          )}
          {!staleConflict && <InlineError error={apply.error} />}

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-on-surface-variant">
              时间地图已投影虚线「原时段」幽灵块与实线「调整后」落位块；切换上方策略可即时比对。
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-semibold text-secondary"
              onClick={() => setShowDiffList(v => !v)}
            >
              {showDiffList ? "收起明细列表" : `展开调整明细 (${current?.diffItems.length ?? 0})`}
              <ChevronDown size={14} className={showDiffList ? "rotate-180 transition-transform" : "transition-transform"} />
            </button>
          </div>

          {showDiffList && current && (
            <div className="rescue-diff">
              {current.diffItems.length === 0 ? (
                <p className="notice">此方案没有需要调整的日程。</p>
              ) : (
                current.diffItems.map((diff, index) => (
                  <div key={`${diff.itemId ?? diff.title}-${index}`}>
                    <strong>{diff.title}</strong>
                    <span>
                      {diff.beforeStartAt ? localTime(diff.beforeStartAt, timezone) : "新增"}
                      <ArrowRight size={12} />
                      {localTime(diff.afterStartAt, timezone)}–{localTime(diff.afterEndAt, timezone)}
                    </span>
                    <small>{diff.reasonLabel}</small>
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      )}

      {/* Collapsible Context Rail */}
      {showSidebar && (
        <aside className="rescue-sidebar">
          <section className="surface-card rescue-summary">
            <div className="flex items-start gap-2.5">
              <span className="rescue-icon">
                <ShieldCheck size={20} />
              </span>
              <div>
                <h2>日程健康与救援摘要</h2>
                <p>守住截止期，也守住你的恢复时间</p>
              </div>
            </div>
            <div className="rescue-explanation">
              <ShieldCheck size={15} />
              <strong>所有重排，先比较再确认</strong>
              <p>固定会议与保护日程不会被静默移动。方案由服务端计算，确认后生成可撤销快照。</p>
            </div>
            <div className="rescue-strategies">
              {Object.entries(strategyLabels).map(([key, label], index) => (
                <div key={key} className={index === 0 ? "strategy-preview featured" : "strategy-preview"}>
                  <strong>
                    <span>{String.fromCharCode(65 + index)}</span>
                    {label}
                  </strong>
                  <p>{descriptions[key as ApiComponents["RescueStrategy"]]}</p>
                </div>
              ))}
            </div>
            <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
              <Sparkles size={15} /> 计算并比较救援方案
            </Button>
            <p className="rescue-footnote">
              <LockKeyhole size={12} /> 预览不会修改任何日程
            </p>
          </section>

          <section className="surface-card p-5">
            <h3 className="card-title flex items-center gap-2">
              <History size={16} /> 最近的救援快照
            </h3>
            {notice && (
              <div className="mt-3">
                <Notice>{notice}</Notice>
              </div>
            )}
            {history.isPending ? (
              <LoadingState label="读取调整历史" />
            ) : history.isError ? (
              <ErrorState error={history.error} retry={() => void history.refetch()} />
            ) : history.data.snapshots.length === 0 ? (
              <p className="py-5 text-xs text-outline leading-6">
                还没有应用过救援方案。确认方案后，会在这里保留可追溯的调整记录。
              </p>
            ) : (
              <div className="rescue-history">
                {history.data.snapshots.slice(0, 5).map(snapshot => (
                  <div key={snapshot.id}>
                    <span className="badge">{snapshot.localDay}</span>
                    <strong>{strategyLabels[snapshot.strategy]}</strong>
                    <small>{snapshot.status === "reverted" ? "已撤销" : "已应用，保留前后快照"}</small>
                    {snapshot.status === "applied" && (
                      <Button variant="ghost" size="sm" onClick={() => setUndoId(snapshot.id)}>
                        <Undo2 size={12} /> 撤销本次调整
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      )}

      {/* Rescue Input & Optional Drawer Preview */}
      <Drawer
        open={open}
        onOpenChange={value => {
          if (!value) closeDrawer();
        }}
        title="日程救援决策台"
        description={
          options.data
            ? "可在时间地图顶部横栏切换 A/B/C 三套方案并直接预览幽灵对比。"
            : "填写紧急任务目标与硬截止，提交后再分析冲突。"
        }
        width={options.data ? 960 : 480}
        className={`calendar-drawer calendar-rescue-drawer ${options.data ? "has-options" : ""}`}
      >
        <form onSubmit={preview} className="calendar-drawer-stack">
          <fieldset disabled={apply.isPending} className="calendar-drawer-stack">
            <label className="field">
              救援原因
              <select
                value={triggerReason}
                onChange={event => {
                  setTriggerReason(event.target.value as ApiComponents["RescueTriggerReason"]);
                  resetPreview();
                }}
              >
                <option value="urgent_task">插入紧急任务</option>
                <option value="wearable_fatigue">疲劳恢复与精力保护</option>
                <option value="team_meeting_overload">团队会议后的负荷调整</option>
              </select>
            </label>

            {triggerReason === "urgent_task" ? (
              <>
                <span className="calendar-urgent-badge">
                  <i />
                  P0 / P1 紧急插入
                </span>
                <div className="rescue-request-grid">
                  <section className="calendar-field-group">
                    <h3>任务目标与上下文</h3>
                    <label className="field">
                      紧急任务
                      <textarea
                        name="title"
                        required
                        maxLength={200}
                        value={title}
                        onChange={event => {
                          setTitle(event.target.value);
                          resetPreview();
                        }}
                        placeholder="输入紧急任务名称…"
                        rows={2}
                      />
                    </label>
                    <label className="field">
                      补充说明（可选）
                      <textarea
                        name="notes"
                        rows={2}
                        value={notes}
                        onChange={event => {
                          setNotes(event.target.value);
                          resetPreview();
                        }}
                        placeholder="需要保留的背景、准备事项或交付要求"
                      />
                    </label>
                  </section>

                  <section className="calendar-field-group">
                    <h3>预计执行耗时</h3>
                    <label className="field">
                      需要时长
                      <select
                        name="duration"
                        value={duration}
                        onChange={event => {
                          setDuration(Number(event.target.value));
                          resetPreview();
                        }}
                      >
                        {[15, 30, 45, 60, 75, 90, 120, 180, 240].map(minutes => (
                          <option key={minutes} value={minutes}>
                            {minutes} 分钟
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="calendar-pills">
                      {[30, 45, 75, 90].map(minutes => (
                        <button
                          type="button"
                          key={minutes}
                          aria-pressed={duration === minutes}
                          onClick={() => {
                            setDuration(minutes);
                            resetPreview();
                          }}
                        >
                          {minutes}m
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="calendar-field-group">
                    <h3>认知负荷等级</h3>
                    <div className="calendar-pills" role="group" aria-label="紧急任务认知负荷">
                      {(
                        [
                          ["low", "轻量任务"],
                          ["medium", "中等负荷"],
                          ["high", "高负荷"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          type="button"
                          key={value}
                          aria-pressed={load === value}
                          onClick={() => {
                            setLoad(value);
                            resetPreview();
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <input name="load" type="hidden" value={load} />
                  </section>

                  <section className="calendar-field-group">
                    <h3>
                      绝对硬截止时间{" "}
                      <span className="calendar-urgent-countdown">
                        {remaining === undefined
                          ? "待选择"
                          : remaining <= 0
                            ? "时间已过"
                            : `仅剩 ${Math.floor(remaining / 60)}h ${remaining % 60}m`}
                      </span>
                    </h3>
                    <DateTimeField
                      timezone={timezone}
                      name="deadline"
                      label="最晚完成时间"
                      type="datetime-local"
                      required
                      value={deadline}
                      onChange={value => {
                        setDeadline(value);
                        resetPreview();
                      }}
                    />
                  </section>
                </div>
              </>
            ) : (
              <Notice>
                {triggerReason === "wearable_fatigue"
                  ? "按已同步的精力与日程计算恢复方案，无需新增任务。"
                  : "根据会议后的日程负荷比较调整方案，固定会议会保持原位。"}
                方案仍需明确确认才会应用。
              </Notice>
            )}
          </fieldset>

          <InlineError error={validation ?? options.error} />
          <div className="calendar-drawer-actions">
            <Button type="submit" aria-label="生成三套方案" pending={options.isPending} disabled={apply.isPending}>
              <Zap size={15} /> 立即生成三方案救援对比
            </Button>
          </div>
        </form>

        {options.data && (
          <section className="calendar-rescue-comparison">
            <header>
              <span className="eyebrow">RESCUE PLAN</span>
              <h2>3 种智能救援策略权衡矩阵</h2>
              <p>
                {request?.urgentTask?.title ??
                  (triggerReason === "wearable_fatigue" ? "疲劳恢复与精力保护" : "会议后的负荷调整")}
              </p>
            </header>
            <div className="rescue-option-grid">
              {options.data.options.map((option, index) => (
                <button
                  type="button"
                  key={option.strategy}
                  className={`rescue-option ${selected === option.strategy ? "selected" : ""}`}
                  aria-pressed={selected === option.strategy}
                  disabled={apply.isPending}
                  onClick={() => {
                    setSelected(option.strategy);
                    apply.reset();
                  }}
                >
                  <span className="eyebrow">
                    方案 {String.fromCharCode(65 + index)} · {option.feasible ? "可执行" : "当前无解"}
                  </span>
                  <h3>{strategyLabels[option.strategy]}</h3>
                  <div className="rescue-option-metrics">
                    <span>
                      <strong>{option.movedCount}</strong>任务位移
                    </span>
                    <span>
                      <strong>
                        {option.recoveryMinutes}
                        <small>m</small>
                      </strong>
                      恢复缓冲
                    </span>
                    <span>
                      <strong>{option.overdueRiskCount}</strong>逾期风险
                    </span>
                  </div>
                  <p>{option.summary}</p>
                </button>
              ))}
            </div>
            {current && (
              <div className="rescue-diff">
                <h3>执行前后差异 · {strategyLabels[current.strategy]}</h3>
                {current.diffItems.length === 0 ? (
                  <p className="notice">此方案没有需要调整的日程。</p>
                ) : (
                  current.diffItems.map((diff, index) => (
                    <div key={`${diff.itemId ?? diff.title}-${index}`}>
                      <strong>{diff.title}</strong>
                      <span>
                        {diff.beforeStartAt ? localTime(diff.beforeStartAt, timezone) : "新增"}
                        <ArrowRight size={12} />
                        {localTime(diff.afterStartAt, timezone)}–{localTime(diff.afterEndAt, timezone)}
                      </span>
                      <small>{diff.reasonLabel}</small>
                    </div>
                  ))
                )}
              </div>
            )}
            <InlineError error={apply.error} />
            <div className="form-actions">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={apply.isPending}>
                在时间地图中预览幽灵对比
              </Button>
              <Button
                variant="secondary"
                disabled={!current?.feasible}
                pending={apply.isPending}
                onClick={() => apply.mutate()}
              >
                确认应用当前方案
              </Button>
            </div>
          </section>
        )}
      </Drawer>

      <Drawer
        open={!!undoId}
        onOpenChange={value => {
          if (!value && !undoById.isPending) setUndoId(undefined);
        }}
        title="撤销这次日程调整？"
        description="服务端将检查快照后的日程是否被修改。存在后续改动时会阻止撤销，避免覆盖你的安排。"
        className="calendar-drawer"
      >
        <InlineError error={undoById.error} />
        <div className="calendar-drawer-actions">
          <Button
            variant="secondary"
            pending={undoById.isPending}
            onClick={() => undoId && undoById.mutate(undoId)}
          >
            <Undo2 size={15} /> 确认撤销本次调整
          </Button>
          <Button variant="ghost" onClick={() => setUndoId(undefined)} disabled={undoById.isPending}>
            保留调整
          </Button>
        </div>
      </Drawer>
    </>
  );
}
