import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, BatteryCharging, CalendarCheck, CheckCheck, CircleCheck, Clock3, Hourglass, ListTodo, Pause, Play, RefreshCw, ShieldCheck, Timer, Zap } from "@/components/ui/reference-icons";
import { apiClient, type ApiComponents } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import { unwrap } from "@/api/unwrap";
import { useAuthStore } from "@/stores/auth-store";
import { displayDay, localDate, localTime } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { ErrorState, InlineError, LoadingState, Notice } from "@/components/ui/states";
import { useEnergy, freshnessLabels, tierLabels } from "@/features/energy/queries";
import { categoryLabels, loadLabels, useInvalidateSchedule, useRescueHistory } from "@/features/calendar/queries";
import { formatTimer, remainingSeconds } from "./focus-clock";
import { useFocusSession } from "./focus-session";
import { useFocusCalendar } from "./focus-calendar";
import { FocusMicrotaskCard, FocusSoundscape, FocusSteps, FocusTeamCard, QuickFeelingFeedback } from "./focus-local-tools";

export function FocusPage() {
  const timezone = useAuthStore(s => s.user?.timezone ?? "Asia/Shanghai");
  const session=useFocusSession(),ownerId=useAuthStore(s=>s.user?.id??"");
  const {mode,setMode}=session;
  const [now, setNow] = useState(Date.now());
  const calendar = useFocusCalendar(now, ownerId, timezone);
  const { day, schedule, current, pending, choose, todayItems: items } = calendar;
  const energy = useEnergy(day), history = useRescueHistory(), invalidate = useInvalidateSchedule(), cache = useQueryClient();
  const matchingSession = session.ownerId === ownerId && session.itemId === current?.id;
  const startedAt=matchingSession?session.startedAt:null,savedSeconds=matchingSession?session.savedSeconds:0;
  const [immersive, setImmersive] = useState(false), [fullscreenError, setFullscreenError] = useState<unknown>(null);
  const focusRoot = useRef<HTMLDivElement>(null);
  function exitImmersion() { setImmersive(false); setFullscreenError(null); if (document.fullscreenElement === focusRoot.current) void document.exitFullscreen().catch(() => undefined); }
  async function enterFullscreen() { try { await focusRoot.current?.requestFullscreen(); } catch { setFullscreenError(new Error("浏览器未允许全屏，可继续使用当前沉浸视图。")); } }
  useEffect(() => { if (!immersive) return; function escape(event: KeyboardEvent) { if (event.key === "Escape") exitImmersion(); } document.addEventListener("keydown", escape); return () => document.removeEventListener("keydown", escape); }, [immersive]);
  useEffect(() => { const root = focusRoot.current; return () => { if (document.fullscreenElement === root && document.exitFullscreen) void document.exitFullscreen().catch(() => undefined); }; }, []);
  const running = startedAt !== null, elapsed = savedSeconds + (startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000)));
  const total = (current?.durationMinutes ?? 25) * 60;
  const displayed = mode === "flow" ? elapsed : startedAt === null ? Math.max(0,total-savedSeconds) : remainingSeconds(startedAt+(total-savedSeconds)*1000, now);
  const progress = Math.min(1, elapsed / total);
  useEffect(() => {
    const tick = () => setNow(Date.now()), id = window.setInterval(tick, 1000);
    window.addEventListener("focus", tick); document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", tick); };
  }, []);
  const update = useMutation({mutationFn: async ({ itemId, status }: { itemId: string; ownerId: string; status: "in_progress" | "completed" }) => {
    return unwrap(await apiClient.PATCH("/api/v1/schedule/items/{id}", { params: { path: { id: itemId } }, body: { status } }));
  }, onSuccess: (data, variables) => {
    // A response can arrive after navigation, a time boundary, or account changes.
    // Always bind to the requested item and ignore a previous account's response.
    if (useAuthStore.getState().user?.id !== variables.ownerId || data.item.userId !== variables.ownerId) return;
    cache.setQueriesData<ApiComponents["ScheduleItemListResponse"]>({ queryKey: queryKeys.schedule.itemsRoot }, old => old && ({ ...old, items: old.items.map(item => item.id === variables.itemId ? data.item : item) }));
    if (variables.status === "in_progress") { setNow(Date.now()); session.start(variables.ownerId,variables.itemId,data.item.startAt); }
    else if (useFocusSession.getState().ownerId === variables.ownerId && useFocusSession.getState().itemId === variables.itemId) session.clear();
    void invalidate();
  }});
  function pause() { session.pause(); }
  function changeStatus(status: "in_progress" | "completed") { if (current) update.mutate({ itemId: current.id, ownerId, status }); }
  function itemTime(startAt: string, endAt?: string) {
    const startDay = localDate(startAt, timezone), endDay = endAt ? localDate(endAt, timezone) : startDay;
    const start = `${startDay === day ? "" : `${displayDay(startDay, { month: "long", day: "numeric" })} `}${localTime(startAt, timezone)}`;
    return endAt ? `${start} — ${endDay === startDay ? "" : `${displayDay(endDay, { month: "long", day: "numeric" })} `}${localTime(endAt, timezone)}` : start;
  }
  const upcoming = pending.filter(item => item.id !== current?.id);
  const association = calendar.pinned ? "本次专注" : current && Date.parse(current.startAt) <= now ? "正在进行" : "下一项";
  const metrics = [
    { label: "今日专注", value: schedule.data ? formatTimer(elapsed) : "—:—", note: current ? "本次会话计时" : "今天没有更多日程", icon: Hourglass },
    { label: "今日的节奏", value: energy.data?.score ?? "—", note: energy.data ? freshnessLabels[energy.data.dataFreshness] : "等待读取精力", icon: BatteryCharging },
    { label: "后续待办", value: schedule.data ? upcoming.length : "—", note: upcoming[0]?.title ?? "近期没有更多日程", icon: ListTodo },
    { label: "日程救援", value: history.data ? history.data.snapshots.filter(s=>s.status==="applied").length : "—", note: "已应用 · 支持安全撤销", icon: ShieldCheck },
  ];
  return <div ref={focusRoot} className={`focus-page ${immersive ? "is-immersive" : ""}`}>
    <section className="focus-mobile-summary" aria-label="今日节律"><h2>{displayDay(day,{month:"long",day:"numeric",weekday:"long"})}</h2><Link to="/energy"><span className="focus-mobile-energy-icon"><BatteryCharging size={20}/></span><span>认知能量 <strong>{energy.data?.score??"—"}</strong><small>{energy.data?freshnessLabels[energy.data.dataFreshness]:energy.isError?"暂时无法读取精力":"正在读取精力"}</small></span>{energy.data&&<progress value={energy.data.score} max={100} aria-label="今日认知能量"/>}</Link></section>
    <section className="metric-grid" aria-label="今日安排概览">{metrics.map(({label,value,note,icon:Icon})=><div key={label} className="surface-card metric-card"><div className="metric-label">{label}</div><div className="focus-metric-reading"><p className="metric-value">{value}</p><p className="metric-note" title={note}>{note}</p></div><span className="metric-icon"><Icon size={22}/></span></div>)}</section>
    <div className="focus-columns"><div className="focus-main-column"><section className="surface-card focus-control">{immersive && <div className="focus-immersion-toolbar"><p>仅简化本页显示，不会屏蔽系统通知或控制其他应用。</p><div><Button variant="ghost" size="sm" disabled={typeof document.documentElement.requestFullscreen !== "function"} onClick={() => void enterFullscreen()}>浏览器全屏</Button><Button variant="outline" size="sm" onClick={exitImmersion}>退出沉浸</Button></div><InlineError error={fullscreenError} /></div>}
      {calendar.stoppedMessage && <Notice>{calendar.stoppedMessage}</Notice>}
      {calendar.loading ? <LoadingState label="正在读取日历专注任务"/> : calendar.error && !current ? <ErrorState error={calendar.error} retry={()=>void calendar.retry()}/> : current ? <>
        <div className="focus-calendar-association"><span aria-label="日历关联状态"><CalendarCheck size={14}/>智能日历 · {association}</span><Link to={`/calendar?day=${localDate(current.startAt,timezone)}&detail=${encodeURIComponent(current.id)}`} aria-label="在智能日历中查看当前事项">查看事项 <ArrowRight size={13}/></Link></div>
        <div className="flex flex-wrap justify-between gap-2"><div className="flex gap-2"><span className="badge badge-info">{loadLabels[current.cognitiveLoad]}</span><span className="badge">{categoryLabels[current.category]}</span></div><span className="badge" aria-label="当前事项时间"><Clock3 size={12}/>{itemTime(current.startAt,current.endAt)}</span></div>
        {calendar.error && <InlineError error={calendar.error}/>}
        <h1 className="focus-task-title">{current?.title??"把注意力，留给重要的事。"}</h1>
        <div className="focus-timer-panel"><div className="segmented" aria-label="计时方式"><button aria-pressed={mode==="flow"} disabled={running} onClick={()=>setMode("flow")}>正向心流</button><button aria-pressed={mode==="countdown"} disabled={running} onClick={()=>setMode("countdown")}>任务倒计时</button><button aria-pressed={immersive} onClick={() => immersive ? exitImmersion() : setImmersive(true)}>沉浸 · 勿扰</button></div>
          <div className="focus-timer"><svg viewBox="0 0 240 240" aria-hidden="true"><circle cx="120" cy="120" r="105"/><circle cx="120" cy="120" r="105" className="timer-progress" strokeDasharray={660} strokeDashoffset={660*(1-progress)}/></svg><div><strong role="timer" aria-label="本次专注计时">{current?formatTimer(displayed):"—:—"}</strong><span>{!current?"暂无待专注任务":running?"保持专注，按自己的节奏前进":elapsed?"已暂停 · 随时继续":"准备好，进入专注"}</span></div></div>
          <div className="focus-timer-actions"><Button disabled={!current||update.isPending} onClick={()=>running?pause():changeStatus("in_progress")} pending={update.isPending&&update.variables?.status==="in_progress"}>{running?<Pause size={17}/>:<Play size={17}/>}<span>{running?"暂停专注":elapsed?"继续专注":"开始专注"}</span></Button><Button variant="outline" disabled={!current||update.isPending} onClick={()=>changeStatus("completed")} aria-label="完成当前任务"><CheckCheck size={17}/><span>完成</span></Button></div>
          <InlineError error={update.error}/>{mode==="countdown"&&current&&displayed===0&&<Notice>计划专注时间已到。你可以继续工作，或主动标记任务完成。</Notice>}
        </div>
        <div className="focus-task-detail"><CircleCheck size={19}/><div><strong>{current.notes||"为这一件事，留一段不被打扰的时间。"}</strong><p>本次计时仅记录当前会话，不作为今日实际专注总时长。</p></div></div>
      </> : <div className="focus-empty-control"><CircleCheck size={30}/><h1>今天没有更多日程</h1><p className="focus-empty-note">未来 62 天内暂无待专注事项。</p><div><Button variant="ghost" size="sm" aria-label="检查今日日程" onClick={()=>void calendar.retry()}><RefreshCw size={14}/>检查</Button><Link to="/calendar?new=1" className="button button-ghost button-sm"><CalendarCheck size={14}/>去安排第一段专注</Link></div></div>}
    </section><FocusSteps ownerId={ownerId} taskId={current?.id} timezone={timezone} /><FocusSoundscape ownerId={ownerId} /><section className="surface-card focus-task-list"><header className="card-header"><h2 className="card-title">今日任务进程 <span className="badge ml-2">{items.filter(i=>i.status==="completed").length} / {items.length} 已完成</span></h2><Link to="/calendar" className="text-xs text-secondary">查看完整日历 <ArrowRight size={13} className="inline"/></Link></header><div className="focus-task-rows">{items.map(i=><button key={i.id} disabled={running||update.isPending||i.status==="completed"||Date.parse(i.endAt)<=now} onClick={()=>choose(i.id)} className={`focus-task-row ${current?.id===i.id?"selected":""} ${i.status==="completed"?"completed":""}`}><span className="task-check">{i.status==="completed"?<CircleCheck size={18}/>:<span/>}</span><span><strong>{i.title}</strong><small>{localTime(i.startAt,timezone)} · 计划 {i.durationMinutes} 分钟 · {categoryLabels[i.category]}</small></span><span className="badge">{i.status==="completed"?"已完成":current?.id===i.id?"当前任务":Date.parse(i.endAt)<=now?"已过时段":"选择专注"}</span></button>)}{items.length===0&&<p className="p-5 text-xs text-on-surface-variant">日程会显示在这里。已完成记录不会被替换为示例数据。</p>}</div></section></div>
    <aside className="focus-side-column"><section className="surface-card focus-energy"><header className="flex items-center justify-between gap-2"><h2 className="card-title">认知状态与恢复策略</h2><span className="badge badge-success">{energy.data?tierLabels[energy.data.tier]:"等待计算"}</span></header>{energy.isError?<ErrorState error={energy.error} retry={()=>void energy.refetch()}/>:energy.isPending?<LoadingState label="正在读取精力状态"/>:<><div className="focus-energy-score"><span>今日精力储备</span><strong>{energy.data.score}<small> / 100</small></strong></div><progress max={100} value={energy.data.score} aria-label="今日精力储备"/><div className="focus-energy-advice"><BatteryCharging size={16}/><strong>{freshnessLabels[energy.data.dataFreshness]}</strong><p>{energy.data.drivers.summary}</p></div><Link to="/energy" className="text-xs text-secondary">查看来源与节律曲线 <ArrowRight size={12} className="inline"/></Link></>}<QuickFeelingFeedback ownerId={ownerId} /></section>
    <section className="surface-card focus-protection"><ShieldCheck size={20}/><div><h2>给专注一点保护</h2><p>临时有事？先比较调整方案，再决定是否重排。</p><Link to="/calendar?rescue=1">查看救援方案 <ArrowRight size={12}/></Link></div></section>
    <section className="surface-card"><header className="card-header"><h2 className="card-title">后续待办流水线</h2><span className="badge">{upcoming.length} 项</span></header><div className="focus-upcoming">{upcoming.slice(0,5).map(i=><button key={i.id} disabled={running||update.isPending} onClick={()=>choose(i.id)}><span className={`upcoming-line category-${i.category}`}/><div><strong>{i.title}</strong><small>{categoryLabels[i.category]} · {i.durationMinutes} 分钟</small></div><time dateTime={i.startAt}>{itemTime(i.startAt)}</time></button>)}{upcoming.length===0&&<p>暂时没有更多待办，专注于眼前的这一刻。</p>}</div></section>
    <FocusMicrotaskCard /><FocusTeamCard /><Link to="/calendar?new=1" className="surface-card focus-plan-link"><Timer size={21}/><span><strong>留出下一段专注</strong><small>在时间地图里，为重要的事预留位置</small></span><Zap size={16}/></Link></aside></div>
  </div>;
}
