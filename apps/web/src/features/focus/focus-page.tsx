import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, BatteryCharging, CalendarCheck, CheckCheck, CircleCheck, Clock3, Hourglass, ListTodo, Pause, Play, RefreshCw, ShieldCheck, Timer, Zap } from "@/components/ui/reference-icons";
import { apiClient } from "@/api/client";
import { unwrap } from "@/api/unwrap";
import { useAuthStore } from "@/stores/auth-store";
import { dayRange, displayDay, localDate, localTime } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { ErrorState, InlineError, LoadingState, Notice } from "@/components/ui/states";
import { useEnergy, freshnessLabels, tierLabels } from "@/features/energy/queries";
import { categoryLabels, loadLabels, useInvalidateSchedule, useRescueHistory, useSchedules } from "@/features/calendar/queries";
import { formatTimer, remainingSeconds } from "./focus-clock";
import { useFocusSession } from "./focus-session";
import { FocusMicrotaskCard, FocusSoundscape, FocusSteps, FocusTeamCard, QuickFeelingFeedback } from "./focus-local-tools";

export function FocusPage() {
  const timezone = useAuthStore(s => s.user?.timezone ?? "Asia/Shanghai");
  const day = localDate(new Date(), timezone), range = dayRange(day, timezone);
  const schedule = useSchedules(range.from, range.to), energy = useEnergy(day), history = useRescueHistory(), invalidate = useInvalidateSchedule();
  const session=useFocusSession(),ownerId=useAuthStore(s=>s.user?.id??"");
  const {mode,setMode}=session,selectedId=session.ownerId===ownerId?session.itemId:undefined;
  const startedAt=session.ownerId===ownerId?session.startedAt:null,savedSeconds=session.ownerId===ownerId?session.savedSeconds:0;
  const [now, setNow] = useState(Date.now());
  const [immersive, setImmersive] = useState(false), [fullscreenError, setFullscreenError] = useState<unknown>(null);
  const focusRoot = useRef<HTMLDivElement>(null);
  function exitImmersion() { setImmersive(false); setFullscreenError(null); if (document.fullscreenElement === focusRoot.current) void document.exitFullscreen().catch(() => undefined); }
  async function enterFullscreen() { try { await focusRoot.current?.requestFullscreen(); } catch { setFullscreenError(new Error("浏览器未允许全屏，可继续使用当前沉浸视图。")); } }
  useEffect(() => { if (!immersive) return; function escape(event: KeyboardEvent) { if (event.key === "Escape") exitImmersion(); } document.addEventListener("keydown", escape); return () => document.removeEventListener("keydown", escape); }, [immersive]);
  useEffect(() => { const root = focusRoot.current; return () => { if (document.fullscreenElement === root && document.exitFullscreen) void document.exitFullscreen().catch(() => undefined); }; }, []);
  const items = (schedule.data?.items ?? []).filter(i => i.status !== "cancelled").sort((a,b) => a.startAt.localeCompare(b.startAt));
  const pending = items.filter(i => i.status !== "completed"), current = pending.find(i => i.id === selectedId) ?? pending.find(i => i.status === "in_progress") ?? pending[0];
  const running = startedAt !== null, elapsed = savedSeconds + (startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000)));
  const total = (current?.durationMinutes ?? 25) * 60;
  const displayed = mode === "flow" ? elapsed : startedAt === null ? Math.max(0,total-savedSeconds) : remainingSeconds(startedAt+(total-savedSeconds)*1000, now);
  const progress = Math.min(1, elapsed / total);
  useEffect(() => { if (!running) return; const id = window.setInterval(() => setNow(Date.now()), 500); return () => clearInterval(id); }, [running]);
  const update = useMutation({mutationFn: async (status: "in_progress" | "completed") => {
    if (!current) throw new Error("请先选择一项日程");
    return unwrap(await apiClient.PATCH("/api/v1/schedule/items/{id}", { params: { path: { id: current.id } }, body: { status } }));
  }, onSuccess: (_, status) => {
    if (status === "in_progress") { setNow(Date.now()); session.start(ownerId,current!.id); }
    else session.clear();
    void invalidate();
  }});
  function pause() { session.pause(); }
  function choose(id: string) { session.choose(ownerId,id); }
  const metrics = [
    { label: "今日专注", value: schedule.data ? formatTimer(elapsed) : "—:—", note: current ? "本次会话计时" : "今天没有更多日程", icon: Hourglass },
    { label: "今日的节奏", value: energy.data?.score ?? "—", note: energy.data ? freshnessLabels[energy.data.dataFreshness] : "等待读取精力", icon: BatteryCharging },
    { label: "后续待办", value: schedule.data ? pending.filter(i=>i.id!==current?.id).length : "—", note: pending.find(i=>i.id!==current?.id)?.title ?? "今天没有更多日程", icon: ListTodo },
    { label: "日程救援", value: history.data ? history.data.snapshots.filter(s=>s.status==="applied").length : "—", note: "已应用 · 支持安全撤销", icon: ShieldCheck },
  ];
  return <div ref={focusRoot} className={`focus-page ${immersive ? "is-immersive" : ""}`}>
    <section className="focus-mobile-summary" aria-label="今日节律"><h2>{displayDay(day,{month:"long",day:"numeric",weekday:"long"})}</h2><Link to="/energy"><span className="focus-mobile-energy-icon"><BatteryCharging size={20}/></span><span>认知能量 <strong>{energy.data?.score??"—"}</strong><small>{energy.data?freshnessLabels[energy.data.dataFreshness]:energy.isError?"暂时无法读取精力":"正在读取精力"}</small></span>{energy.data&&<progress value={energy.data.score} max={100} aria-label="今日认知能量"/>}</Link></section>
    <section className="metric-grid" aria-label="今日安排概览">{metrics.map(({label,value,note,icon:Icon})=><div key={label} className="surface-card metric-card"><div className="metric-label">{label}</div><div className="focus-metric-reading"><p className="metric-value">{value}</p><p className="metric-note" title={note}>{note}</p></div><span className="metric-icon"><Icon size={22}/></span></div>)}</section>
    <div className="focus-columns"><div className="focus-main-column"><section className="surface-card focus-control">{immersive && <div className="focus-immersion-toolbar"><p>仅简化本页显示，不会屏蔽系统通知或控制其他应用。</p><div><Button variant="ghost" size="sm" disabled={typeof document.documentElement.requestFullscreen !== "function"} onClick={() => void enterFullscreen()}>浏览器全屏</Button><Button variant="outline" size="sm" onClick={exitImmersion}>退出沉浸</Button></div><InlineError error={fullscreenError} /></div>}
      {schedule.isPending ? <LoadingState label="正在读取今日专注任务"/> : schedule.isError ? <ErrorState error={schedule.error} retry={()=>void schedule.refetch()}/> : current ? <>
        <div className="flex flex-wrap justify-between gap-2"><div className="flex gap-2"><span className="badge badge-info">{current?loadLabels[current.cognitiveLoad]:"留出专注时间"}</span><span className="badge">{current?categoryLabels[current.category]:"今日专注"}</span></div><span className="badge"><Clock3 size={12}/>{current?`${localTime(current.startAt,timezone)} — ${localTime(current.endAt,timezone)}`:"等待你的下一段安排"}</span></div>
        <h1 className="focus-task-title">{current?.title??"把注意力，留给重要的事。"}</h1>
        <div className="focus-timer-panel"><div className="segmented" aria-label="计时方式"><button aria-pressed={mode==="flow"} disabled={running} onClick={()=>setMode("flow")}>正向心流</button><button aria-pressed={mode==="countdown"} disabled={running} onClick={()=>setMode("countdown")}>任务倒计时</button><button aria-pressed={immersive} onClick={() => immersive ? exitImmersion() : setImmersive(true)}>沉浸 · 勿扰</button></div>
          <div className="focus-timer"><svg viewBox="0 0 240 240" aria-hidden="true"><circle cx="120" cy="120" r="105"/><circle cx="120" cy="120" r="105" className="timer-progress" strokeDasharray={660} strokeDashoffset={660*(1-progress)}/></svg><div><strong role="timer" aria-label="本次专注计时">{current?formatTimer(displayed):"—:—"}</strong><span>{!current?"暂无待专注任务":running?"保持专注，按自己的节奏前进":elapsed?"已暂停 · 随时继续":"准备好，进入专注"}</span></div></div>
          <div className="focus-timer-actions"><Button disabled={!current||update.isPending} onClick={()=>running?pause():update.mutate("in_progress")} pending={update.isPending&&update.variables==="in_progress"}>{running?<Pause size={17}/>:<Play size={17}/>}<span>{running?"暂停专注":elapsed?"继续专注":"开始专注"}</span></Button><Button variant="outline" disabled={!current||update.isPending} onClick={()=>update.mutate("completed")} aria-label="完成当前任务"><CheckCheck size={17}/><span>完成</span></Button></div>
          <InlineError error={update.error}/>{mode==="countdown"&&current&&displayed===0&&<Notice>计划专注时间已到。你可以继续工作，或主动标记任务完成。</Notice>}
        </div>
        <div className="focus-task-detail"><CircleCheck size={19}/><div><strong>{current.notes||"为这一件事，留一段不被打扰的时间。"}</strong><p>本次计时仅记录当前会话，不作为今日实际专注总时长。</p></div></div>
      </> : <div className="focus-empty-control"><CircleCheck size={30}/><h1>今天没有更多日程</h1><div><Button variant="ghost" size="sm" aria-label="检查今日日程" onClick={()=>void schedule.refetch()}><RefreshCw size={14}/>检查</Button><Link to="/calendar?new=1" className="button button-ghost button-sm"><CalendarCheck size={14}/>去安排第一段专注</Link></div></div>}
    </section><FocusSteps ownerId={ownerId} taskId={current?.id} timezone={timezone} /><FocusSoundscape ownerId={ownerId} /><section className="surface-card focus-task-list"><header className="card-header"><h2 className="card-title">今日任务进程 <span className="badge ml-2">{items.filter(i=>i.status==="completed").length} / {items.length} 已完成</span></h2><Link to="/calendar" className="text-xs text-secondary">查看完整日历 <ArrowRight size={13} className="inline"/></Link></header><div className="focus-task-rows">{items.map(i=><button key={i.id} disabled={running||i.status==="completed"} onClick={()=>choose(i.id)} className={`focus-task-row ${current?.id===i.id?"selected":""} ${i.status==="completed"?"completed":""}`}><span className="task-check">{i.status==="completed"?<CircleCheck size={18}/>:<span/>}</span><span><strong>{i.title}</strong><small>{localTime(i.startAt,timezone)} · 计划 {i.durationMinutes} 分钟 · {categoryLabels[i.category]}</small></span><span className="badge">{i.status==="completed"?"已完成":current?.id===i.id?"当前任务":"选择专注"}</span></button>)}{items.length===0&&<p className="p-5 text-xs text-on-surface-variant">日程会显示在这里。已完成记录不会被替换为示例数据。</p>}</div></section></div>
    <aside className="focus-side-column"><section className="surface-card focus-energy"><header className="flex items-center justify-between gap-2"><h2 className="card-title">认知状态与恢复策略</h2><span className="badge badge-success">{energy.data?tierLabels[energy.data.tier]:"等待计算"}</span></header>{energy.isError?<ErrorState error={energy.error} retry={()=>void energy.refetch()}/>:energy.isPending?<LoadingState label="正在读取精力状态"/>:<><div className="focus-energy-score"><span>今日精力储备</span><strong>{energy.data.score}<small> / 100</small></strong></div><progress max={100} value={energy.data.score} aria-label="今日精力储备"/><div className="focus-energy-advice"><BatteryCharging size={16}/><strong>{freshnessLabels[energy.data.dataFreshness]}</strong><p>{energy.data.drivers.summary}</p></div><Link to="/energy" className="text-xs text-secondary">查看来源与节律曲线 <ArrowRight size={12} className="inline"/></Link></>}<QuickFeelingFeedback ownerId={ownerId} /></section>
    <section className="surface-card focus-protection"><ShieldCheck size={20}/><div><h2>给专注一点保护</h2><p>临时有事？先比较调整方案，再决定是否重排。</p><Link to="/calendar?rescue=1">查看救援方案 <ArrowRight size={12}/></Link></div></section>
    <section className="surface-card"><header className="card-header"><h2 className="card-title">后续待办流水线</h2><span className="badge">{pending.filter(i=>i.id!==current?.id).length} 项</span></header><div className="focus-upcoming">{pending.filter(i=>i.id!==current?.id).slice(0,5).map(i=><button key={i.id} disabled={running} onClick={()=>choose(i.id)}><span className={`upcoming-line category-${i.category}`}/><div><strong>{i.title}</strong><small>{categoryLabels[i.category]} · {i.durationMinutes} 分钟</small></div><time>{localTime(i.startAt,timezone)}</time></button>)}{pending.filter(i=>i.id!==current?.id).length===0&&<p>暂时没有更多待办，专注于眼前的这一刻。</p>}</div></section>
    <FocusMicrotaskCard /><FocusTeamCard /><Link to="/calendar?new=1" className="surface-card focus-plan-link"><Timer size={21}/><span><strong>留出下一段专注</strong><small>在时间地图里，为重要的事预留位置</small></span><Zap size={16}/></Link></aside></div>
  </div>;
}
