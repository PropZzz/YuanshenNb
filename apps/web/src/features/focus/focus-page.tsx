import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BatteryCharging,
  CalendarCheck,
  CheckCheck,
  CircleCheck,
  Clock3,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Timer,
  Zap,
} from "@/components/ui/reference-icons";
import { apiClient, type ApiComponents } from "@/api/client";
import { unwrap } from "@/api/unwrap";
import { useAuthStore } from "@/stores/auth-store";
import { dayRange, displayDay, localDate, localTime } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { ErrorState, InlineError, LoadingState, Notice } from "@/components/ui/states";
import { useEnergy, freshnessLabels, tierLabels } from "@/features/energy/queries";
import {
  categoryLabels,
  loadLabels,
  useInvalidateSchedule,
  useSchedules,
} from "@/features/calendar/queries";
import { formatTimer, remainingSeconds } from "./focus-clock";
import { useFocusSession } from "./focus-session";
import {
  FocusSoundscape,
  FocusSteps,
  QuickFeelingFeedback,
} from "./focus-local-tools";
import "./focus.css";

function resolveCurrentEnergyTier(
  energy: ApiComponents["EnergyTodayResponse"] | undefined,
): ApiComponents["EnergyTier"] | undefined {
  if (!energy) return undefined;
  const now = Date.now();
  const point = energy.hourlyCurve.find(p => {
    const start = Date.parse(p.hourStartAt);
    return start <= now && now < start + 3_600_000;
  });
  return point?.tier ?? energy.tier;
}

function getTaskEnergyFit(
  load: ApiComponents["CognitiveLoad"],
  tier: ApiComponents["EnergyTier"] | undefined,
): {
  tone: "match" | "warning" | "gentle" | "neutral";
  label: string;
  showRescue: boolean;
} {
  if (!tier) {
    return { tone: "neutral", label: `${loadLabels[load]} · 精力读取中`, showRescue: false };
  }
  if (load === "high" && (tier === "peak" || tier === "steady")) {
    return {
      tone: "match",
      label: `高负荷 · 匹配当前${tierLabels[tier]}`,
      showRescue: false,
    };
  }
  if (load === "high" && (tier === "strained" || tier === "depleted")) {
    return {
      tone: "warning",
      label: "当前精力偏低，建议先拆小或保护日程",
      showRescue: true,
    };
  }
  if ((load === "low" || load === "medium") && (tier === "strained" || tier === "depleted")) {
    return {
      tone: "gentle",
      label: `轻中负荷 · 契合当下${tierLabels[tier]}恢复节律`,
      showRescue: false,
    };
  }
  return {
    tone: "neutral",
    label: `${loadLabels[load]} · 当前${tierLabels[tier]}`,
    showRescue: false,
  };
}

export function FocusPage() {
  const timezone = useAuthStore(s => s.user?.timezone ?? "Asia/Shanghai");
  const ownerId = useAuthStore(s => s.user?.id ?? "");
  const day = localDate(new Date(), timezone);
  const range = dayRange(day, timezone);

  const schedule = useSchedules(range.from, range.to);
  const energy = useEnergy(day);
  const invalidate = useInvalidateSchedule();
  const session = useFocusSession();

  const { mode, setMode } = session;
  const selectedId = session.ownerId === ownerId ? session.itemId : undefined;
  const startedAt = session.ownerId === ownerId ? session.startedAt : null;
  const savedSeconds = session.ownerId === ownerId ? session.savedSeconds : 0;

  const [now, setNow] = useState(Date.now());
  const [immersive, setImmersive] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<unknown>(null);
  const focusRoot = useRef<HTMLDivElement>(null);

  function exitImmersion() {
    setImmersive(false);
    setFullscreenError(null);
    if (document.fullscreenElement === focusRoot.current) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }

  async function enterFullscreen() {
    try {
      await focusRoot.current?.requestFullscreen();
    } catch {
      setFullscreenError(new Error("浏览器未允许全屏，可继续使用当前沉浸视图。"));
    }
  }

  useEffect(() => {
    if (!immersive) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") exitImmersion();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [immersive]);

  useEffect(() => {
    const root = focusRoot.current;
    return () => {
      if (document.fullscreenElement === root && document.exitFullscreen) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, []);

  const items = (schedule.data?.items ?? [])
    .filter(i => i.status !== "cancelled")
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const completedCount = items.filter(i => i.status === "completed").length;
  const pending = items.filter(i => i.status !== "completed");
  const current =
    pending.find(i => i.id === selectedId) ??
    pending.find(i => i.status === "in_progress") ??
    pending[0];

  const running = startedAt !== null;
  const elapsed =
    savedSeconds + (startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000)));
  const total = (current?.durationMinutes ?? 25) * 60;
  const displayed =
    mode === "flow"
      ? elapsed
      : startedAt === null
        ? Math.max(0, total - savedSeconds)
        : remainingSeconds(startedAt + (total - savedSeconds) * 1000, now);
  const progress = Math.min(1, elapsed / total);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [running]);

  const update = useMutation({
    mutationFn: async (status: "in_progress" | "completed") => {
      if (!current) throw new Error("请先选择一项日程");
      return unwrap(
        await apiClient.PATCH("/api/v1/schedule/items/{id}", {
          params: { path: { id: current.id } },
          body: { status },
        }),
      );
    },
    onSuccess: (_, status) => {
      if (status === "in_progress") {
        setNow(Date.now());
        session.start(ownerId, current!.id);
      } else {
        session.clear();
      }
      void invalidate();
    },
  });

  function pause() {
    session.pause();
  }

  function choose(id: string) {
    session.choose(ownerId, id);
  }

  const currentTier = resolveCurrentEnergyTier(energy.data);
  const fit = current ? getTaskEnergyFit(current.cognitiveLoad, currentTier) : null;
  const isStrained =
    !!energy.data?.overloadAlert ||
    energy.data?.tier === "strained" ||
    energy.data?.tier === "depleted";

  return (
    <div ref={focusRoot} className={`focus-page ${immersive ? "is-immersive" : ""}`}>
      {/* Compact Daily Briefing Bar */}
      <header className="focus-briefing-bar surface-card" aria-label="今日节律简报">
        <div className="focus-briefing-left">
          <span className="focus-briefing-day">
            {displayDay(day, { month: "long", day: "numeric", weekday: "long" })}
          </span>
          <span className="badge">
            已完成 {completedCount} / {items.length} 项
          </span>
        </div>

        <div className="focus-briefing-right">
          <Link to="/energy" className={`focus-briefing-energy tier-${energy.data?.tier ?? "steady"}`}>
            <BatteryCharging size={15} />
            <strong>{energy.data?.score ?? "—"} 分</strong>
            <span>
              {energy.data
                ? `${tierLabels[energy.data.tier]} · ${freshnessLabels[energy.data.dataFreshness]}`
                : energy.isError
                  ? "精力暂不可用"
                  : "读取精力中"}
            </span>
          </Link>

          <Link
            to={isStrained ? "/calendar?rescue=1&trigger=wearable_fatigue" : "/calendar"}
            className="button button-outline button-sm"
          >
            <ShieldCheck size={14} />
            {isStrained ? "疲劳保护预演" : "时间地图"}
          </Link>
        </div>
      </header>

      {/* Asymmetric 2-Column Command Deck (8-col Focus Stage + 4-col Today Shield Rail) */}
      <div className="focus-columns">
        <div className="focus-main-column">
          <section className="surface-card focus-control">
            {immersive && (
              <div className="focus-immersion-toolbar">
                <p>仅简化本页显示，不会屏蔽系统通知或控制其他应用。</p>
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={typeof document.documentElement.requestFullscreen !== "function"}
                    onClick={() => void enterFullscreen()}
                  >
                    <Maximize2 size={14} />
                    浏览器全屏
                  </Button>
                  <Button variant="outline" size="sm" onClick={exitImmersion}>
                    <Minimize2 size={14} />
                    退出沉浸
                  </Button>
                </div>
                <InlineError error={fullscreenError} />
              </div>
            )}

            {schedule.isPending ? (
              <LoadingState label="正在读取今日专注任务" />
            ) : schedule.isError ? (
              <ErrorState error={schedule.error} retry={() => void schedule.refetch()} />
            ) : current ? (
              <>
                <div className="focus-stage-meta">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="badge badge-info">{loadLabels[current.cognitiveLoad]}</span>
                    <span className="badge">{categoryLabels[current.category]}</span>
                    {fit && (
                      <span className={`focus-fit-badge fit-${fit.tone}`}>
                        {fit.tone === "warning" ? <AlertTriangle size={12} /> : <Sparkles size={12} />}
                        {fit.label}
                        {fit.showRescue && (
                          <Link to="/calendar?rescue=1&trigger=wearable_fatigue">
                            保护日程
                          </Link>
                        )}
                      </span>
                    )}
                  </div>
                  <span className="badge">
                    <Clock3 size={12} />
                    {localTime(current.startAt, timezone)} — {localTime(current.endAt, timezone)}
                  </span>
                </div>

                <h1 className="focus-task-title">{current.title}</h1>

                <div className="focus-timer-panel">
                  <div className="segmented" aria-label="计时方式">
                    <button
                      type="button"
                      aria-pressed={mode === "flow"}
                      disabled={running}
                      onClick={() => setMode("flow")}
                    >
                      正向心流
                    </button>
                    <button
                      type="button"
                      aria-pressed={mode === "countdown"}
                      disabled={running}
                      onClick={() => setMode("countdown")}
                    >
                      任务倒计时
                    </button>
                    <button
                      type="button"
                      aria-pressed={immersive}
                      onClick={() => (immersive ? exitImmersion() : setImmersive(true))}
                    >
                      沉浸 · 勿扰
                    </button>
                  </div>

                  <div className="focus-timer">
                    <svg viewBox="0 0 240 240" aria-hidden="true">
                      <circle cx="120" cy="120" r="105" />
                      <circle
                        cx="120"
                        cy="120"
                        r="105"
                        className="timer-progress"
                        strokeDasharray={660}
                        strokeDashoffset={660 * (1 - progress)}
                      />
                    </svg>
                    <div>
                      <strong role="timer" aria-label="本次专注计时">
                        {formatTimer(displayed)}
                      </strong>
                      <span>
                        {running
                          ? "保持专注，按自己的节奏前进"
                          : elapsed
                            ? "已暂停 · 随时继续"
                            : "准备好，进入专注"}
                      </span>
                    </div>
                  </div>

                  <div className="focus-timer-actions">
                    <Button
                      disabled={update.isPending}
                      onClick={() => (running ? pause() : update.mutate("in_progress"))}
                      pending={update.isPending && update.variables === "in_progress"}
                    >
                      {running ? <Pause size={17} /> : <Play size={17} />}
                      <span>{running ? "暂停专注" : elapsed ? "继续专注" : "开始专注"}</span>
                    </Button>
                    <Button
                      variant="outline"
                      disabled={update.isPending}
                      onClick={() => update.mutate("completed")}
                      aria-label="完成当前任务"
                    >
                      <CheckCheck size={17} />
                      <span>完成</span>
                    </Button>
                  </div>

                  <InlineError error={update.error} />
                  {mode === "countdown" && displayed === 0 && (
                    <Notice>计划专注时间已到。你可以继续工作，或主动标记任务完成。</Notice>
                  )}

                  {immersive && <FocusSoundscape ownerId={ownerId} compact />}
                </div>

                <div className="focus-task-detail">
                  <CircleCheck size={18} />
                  <div>
                    <strong>{current.notes || "为这一件事，留一段不被打扰的时间。"}</strong>
                    <p>本次计时仅记录当前会话，不作为今日实际专注总时长。</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="focus-empty-control">
                <CircleCheck size={32} />
                <h1>今天没有更多日程</h1>
                <p>当前未检测到待开始的日程。可刷新确认，或前往时间地图安排下一段专注。</p>
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="检查今日日程"
                    onClick={() => void schedule.refetch()}
                  >
                    <RefreshCw size={14} />
                    检查
                  </Button>
                  <Link to="/calendar?new=1" className="button button-default button-sm">
                    <CalendarCheck size={14} />
                    去安排第一段专注
                  </Link>
                </div>
              </div>
            )}
          </section>

          <details className="surface-card focus-steps-accordion" open>
            <summary>本机步骤与闪念</summary>
            <div className="focus-steps-body">
              <FocusSteps ownerId={ownerId} taskId={current?.id} timezone={timezone} />
            </div>
          </details>

          {!immersive && <FocusSoundscape ownerId={ownerId} />}
        </div>

        {/* Right 4-Column Today Shield Rail */}
        <aside className="focus-side-column">
          <section className="surface-card focus-task-list">
            <header className="card-header">
              <h2 className="card-title">
                今日时间轴与待办
                <span className="badge ml-2">
                  {completedCount} / {items.length}
                </span>
              </h2>
              <Link to="/calendar" className="text-xs text-secondary">
                完整日历 <ArrowRight size={13} className="inline" />
              </Link>
            </header>

            {energy.data && energy.data.focusShields.length > 0 && (
              <div className="focus-rail-shields">
                {energy.data.focusShields.map((shield, idx) => (
                  <div key={`rail-shield-${idx}`} className="focus-rail-shield-pill">
                    <ShieldCheck size={13} />
                    <span>
                      推荐专注保护 {localTime(shield.startAt, timezone)}–
                      {localTime(shield.endAt, timezone)}
                    </span>
                    <b>均分 {shield.avgScore}</b>
                  </div>
                ))}
              </div>
            )}

            <div className="focus-task-rows">
              {items.map(i => (
                <button
                  key={i.id}
                  type="button"
                  disabled={running || i.status === "completed"}
                  onClick={() => choose(i.id)}
                  className={`focus-task-row ${current?.id === i.id ? "selected" : ""} ${
                    i.status === "completed" ? "completed" : ""
                  }`}
                >
                  <span className="task-check">
                    {i.status === "completed" ? <CircleCheck size={17} /> : <span />}
                  </span>
                  <span>
                    <strong>{i.title}</strong>
                    <small>
                      {localTime(i.startAt, timezone)} · {i.durationMinutes} 分钟 ·{" "}
                      {categoryLabels[i.category]}
                    </small>
                  </span>
                  <span className="badge">
                    {i.status === "completed"
                      ? "已完成"
                      : current?.id === i.id
                        ? "当前任务"
                        : "选择专注"}
                  </span>
                </button>
              ))}
              {items.length === 0 && (
                <p className="p-4 text-xs text-on-surface-variant">
                  日程会显示在这里。已完成记录不会被替换为示例数据。
                </p>
              )}
            </div>
          </section>

          <section className={`surface-card focus-protection ${isStrained ? "is-strained" : ""}`}>
            <ShieldCheck size={20} />
            <div>
              <h2>{isStrained ? "精力负荷与疲劳保护" : "给专注一点保护"}</h2>
              <p>
                {energy.data?.overloadAlert?.message ??
                  "临时有事或感到疲惫？先比较救援重排方案，确认后再安全调整日程。"}
              </p>
              <Link to={isStrained ? "/calendar?rescue=1&trigger=wearable_fatigue" : "/calendar?rescue=1"}>
                查看救援方案 <ArrowRight size={13} />
              </Link>
            </div>
          </section>

          <section className="surface-card focus-energy">
            <header className="flex items-center justify-between gap-2">
              <h2 className="card-title">认知状态与体感反馈</h2>
              <span className="badge badge-success">
                {energy.data ? tierLabels[energy.data.tier] : "等待计算"}
              </span>
            </header>
            {energy.isError ? (
              <ErrorState error={energy.error} retry={() => void energy.refetch()} />
            ) : energy.isPending ? (
              <LoadingState label="正在读取精力状态" />
            ) : (
              <>
                <div className="focus-energy-score">
                  <span>今日精力储备</span>
                  <strong>
                    {energy.data.score}
                    <small> / 100</small>
                  </strong>
                </div>
                <progress max={100} value={energy.data.score} aria-label="今日精力储备" />
                <div className="focus-energy-advice">
                  <BatteryCharging size={15} />
                  <strong>{freshnessLabels[energy.data.dataFreshness]}</strong>
                  <p>{energy.data.drivers.summary}</p>
                </div>
                <Link to="/energy" className="text-xs text-secondary inline-flex items-center gap-1">
                  查看来源与节律曲线 <ArrowRight size={12} />
                </Link>
              </>
            )}
            <QuickFeelingFeedback ownerId={ownerId} />
          </section>

          <Link to="/calendar?new=1" className="surface-card focus-plan-link">
            <Timer size={20} />
            <span>
              <strong>留出下一段专注</strong>
              <small>在时间地图里，为重要的事预留位置</small>
            </span>
            <Zap size={16} />
          </Link>
        </aside>
      </div>
    </div>
  );
}
