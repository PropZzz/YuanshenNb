import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowRight, BatteryCharging, Bluetooth, Brain, Check, CircleHelp, Clock3, FlaskConical, HeartPulse, Leaf, Moon, Radio, RefreshCw, ShieldCheck, Smartphone, Sparkles, Waves, Zap } from "@/components/ui/reference-icons";
import { Link } from "react-router-dom";
import { apiClient, type ApiComponents } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import { unwrap } from "@/api/unwrap";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, InlineError, LoadingState } from "@/components/ui/states";
import { displayDay, localDate, localTime } from "@/lib/datetime";
import { useAuthStore } from "@/stores/auth-store";
import { freshnessLabels, tierLabels, useEnergy } from "./queries";
import { CareTools, MoodCheckIn, MoodTimeline, SourceDetails, useLocalMoodJournal } from "./mood-journal";

type Energy = ApiComponents["EnergyTodayResponse"];
type Scenario = ApiComponents["ReplayScenario"];
const sources = { health_connect: "Health Connect", ble_gatt: "BLE 心率设备", replay_demo: "回放测试源" } satisfies Record<ApiComponents["SourceType"], string>;
const scenarios: { value: Scenario; label: string; description: string }[] = [
  { value: "well_rested", label: "充分休息", description: "睡眠恢复充分的测试场景" },
  { value: "sleep_deprived", label: "睡眠不足", description: "睡眠恢复不足的测试场景" },
  { value: "high_stress", label: "连续高压", description: "高压力与认知负荷的测试场景" },
];
const number = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
const signed = (value: number) => `${value > 0 ? "+" : ""}${number(value)}`;
function formattedInstant(value: string | undefined, timezone: string) { return value ? new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)) : "尚未同步"; }
function sleepDuration(minutes: number | undefined) { return minutes === undefined ? "未提供睡眠样本" : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`; }

export function EnergyPage() {
  const timezone = useAuthStore(state => state.user?.timezone ?? "Asia/Shanghai");
  const ownerId = useAuthStore(state => state.user?.id ?? "anonymous");
  const day = localDate(new Date(), timezone), energy = useEnergy(day), cache = useQueryClient();
  const [replayOpen, setReplayOpen] = useState(false), [scenario, setScenario] = useState<Scenario>("well_rested"), [confirmed, setConfirmed] = useState(false);
  const [careOpen, setCareOpen] = useState(false), [sourceOpen, setSourceOpen] = useState(false), journal = useLocalMoodJournal(ownerId);
  const replay = useMutation({
    mutationFn: async () => unwrap(await apiClient.POST("/api/v1/biometrics/replay-seed", { body: { day: energy.data?.localDay ?? day, scenario } satisfies ApiComponents["ReplaySeedRequest"] })),
    onSuccess: result => { cache.setQueryData(queryKeys.energy.today(day), result.latestEnergy); void cache.invalidateQueries({ queryKey: queryKeys.energy.profile }); setReplayOpen(false); setConfirmed(false); },
  });
  function openReplay() { replay.reset(); setConfirmed(false); setReplayOpen(true); }
  const data = energy.data;
  return <div className="energy-page">
    <header className="page-intro energy-intro"><div><p className="energy-breadcrumb">系统 <span>/</span> 个人状态 <span>/</span> 情绪与能量</p><div className="energy-title-line"><h1>情绪与能量追踪</h1><span>EMOTION &amp; ENERGY HUB</span></div></div><div className="energy-header-actions">{data && <span className={`energy-source-pill source-${data.dataFreshness}`}><span />{freshnessLabels[data.dataFreshness]}</span>}<Button variant="ghost" size="icon" aria-label="刷新精力数据" pending={energy.isFetching && !energy.isPending} onClick={() => void energy.refetch()}><RefreshCw size={17} /></Button><Button disabled={!data} onClick={() => setCareOpen(true)}><Leaf size={15} />关怀建议</Button><Button variant="ghost" onClick={openReplay}><FlaskConical size={15} />测试回放</Button></div></header>
    {replay.isSuccess && <p role="status" className="energy-replay-result"><Check size={15} /><strong>回放测试源</strong>已载入“{scenarios.find(item => item.value === replay.data.scenario)?.label}”场景，共 {replay.data.seededCount} 条测试样本。</p>}
    {energy.isPending ? <section className="surface-card"><LoadingState label="正在读取穿戴精力与预测曲线" /></section> : !data ? <section className="surface-card"><ErrorState error={energy.error} retry={() => void energy.refetch()} /></section> : <>
      {energy.isError && <InlineError error={energy.error} />}
      <section className="energy-top-grid">
        <article className="energy-hero surface-card"><div className="energy-hero-head"><div><p className="eyebrow">个人精力电量</p><div className="energy-score"><strong>{data.score}</strong><span>/ 100 分</span><em className={`energy-tier tier-${data.tier}`}>{tierLabels[data.tier]}</em></div></div><span className="energy-icon-tile"><Zap size={24} /></span></div>
          <div className="energy-gauge"><div className="energy-gauge-label"><span>认知负荷承载状态</span><strong>{freshnessLabels[data.dataFreshness]}</strong></div><div className="energy-meter" role="meter" aria-label="个人精力电量" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.score} aria-valuetext={`${data.score} 分，${tierLabels[data.tier]}`}><span style={{ width: `${data.score}%` }} /></div><div className="energy-meter-scale"><span>耗竭 0–34</span><span>平稳 55–79</span><span>高峰 80–100</span></div></div>
          <div className="energy-hero-capsules"><div><span>深度专注保护窗口</span><strong><ShieldCheck size={15} />{data.focusShields.length} 段推荐</strong></div><div><span>本次计算时间</span><strong><Clock3 size={15} /><time dateTime={data.computedAt}>{localTime(data.computedAt, data.timezone)}</time><small>{data.timezone}</small></strong></div></div>
        </article>
        <MoodCheckIn journal={journal} timezone={timezone} day={day} />
      </section>
      <CareTools journal={journal} open={careOpen} onOpenChange={setCareOpen} />
      <section className={`energy-care-strip ${data.overloadAlert ? "energy-care-alert" : ""}`}><span className="energy-care-icon">{data.overloadAlert ? <ShieldCheck size={21} /> : <Leaf size={21} />}</span><div><h2>{data.overloadAlert ? "精力保护建议" : data.dataFreshness === "replay_demo" ? "回放样本 · 仅供演示" : data.dataFreshness === "baseline_only" ? "当前为节律基线估算" : "让精力变化成为安排工作的参考"}</h2><p>{data.overloadAlert?.message ?? (data.dataFreshness === "baseline_only" ? "尚未收到可用穿戴样本。当前分数与曲线来自服务端节律和日程估算，并非实时生理测量。" : data.dataFreshness === "replay_demo" ? "当前使用你主动载入的回放测试数据，不代表真实穿戴测量；生产数据由 Android 端采集同步。" : "曲线由已同步样本、个人节律与日程负荷共同推演。保护建议需要你确认后才会调整日程。")}</p></div><Link to={data.overloadAlert ? "/calendar?rescue=1&trigger=wearable_fatigue" : "/settings"} className="button button-outline button-sm">{data.overloadAlert ? "预览保护方案" : "调整工作节律"}<ArrowRight size={14} /></Link></section>
      <section className="energy-lower-grid"><article className="energy-curve-card surface-card"><div className="energy-card-title"><div><h2>今日精力节律曲线</h2><p>{displayDay(data.localDay)} · {data.timezone} · {data.hourlyCurve.length} 个整点预测</p></div><span className="energy-legend"><i />服务端预测</span></div><EnergyCurve energy={data} /><div className="energy-curve-note"><Waves size={16} /><span>预测随穿戴同步和日程变更更新</span><small>{freshnessLabels[data.dataFreshness]}</small></div></article>
        <DriverPanel energy={data} /></section>
      <MoodTimeline journal={journal} timezone={timezone} day={day} onAdd={() => { document.getElementById("mood-note-input")?.focus(); document.getElementById("mood-note-input")?.scrollIntoView?.({ behavior: "smooth", block: "center" }); }} />
      <section className="energy-source-extra"><SourceDiagnostics energy={data} /><Button variant="outline" className="energy-source-details-button" onClick={() => setSourceOpen(true)}><Radio size={15} />查看来源详情</Button></section>
      <section className="energy-shields surface-card"><div className="energy-card-title"><div><h2><ShieldCheck size={18} />深度专注保护窗口</h2><p>由服务端按连续精力与日程占用推荐，不会自动创建或移动日程。</p></div><Link to="/calendar" className="energy-text-link">前往时间地图<ArrowRight size={14} /></Link></div>{data.focusShields.length ? <div className="energy-shield-list">{data.focusShields.map((shield, index) => <div className="energy-shield" key={`${shield.startAt}-${index}`}><span className="energy-shield-icon"><ShieldCheck size={19} /></span><div><strong>{localTime(shield.startAt, data.timezone)} — {localTime(shield.endAt, data.timezone)}</strong><small>{shield.source === "preferred_window" ? "个人首选专注窗口" : "连续高峰推荐"}</small></div><span>平均精力 <b>{shield.avgScore}</b></span></div>)}</div> : <div className="energy-shield-empty"><CircleHelp size={17} /><div><strong>暂无深度专注保护窗口</strong><p>当前尚无满足保护条件的连续窗口。同步穿戴数据或调整工作节律后，会自动重新评估。</p></div></div>}</section>
    </>}
    {data && <SourceDetails energy={data} open={sourceOpen} onOpenChange={setSourceOpen} />}
    <Dialog open={replayOpen} onOpenChange={open => { if (!replay.isPending) setReplayOpen(open); }} title="载入回放测试数据" description="这是显式测试操作。回放会写入当前账号，并始终标记为“回放测试源”，不会冒充真实穿戴数据。">
      <div className="energy-replay-options" role="radiogroup" aria-label="选择回放场景">{scenarios.map(item => <label className={`energy-replay-option ${scenario === item.value ? "selected" : ""}`} key={item.value}><input type="radio" name="replay-scenario" value={item.value} checked={scenario === item.value} disabled={replay.isPending} onChange={() => setScenario(item.value)} /><span><strong>{item.label}</strong><small>{item.description}</small></span></label>)}</div>
      <label className="energy-replay-confirm"><input type="checkbox" checked={confirmed} disabled={replay.isPending} onChange={event => setConfirmed(event.target.checked)} /><span>我了解这会写入回放测试数据，并同意以测试来源展示。</span></label><InlineError error={replay.error} /><div className="form-actions"><Button variant="ghost" disabled={replay.isPending} onClick={() => setReplayOpen(false)}>取消</Button><Button variant="secondary" disabled={!confirmed} pending={replay.isPending} onClick={() => replay.mutate()}><FlaskConical size={15} />确认载入回放</Button></div>
    </Dialog>
  </div>;
}

function SourceDiagnostics({ energy }: { energy: Energy }) {
  const diagnostic = energy.diagnostics;
  return <article className="energy-diagnostics surface-card"><div className="energy-card-title"><div><h2>穿戴数据来源与诊断</h2><p>由 Android 端采集同步，网页展示最新结果与来源。</p></div><span className="energy-diagnostic-symbol"><Radio size={20} /></span></div><div className="energy-source-options">{([{ value: "health_connect", label: "Health Connect", icon: Smartphone }, { value: "ble_gatt", label: "BLE 心率设备", icon: Bluetooth }, { value: "replay_demo", label: "回放测试源", icon: FlaskConical }] as const).map(({ value, label, icon: Icon }) => <div key={value} className={diagnostic.primarySource === value ? "active" : ""}><Icon size={18} /><strong>{label}</strong><small>{diagnostic.primarySource === value ? "当前来源" : value === "replay_demo" ? "需主动确认" : "Android 采集"}</small></div>)}</div><dl className="energy-diagnostic-grid"><div><dt>最近样本时间</dt><dd>{formattedInstant(diagnostic.lastSyncedAt, energy.timezone)}</dd></div><div><dt>个人基线历史</dt><dd>{diagnostic.baselineReadyDays} 天<span> / 14 天滚动窗口</span></dd></div><div><dt>HRV 基线</dt><dd>{diagnostic.hrvBaselineMs === undefined ? <small>尚未建立个人 HRV 基线</small> : <>{number(diagnostic.hrvBaselineMs)} <span>ms</span></>}</dd></div><div><dt>静息心率基线</dt><dd>{diagnostic.rhrBaselineBpm === undefined ? <small>尚未建立个人静息心率基线</small> : <>{number(diagnostic.rhrBaselineBpm)} <span>bpm</span></>}</dd></div></dl><p className="energy-source-foot"><span className={`energy-source-dot source-${energy.dataFreshness}`} />{diagnostic.primarySource ? sources[diagnostic.primarySource] : "尚未收到可用穿戴样本"}<span className="ml-auto">{freshnessLabels[energy.dataFreshness]}</span></p></article>;
}

function EnergyCurve({ energy }: { energy: Energy }) {
  const id = `energy-fill-${useId().replace(/:/g, "")}`;
  const points = [...energy.hourlyCurve].sort((a, b) => Date.parse(a.hourStartAt) - Date.parse(b.hourStartAt));
  if (!points.length) return <EmptyState title="暂无逐小时预测" description="服务端还没有返回本日曲线。刷新数据后重试，不会使用模拟曲线填补。" icon={Activity} />;
  const first = Date.parse(points[0].hourStartAt), last = Date.parse(points[points.length - 1].hourStartAt), span = Math.max(last - first, 1);
  const x = (at: string) => 44 + (Date.parse(at) - first) / span * 600, y = (score: number) => 185 - score / 100 * 155;
  const coordinates = points.map(point => `${x(point.hourStartAt)},${y(point.score)}`).join(" ");
  const ticks = points.filter((_, index) => index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 6)) === 0);
  return <div className="energy-chart-wrap"><svg viewBox="0 0 670 220" role="img" aria-label="24 小时精力预测曲线"><title>24 小时精力预测曲线</title><desc>{energy.localDay}，{energy.timezone}，共 {points.length} 个带 UTC 时间戳的服务端整点预测；夏令时切换日按实际点位展示。</desc><defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--rc-primary)" stopOpacity=".18" /><stop offset="100%" stopColor="var(--rc-primary)" stopOpacity="0" /></linearGradient></defs>{[0, 25, 50, 75, 100].map(value => <g key={value}><line x1="44" x2="644" y1={y(value)} y2={y(value)} className="energy-chart-grid" /><text x="28" y={y(value) + 3} textAnchor="end">{value}</text></g>)}{points.length > 1 && <><polygon points={`${x(points[0].hourStartAt)},185 ${coordinates} ${x(points[points.length - 1].hourStartAt)},185`} fill={`url(#${id})`} /><polyline points={coordinates} className="energy-chart-line" /></>}{points.map(point => <circle key={point.hourStartAt} data-hour={point.hourStartAt} cx={x(point.hourStartAt)} cy={y(point.score)} r={points.length < 8 ? 3.5 : 2.5} className="energy-chart-point"><title>{localTime(point.hourStartAt, energy.timezone)} · {point.score} 分 · {tierLabels[point.tier]}</title></circle>)}{ticks.map(point => <text key={point.hourStartAt} x={x(point.hourStartAt)} y="209" textAnchor="middle">{localTime(point.hourStartAt, energy.timezone)}</text>)}</svg><details className="energy-chart-values"><summary>查看逐小时数据</summary><div><table><caption className="sr-only">{energy.localDay} {energy.timezone} 精力预测</caption><thead><tr><th>本地时间</th><th>UTC 时间戳</th><th>精力</th><th>档位</th></tr></thead><tbody>{points.map(point => <tr key={point.hourStartAt}><td>{localTime(point.hourStartAt, energy.timezone)}</td><td>{point.hourStartAt}</td><td>{point.score}</td><td>{tierLabels[point.tier]}</td></tr>)}</tbody></table></div></details></div>;
}

function DriverPanel({ energy }: { energy: Energy }) {
  const d = energy.drivers;
  const drivers = [{ icon: Moon, label: "睡眠恢复", value: number(d.sleepRecoveryScore), detail: sleepDuration(d.sleepDurationMinutes), tone: "sleep" }, { icon: HeartPulse, label: "自主神经修正", value: signed(d.autonomicDeltaScore), detail: d.recentHrvRmssdMs === undefined ? "暂无近期 HRV 样本" : `近期 HRV ${number(d.recentHrvRmssdMs)} ms${d.recentRestingHrBpm === undefined ? "" : ` · 静息心率 ${number(d.recentRestingHrBpm)} bpm`}`, tone: "autonomic" }, { icon: Sparkles, label: "个人昼夜节律", value: `+${number(d.circadianScore)}`, detail: `按 ${energy.timezone} 本地时间推演`, tone: "circadian" }, { icon: Brain, label: "日程认知负荷", value: `−${number(d.cognitiveLoadDrainScore)}`, detail: "由已开始的日程负荷计算", tone: "load" }, { icon: BatteryCharging, label: "恢复缓冲回补", value: `+${number(d.recoveryBufferBonusScore)}`, detail: "来自已完成的恢复或空闲间隔", tone: "recovery" }];
  return <article className="energy-drivers surface-card"><div className="energy-card-title"><div><h2>今日精力影响因子</h2><p>每一分变化，都有可解释的来源。</p></div><span className="energy-diagnostic-symbol"><Activity size={19} /></span></div><div className="energy-driver-list">{drivers.map(({ icon: Icon, label, value, detail, tone }) => <div className={`energy-driver driver-${tone}`} key={label}><span className="energy-driver-icon"><Icon size={17} /></span><div><strong>{label}</strong><small>{detail}</small></div><b>{value}<small> 分</small></b></div>)}</div><p className="energy-driver-summary">{d.summary}</p></article>;
}
