import { useEffect, useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  BatteryCharging,
  Bluetooth,
  Brain,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  FlaskConical,
  HeartPulse,
  Leaf,
  Moon,
  Radio,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Waves,
} from "@/components/ui/reference-icons";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient, type ApiComponents } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import { unwrap } from "@/api/unwrap";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, InlineError, LoadingState } from "@/components/ui/states";
import { dayRange, displayDay, localDate, localTime, shiftDay } from "@/lib/datetime";
import { useAuthStore } from "@/stores/auth-store";
import { loadLabels, useSchedules } from "@/features/calendar/queries";
import { freshnessLabels, tierLabels, useEnergy } from "./queries";
import { MoodJournalDrawer, SourceDetails, useLocalMoodJournal } from "./mood-journal";
import "./energy.css";

type Energy = ApiComponents["EnergyTodayResponse"];
type Scenario = ApiComponents["ReplayScenario"];

const sources = {
  health_connect: "Health Connect",
  ble_gatt: "BLE 心率设备",
  replay_demo: "回放测试源",
} satisfies Record<ApiComponents["SourceType"], string>;

const scenarios: { value: Scenario; label: string; description: string }[] = [
  { value: "well_rested", label: "充分休息", description: "睡眠恢复充分的测试场景" },
  { value: "sleep_deprived", label: "睡眠不足", description: "睡眠恢复不足的测试场景" },
  { value: "high_stress", label: "连续高压", description: "高压力与认知负荷的测试场景" },
];

const number = (value: number) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
const signed = (value: number) => `${value > 0 ? "+" : ""}${number(value)}`;

function formattedInstant(value: string | undefined, timezone: string) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: timezone,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(value))
    : "尚未同步";
}

function sleepDuration(minutes: number | undefined) {
  return minutes === undefined
    ? "未提供睡眠样本"
    : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

function buildSmoothPath(coords: Array<{ x: number; y: number }>): string {
  if (coords.length === 0) return "";
  if (coords.length === 1) return `M ${coords[0].x} ${coords[0].y}`;
  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[Math.max(0, i - 1)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(coords.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export function EnergyPage() {
  const timezone = useAuthStore(state => state.user?.timezone ?? "Asia/Shanghai");
  const ownerId = useAuthStore(state => state.user?.id ?? "anonymous");
  const today = localDate(new Date(), timezone);
  const [selectedDay, setSelectedDay] = useState(today);
  const [params, setParams] = useSearchParams();

  const energy = useEnergy(selectedDay);
  const range = dayRange(selectedDay, timezone);
  const schedule = useSchedules(range.from, range.to);
  const cache = useQueryClient();

  const [replayOpen, setReplayOpen] = useState(false);
  const [scenario, setScenario] = useState<Scenario>("well_rested");
  const [confirmed, setConfirmed] = useState(false);
  const [moodOpen, setMoodOpen] = useState(false);
  const [careOpen, setCareOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const journal = useLocalMoodJournal(ownerId);

  useEffect(() => {
    if (params.get("replay") === "1") {
      setConfirmed(false);
      setReplayOpen(true);
      setParams(
        next => {
          next.delete("replay");
          return next;
        },
        { replace: true },
      );
    }
  }, [params, setParams]);

  const replay = useMutation({
    mutationFn: async () =>
      unwrap(
        await apiClient.POST("/api/v1/biometrics/replay-seed", {
          body: {
            day: energy.data?.localDay ?? selectedDay,
            scenario,
          } satisfies ApiComponents["ReplaySeedRequest"],
        }),
      ),
    onSuccess: result => {
      cache.setQueryData(queryKeys.energy.today(selectedDay), result.latestEnergy);
      void cache.invalidateQueries({ queryKey: queryKeys.energy.profile });
      setReplayOpen(false);
      setConfirmed(false);
    },
  });

  function openReplay() {
    replay.reset();
    setConfirmed(false);
    setReplayOpen(true);
  }

  const data = energy.data;

  return (
    <div className="energy-page">
      <header className="page-intro energy-intro">
        <div>
          <p className="energy-breadcrumb">
            系统 <span>/</span> 个人状态 <span>/</span> 生理精力洞察
          </p>
          <div className="energy-title-line">
            <h1>情绪与能量追踪</h1>
            <span>PHYSIOLOGICAL INSIGHTS</span>
          </div>
        </div>

        <div className="energy-header-actions">
          <div className="energy-date-stepper" role="group" aria-label="精力日期切换">
            <Button
              variant="ghost"
              size="icon"
              aria-label="前一天精力"
              onClick={() => setSelectedDay(d => shiftDay(d, -1))}
            >
              <ChevronLeft size={16} />
            </Button>
            <span className="energy-date-label">
              {selectedDay === today ? "今天" : displayDay(selectedDay, { month: "numeric", day: "numeric" })}
              <small>{selectedDay}</small>
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="后一天精力"
              onClick={() => setSelectedDay(d => shiftDay(d, 1))}
            >
              <ChevronRight size={16} />
            </Button>
            {selectedDay !== today && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedDay(today)}>
                回到今天
              </Button>
            )}
          </div>

          {data && (
            <span className={`energy-source-pill source-${data.dataFreshness}`}>
              <span />
              {freshnessLabels[data.dataFreshness]}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="刷新精力数据"
            pending={energy.isFetching && !energy.isPending}
            onClick={() => void energy.refetch()}
          >
            <RefreshCw size={17} />
          </Button>
          <Button variant="outline" onClick={() => setMoodOpen(true)}>
            <HeartPulse size={15} />
            心境与呼吸
          </Button>
          <Button
            disabled={!data}
            onClick={() => {
              setMoodOpen(true);
              setCareOpen(true);
            }}
          >
            <Leaf size={15} />
            关怀建议
          </Button>
          <Button variant="ghost" onClick={openReplay}>
            <FlaskConical size={15} />
            测试回放
          </Button>
        </div>
      </header>

      {replay.isSuccess && (
        <p role="status" className="energy-replay-result">
          <Check size={15} />
          <strong>回放测试源</strong>已载入“
          {scenarios.find(item => item.value === replay.data.scenario)?.label}”场景，共{" "}
          {replay.data.seededCount} 条测试样本。
        </p>
      )}

      {energy.isPending ? (
        <section className="surface-card">
          <LoadingState label="正在读取穿戴精力与预测曲线" />
        </section>
      ) : !data ? (
        <section className="surface-card">
          <ErrorState error={energy.error} retry={() => void energy.refetch()} />
        </section>
      ) : (
        <>
          {energy.isError && <InlineError error={energy.error} />}

          {/* Dual Hero: 5-col Semi-Circular Gauge + 7-col 5-Factor Driver Attribution */}
          <section className="energy-hero-grid">
            <EnergyGaugeCard energy={data} />
            <DriverAttributionPanel energy={data} />
          </section>

          {/* Care / Honesty Strip */}
          <section className={`energy-care-strip ${data.overloadAlert ? "energy-care-alert" : ""}`}>
            <span className="energy-care-icon">
              {data.overloadAlert ? <ShieldCheck size={20} /> : <Leaf size={20} />}
            </span>
            <div>
              <h2>
                {data.overloadAlert
                  ? "精力保护建议"
                  : data.dataFreshness === "replay_demo"
                    ? "回放样本 · 仅供演示"
                    : data.dataFreshness === "baseline_only"
                      ? "当前为节律基线估算"
                      : "让精力变化成为安排工作的参考"}
              </h2>
              <p>
                {data.overloadAlert?.message ??
                  (data.dataFreshness === "baseline_only"
                    ? "尚未收到可用穿戴样本。当前分数与曲线来自服务端节律和日程估算，并非实时生理测量。"
                    : data.dataFreshness === "replay_demo"
                      ? "当前使用你主动载入的回放测试数据，不代表真实穿戴测量；生产数据由 Android 端采集同步。"
                      : "曲线由已同步样本、个人节律与日程负荷共同推演。保护建议需要你确认后才会调整日程。")}
              </p>
            </div>
            <Link
              to={data.overloadAlert ? "/calendar?rescue=1&trigger=wearable_fatigue" : "/settings"}
              className="button button-outline button-sm"
            >
              {data.overloadAlert ? "预览保护方案" : "调整工作节律"}
              <ArrowRight size={14} />
            </Link>
          </section>

          {/* Full-Width Interactive 24h Curve + Aligned Daily Schedule Load Mini-Track */}
          <article className="energy-curve-card surface-card">
            <div className="energy-card-title">
              <div>
                <h2>今日精力节律曲线</h2>
                <p>
                  {displayDay(data.localDay)} · {data.timezone} · {data.hourlyCurve.length}{" "}
                  个整点预测
                </p>
              </div>
              <div className="energy-curve-legends">
                <span className="energy-legend">
                  <i /> 服务端预测
                </span>
                {data.focusShields.length > 0 && (
                  <span className="energy-legend-shield">
                    <i /> 专注保护推荐带
                  </span>
                )}
              </div>
            </div>

            <EnergyCurveWithSchedule
              energy={data}
              items={schedule.data?.items ?? []}
              isToday={selectedDay === today}
            />

            <div className="energy-curve-note">
              <Waves size={16} />
              <span>悬停曲线节点可查看整点精力档位与下方对应时段日程负荷</span>
              <small>{freshnessLabels[data.dataFreshness]}</small>
            </div>
          </article>

          {/* Bottom Dual Cards: Focus Shields + Wearable/Baseline Health */}
          <section className="energy-bottom-grid">
            <article className="energy-shields surface-card">
              <div className="energy-card-title">
                <div>
                  <h2>
                    <ShieldCheck size={18} />
                    深度专注保护窗口
                  </h2>
                  <p>由服务端按连续精力与日程占用推荐，不会自动创建或移动日程。</p>
                </div>
                <Link to={`/calendar?day=${data.localDay}`} className="energy-text-link">
                  前往时间地图
                  <ArrowRight size={14} />
                </Link>
              </div>

              {data.focusShields.length ? (
                <div className="energy-shield-list">
                  {data.focusShields.map((shield, index) => {
                    const startHHMM = localTime(shield.startAt, data.timezone);
                    const endHHMM = localTime(shield.endAt, data.timezone);
                    return (
                      <div className="energy-shield" key={`${shield.startAt}-${index}`}>
                        <span className="energy-shield-icon">
                          <ShieldCheck size={19} />
                        </span>
                        <div className="energy-shield-meta">
                          <strong>
                            {startHHMM} — {endHHMM}
                          </strong>
                          <small>
                            {shield.source === "preferred_window"
                              ? "个人首选专注窗口"
                              : "连续高峰推荐"}{" "}
                            · 平均精力 {shield.avgScore}
                          </small>
                        </div>
                        <Link
                          to={`/calendar?new=1&day=${data.localDay}&time=${startHHMM}`}
                          className="button button-outline button-sm"
                        >
                          <CalendarPlus size={13} />
                          在此安排深度工作
                        </Link>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="energy-shield-empty">
                  <CircleHelp size={17} />
                  <div>
                    <strong>暂无深度专注保护窗口</strong>
                    <p>当前尚无满足保护条件的连续窗口。同步穿戴数据或调整工作节律后，会自动重新评估。</p>
                  </div>
                </div>
              )}
            </article>

            <SourceDiagnostics energy={data} onOpenDetails={() => setSourceOpen(true)} />
          </section>
        </>
      )}

      <MoodJournalDrawer
        open={moodOpen}
        onOpenChange={setMoodOpen}
        journal={journal}
        timezone={timezone}
        day={selectedDay}
        careOpen={careOpen}
        onCareOpenChange={setCareOpen}
      />

      {data && <SourceDetails energy={data} open={sourceOpen} onOpenChange={setSourceOpen} />}

      <Dialog
        open={replayOpen}
        onOpenChange={open => {
          if (!replay.isPending) setReplayOpen(open);
        }}
        title="载入回放测试数据"
        description="这是显式测试操作。回放会写入当前账号，并始终标记为“回放测试源”，不会冒充真实穿戴数据。"
      >
        <div className="energy-replay-options" role="radiogroup" aria-label="选择回放场景">
          {scenarios.map(item => (
            <label
              className={`energy-replay-option ${scenario === item.value ? "selected" : ""}`}
              key={item.value}
            >
              <input
                type="radio"
                name="replay-scenario"
                value={item.value}
                checked={scenario === item.value}
                disabled={replay.isPending}
                onChange={() => setScenario(item.value)}
              />
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
            </label>
          ))}
        </div>
        <label className="energy-replay-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={replay.isPending}
            onChange={event => setConfirmed(event.target.checked)}
          />
          <span>我了解这会写入回放测试数据，并同意以测试来源展示。</span>
        </label>
        <InlineError error={replay.error} />
        <div className="form-actions">
          <Button variant="ghost" disabled={replay.isPending} onClick={() => setReplayOpen(false)}>
            取消
          </Button>
          <Button
            variant="secondary"
            disabled={!confirmed}
            pending={replay.isPending}
            onClick={() => replay.mutate()}
          >
            <FlaskConical size={15} />
            确认载入回放
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function EnergyGaugeCard({ energy }: { energy: Energy }) {
  const clampedScore = Math.max(0, Math.min(100, energy.score));
  const arcLength = Math.PI * 84;
  const dashOffset = arcLength * (1 - clampedScore / 100);
  const strokeColor =
    energy.tier === "peak"
      ? "var(--rc-energy-peak)"
      : energy.tier === "steady"
        ? "var(--rc-energy-steady)"
        : energy.tier === "strained"
          ? "var(--rc-energy-strained)"
          : "var(--rc-energy-depleted)";

  return (
    <article className="energy-hero surface-card">
      <div className="energy-hero-head">
        <div>
          <p className="eyebrow">个人精力电量</p>
          <span className={`energy-tier tier-${energy.tier}`}>{tierLabels[energy.tier]}</span>
        </div>
        <span className={`energy-source-pill source-${energy.dataFreshness}`}>
          <span />
          {freshnessLabels[energy.dataFreshness]}
        </span>
      </div>

      <div className="energy-arc-wrap">
        <div
          className="energy-arc-meter"
          role="meter"
          aria-label="个人精力电量"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={energy.score}
          aria-valuetext={`${energy.score} 分，${tierLabels[energy.tier]}`}
        >
          <svg viewBox="0 0 220 132" aria-hidden="true">
            <path
              d="M 26 114 A 84 84 0 0 1 194 114"
              fill="none"
              stroke="var(--rc-surface-container-highest)"
              strokeWidth="14"
              strokeLinecap="round"
            />
            <path
              d="M 26 114 A 84 84 0 0 1 194 114"
              fill="none"
              stroke={strokeColor}
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={arcLength}
              strokeDashoffset={dashOffset}
            />
          </svg>
          <div className="energy-arc-readout">
            <strong>{energy.score}</strong>
            <span>/ 100 分</span>
          </div>
        </div>
        <p className="energy-arc-summary">{energy.drivers.summary}</p>
      </div>

      <div className="energy-hero-capsules">
        <div>
          <span>深度专注保护窗口</span>
          <strong>
            <ShieldCheck size={15} />
            {energy.focusShields.length} 段推荐
          </strong>
        </div>
        <div>
          <span>本次计算时间</span>
          <strong>
            <Clock3 size={15} />
            <time dateTime={energy.computedAt}>{localTime(energy.computedAt, energy.timezone)}</time>
            <small>{energy.timezone}</small>
          </strong>
        </div>
      </div>
    </article>
  );
}

function DriverAttributionPanel({ energy }: { energy: Energy }) {
  const d = energy.drivers;
  const diag = energy.diagnostics;
  const drivers = [
    {
      icon: Moon,
      label: "睡眠恢复",
      raw: d.sleepRecoveryScore,
      max: 60,
      value: number(d.sleepRecoveryScore),
      detail: sleepDuration(d.sleepDurationMinutes),
      tone: "sleep",
      negative: false,
    },
    {
      icon: HeartPulse,
      label: "自主神经修正",
      raw: Math.abs(d.autonomicDeltaScore),
      max: 25,
      value: signed(d.autonomicDeltaScore),
      detail:
        d.recentHrvRmssdMs === undefined
          ? "暂无近期 HRV 样本"
          : `近期 HRV ${number(d.recentHrvRmssdMs)} ms${
              diag.hrvBaselineMs !== undefined ? `（基线 ${number(diag.hrvBaselineMs)} ms）` : ""
            }${
              d.recentRestingHrBpm === undefined ? "" : ` · 静息心率 ${number(d.recentRestingHrBpm)} bpm`
            }`,
      tone: "autonomic",
      negative: d.autonomicDeltaScore < 0,
    },
    {
      icon: Sparkles,
      label: "个人昼夜节律",
      raw: Math.abs(d.circadianScore),
      max: 30,
      value: `+${number(d.circadianScore)}`,
      detail: `按 ${energy.timezone} 本地时间推演`,
      tone: "circadian",
      negative: false,
    },
    {
      icon: Brain,
      label: "日程认知负荷",
      raw: Math.abs(d.cognitiveLoadDrainScore),
      max: 50,
      value: `−${number(d.cognitiveLoadDrainScore)}`,
      detail: "由已开始的日程负荷计算",
      tone: "load",
      negative: true,
    },
    {
      icon: BatteryCharging,
      label: "恢复缓冲回补",
      raw: Math.abs(d.recoveryBufferBonusScore),
      max: 25,
      value: `+${number(d.recoveryBufferBonusScore)}`,
      detail: "来自已完成的恢复或空闲间隔",
      tone: "recovery",
      negative: false,
    },
  ];

  return (
    <article className="energy-drivers surface-card">
      <div className="energy-card-title">
        <div>
          <h2>今日精力影响因子归因</h2>
          <p>每一分变化，都来自五项服务端生理与日程模型因子。</p>
        </div>
        <span className="energy-diagnostic-symbol">
          <Activity size={19} />
        </span>
      </div>

      <div className="energy-driver-list">
        {drivers.map(({ icon: Icon, label, raw, max, value, detail, tone, negative }) => {
          const pct = Math.min(100, Math.max(4, Math.round((raw / max) * 100)));
          return (
            <div className={`energy-driver driver-${tone}`} key={label}>
              <div className="energy-driver-top">
                <span className="energy-driver-icon">
                  <Icon size={16} />
                </span>
                <div>
                  <strong>{label}</strong>
                  <small>{detail}</small>
                </div>
                <b className={negative ? "is-negative" : ""}>
                  {value}
                  <small> 分</small>
                </b>
              </div>
              <div className="energy-driver-bar" aria-hidden="true">
                <span
                  className={negative ? "is-negative" : ""}
                  style={{ width: `${raw === 0 ? 0 : pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function EnergyCurveWithSchedule({
  energy,
  items,
  isToday,
}: {
  energy: Energy;
  items: ApiComponents["ScheduleItemDTO"][];
  isToday: boolean;
}) {
  const id = `energy-fill-${useId().replace(/:/g, "")}`;
  const [hovered, setHovered] = useState<ApiComponents["HourlyEnergyPoint"] | null>(null);
  const points = [...energy.hourlyCurve].sort(
    (a, b) => Date.parse(a.hourStartAt) - Date.parse(b.hourStartAt),
  );

  if (!points.length) {
    return (
      <EmptyState
        title="暂无逐小时预测"
        description="服务端还没有返回本日曲线。刷新数据后重试，不会使用模拟曲线填补。"
        icon={Activity}
      />
    );
  }

  const first = Date.parse(points[0].hourStartAt);
  const last = Date.parse(points[points.length - 1].hourStartAt);
  const span = Math.max(last - first, 1);
  const xPx = (ms: number) => 44 + ((ms - first) / span) * 600;
  const x = (at: string) => xPx(Date.parse(at));
  const y = (score: number) => 185 - (score / 100) * 155;

  const coords = points.map(p => ({ x: x(p.hourStartAt), y: y(p.score) }));
  const smoothPath = buildSmoothPath(coords);
  const areaPath =
    coords.length > 1
      ? `${smoothPath} L ${coords[coords.length - 1].x.toFixed(1)} 185 L ${coords[0].x.toFixed(1)} 185 Z`
      : "";

  const ticks = points.filter(
    (_, index) =>
      index === 0 ||
      index === points.length - 1 ||
      index % Math.max(1, Math.ceil(points.length / 6)) === 0,
  );

  const nowMs = Date.now();
  const showNowMarker = isToday && nowMs >= first && nowMs <= last;
  const miniTrackItems = items
    .filter(item => item.status !== "cancelled")
    .map(item => ({
      item,
      start: Math.max(first, Date.parse(item.startAt)),
      end: Math.min(last, Date.parse(item.endAt)),
    }))
    .filter(block => block.end > block.start);

  return (
    <div className="energy-chart-wrap">
      {hovered && (
        <div className="energy-chart-tooltip" role="status">
          <strong>{localTime(hovered.hourStartAt, energy.timezone)}</strong>
          <span>
            {hovered.score} 分 · {tierLabels[hovered.tier]}
          </span>
        </div>
      )}

      <svg
        viewBox="0 0 670 220"
        role="img"
        aria-label="24 小时精力预测曲线"
        onMouseLeave={() => setHovered(null)}
      >
        <title>24 小时精力预测曲线</title>
        <desc>
          {energy.localDay}，{energy.timezone}，共 {points.length}{" "}
          个带 UTC 时间戳的服务端整点预测；夏令时切换日按实际点位展示。
        </desc>
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--rc-primary)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--rc-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <rect x="44" width="600" y={y(100)} height={y(80) - y(100)} className="energy-zone-peak" />
        <rect x="44" width="600" y={y(80)} height={y(55) - y(80)} className="energy-zone-steady" />
        <rect x="44" width="600" y={y(55)} height={y(35) - y(55)} className="energy-zone-strained" />
        <rect x="44" width="600" y={y(35)} height={y(0) - y(35)} className="energy-zone-depleted" />

        {energy.focusShields.map((shield, idx) => {
          const s = Math.max(first, Date.parse(shield.startAt));
          const e = Math.min(last, Date.parse(shield.endAt));
          if (!(e > s)) return null;
          return (
            <rect
              key={`shield-band-${idx}`}
              x={xPx(s)}
              width={Math.max(4, xPx(e) - xPx(s))}
              y={30}
              height={155}
              className="energy-chart-shield-band"
            />
          );
        })}

        {[0, 25, 50, 75, 100].map(value => (
          <g key={value}>
            <line x1="44" x2="644" y1={y(value)} y2={y(value)} className="energy-chart-grid" />
            <text x="34" y={y(value) + 4} textAnchor="end">
              {value}
            </text>
          </g>
        ))}

        {showNowMarker && (
          <line x1={xPx(nowMs)} x2={xPx(nowMs)} y1={28} y2={185} className="energy-chart-now" />
        )}

        {hovered && (
          <line
            x1={x(hovered.hourStartAt)}
            x2={x(hovered.hourStartAt)}
            y1={30}
            y2={185}
            className="energy-chart-crosshair"
          />
        )}

        {points.length > 1 && (
          <>
            <path d={areaPath} fill={`url(#${id})`} />
            <path d={smoothPath} className="energy-chart-line" />
          </>
        )}

        {points.map(point => (
          <circle
            key={point.hourStartAt}
            data-hour={point.hourStartAt}
            cx={x(point.hourStartAt)}
            cy={y(point.score)}
            r={hovered?.hourStartAt === point.hourStartAt ? 5 : points.length < 8 ? 3.5 : 2.8}
            className={`energy-chart-point tier-${point.tier}`}
            onMouseEnter={() => setHovered(point)}
          >
            <title>
              {localTime(point.hourStartAt, energy.timezone)} · {point.score} 分 ·{" "}
              {tierLabels[point.tier]}
            </title>
          </circle>
        ))}

        {ticks.map(point => (
          <text key={point.hourStartAt} x={x(point.hourStartAt)} y="209" textAnchor="middle">
            {localTime(point.hourStartAt, energy.timezone)}
          </text>
        ))}
      </svg>

      <div className="energy-schedule-track-wrap" aria-label="同日日程负荷对齐带">
        <span className="energy-schedule-track-label">日程负荷</span>
        <div className="energy-schedule-track">
          {miniTrackItems.length === 0 ? (
            <span className="energy-schedule-empty">曲线时间窗内暂无日程占用</span>
          ) : (
            miniTrackItems.map(({ item, start, end }) => (
              <div
                key={item.id}
                className={`energy-schedule-block load-${item.cognitiveLoad}`}
                style={{
                  left: `${((start - first) / span) * 100}%`,
                  width: `${Math.max(1.5, ((end - start) / span) * 100)}%`,
                }}
                title={`${item.title} · ${localTime(item.startAt, energy.timezone)}–${localTime(
                  item.endAt,
                  energy.timezone,
                )} · ${loadLabels[item.cognitiveLoad]}`}
              >
                <span>{item.title}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <details className="energy-chart-values">
        <summary>查看逐小时数据</summary>
        <div>
          <table>
            <caption className="sr-only">
              {energy.localDay} {energy.timezone} 精力预测
            </caption>
            <thead>
              <tr>
                <th>本地时间</th>
                <th>UTC 时间戳</th>
                <th>精力</th>
                <th>档位</th>
              </tr>
            </thead>
            <tbody>
              {points.map(point => (
                <tr key={point.hourStartAt}>
                  <td>{localTime(point.hourStartAt, energy.timezone)}</td>
                  <td>{point.hourStartAt}</td>
                  <td>{point.score}</td>
                  <td>{tierLabels[point.tier]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function SourceDiagnostics({
  energy,
  onOpenDetails,
}: {
  energy: Energy;
  onOpenDetails: () => void;
}) {
  const diagnostic = energy.diagnostics;
  const baselinePct = Math.min(100, Math.round((diagnostic.baselineReadyDays / 14) * 100));

  return (
    <article className="energy-diagnostics surface-card">
      <div className="energy-card-title">
        <div>
          <h2>穿戴数据来源与 14 天基线</h2>
          <p>由 Android 端采集同步，网页展示最新结果与来源。</p>
        </div>
        <span className="energy-diagnostic-symbol">
          <Radio size={20} />
        </span>
      </div>

      <div className="energy-source-options">
        {(
          [
            { value: "health_connect", label: "Health Connect", icon: Smartphone },
            { value: "ble_gatt", label: "BLE 心率设备", icon: Bluetooth },
            { value: "replay_demo", label: "回放测试源", icon: FlaskConical },
          ] as const
        ).map(({ value, label, icon: Icon }) => (
          <div key={value} className={diagnostic.primarySource === value ? "active" : ""}>
            <Icon size={18} />
            <strong>{label}</strong>
            <small>
              {diagnostic.primarySource === value
                ? "当前来源"
                : value === "replay_demo"
                  ? "需主动确认"
                  : "Android 采集"}
            </small>
          </div>
        ))}
      </div>

      <div className="energy-baseline-progress">
        <div>
          <span>个人 14 天滚动基线积累</span>
          <strong>
            {diagnostic.baselineReadyDays} 天<span> / 14 天</span>
          </strong>
        </div>
        <div className="energy-baseline-track" aria-hidden="true">
          <span style={{ width: `${baselinePct}%` }} />
        </div>
      </div>

      <dl className="energy-diagnostic-grid">
        <div>
          <dt>最近样本时间</dt>
          <dd>{formattedInstant(diagnostic.lastSyncedAt, energy.timezone)}</dd>
        </div>
        <div>
          <dt>数据新鲜度</dt>
          <dd>{freshnessLabels[energy.dataFreshness]}</dd>
        </div>
        <div>
          <dt>HRV 基线</dt>
          <dd>
            {diagnostic.hrvBaselineMs === undefined ? (
              <small>尚未建立个人 HRV 基线</small>
            ) : (
              <>
                {number(diagnostic.hrvBaselineMs)} <span>ms</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>静息心率基线</dt>
          <dd>
            {diagnostic.rhrBaselineBpm === undefined ? (
              <small>尚未建立个人静息心率基线</small>
            ) : (
              <>
                {number(diagnostic.rhrBaselineBpm)} <span>bpm</span>
              </>
            )}
          </dd>
        </div>
      </dl>

      <div className="energy-source-foot">
        <span className={`energy-source-dot source-${energy.dataFreshness}`} />
        <span>
          {diagnostic.primarySource ? sources[diagnostic.primarySource] : "尚未收到可用穿戴样本"}
        </span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={onOpenDetails}>
          <Radio size={14} />
          查看来源详情
        </Button>
      </div>
    </article>
  );
}
