import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/states";
import { localTime } from "@/lib/datetime";
import { useLocalMoodJournal } from "@/features/energy/mood-journal";
import { useLocalWorkspace } from "@/features/legacy/local-data";
import { useWorkspaces } from "@/features/team/queries";
import { startSoundscape, type SoundscapeKind, type SoundscapePlayback } from "./soundscape-engine";
import "./focus-tools.css";

function Symbol({ children }: { children: string }) { return <span className="material-symbols-outlined" aria-hidden="true">{children}</span>; }
function localId() { return typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `focus-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
type Step = { id: string; text: string; done: boolean; at: string; completedAt?: string };
type Note = { id: string; text: string; at: string; taskId?: string };
function validBase(value: unknown): value is Note {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Note>;
  return typeof item.id === "string" && typeof item.text === "string" && typeof item.at === "string" && Number.isFinite(Date.parse(item.at));
}
function validStep(value: unknown): value is Step { return validBase(value) && typeof (value as Partial<Step>).done === "boolean"; }
function useLocalList<T>(key: string, validate: (value: unknown) => value is T, limit: number) {
  const [state, setState] = useState<{ key: string; items: T[] }>({ key, items: [] }), [error, setError] = useState<unknown>(null);
  const items = state.key === key ? state.items : [];
  useEffect(() => {
    try { const data: unknown = JSON.parse(localStorage.getItem(key) ?? "[]"); setState({ key, items: Array.isArray(data) ? data.filter(validate).slice(0, limit) : [] }); setError(null); }
    catch { setState({ key, items: [] }); setError(new Error("无法读取本机记录，请检查浏览器存储权限。")); }
  }, [key, validate, limit]);
  function save(next: T[]) {
    try { const bounded = next.slice(0, limit); localStorage.setItem(key, JSON.stringify(bounded)); setState({ key, items: bounded }); setError(null); return true; }
    catch { setError(new Error("本机保存失败，此次修改尚未保存。请检查浏览器存储权限。")); return false; }
  }
  return { items, save, error };
}

export function FocusSteps({ ownerId, taskId, timezone }: { ownerId: string; taskId?: string; timezone: string }) {
  const steps = useLocalList(`shixu:focus-steps:${ownerId}:${taskId ?? "unselected"}`, validStep, 100);
  const notes = useLocalList(`shixu:focus-notes:${ownerId}`, validBase, 200);
  const [adding, setAdding] = useState(false), [text, setText] = useState(""), [note, setNote] = useState(""), [saved, setSaved] = useState(false);
  useEffect(() => { setAdding(false); setText(""); setNote(""); setSaved(false); }, [ownerId, taskId]);
  function add(event: FormEvent) {
    event.preventDefault(); if (!taskId || !ownerId || !text.trim()) return;
    if (steps.save([...steps.items, { id: localId(), text: text.trim().slice(0, 200), done: false, at: new Date().toISOString() }])) { setText(""); setAdding(false); }
  }
  function capture(event: FormEvent) {
    event.preventDefault(); if (!ownerId || !note.trim()) return;
    if (notes.save([{ id: localId(), text: note.trim().slice(0, 1000), at: new Date().toISOString(), taskId }, ...notes.items])) { setNote(""); setSaved(true); }
  }
  return <section className="surface-card focus-local-steps" aria-label="任务细分与闪念"><header><div><h2>任务细分推进</h2><span>{steps.items.filter(step => step.done).length} / {steps.items.length} 已完成</span></div><Button variant="ghost" size="sm" disabled={!taskId || steps.items.length >= 100} onClick={() => setAdding(value => !value)}><Symbol>add</Symbol>添加子步骤</Button></header>
    <p className="focus-local-scope">子步骤按当前账号与日程保存在本机，不修改服务端任务状态。</p>
    {adding && <form className="focus-add-step" onSubmit={add}><label className="sr-only" htmlFor="focus-step-input">子步骤内容</label><input id="focus-step-input" value={text} onChange={event => setText(event.target.value)} maxLength={200} required placeholder="写下一个清晰、可完成的步骤" autoFocus /><Button type="submit" size="sm" variant="secondary">保存子步骤</Button></form>}
    <div className="focus-step-list">{steps.items.length ? steps.items.map(step => <label className={`focus-step ${step.done ? "completed" : ""}`} key={step.id}><input type="checkbox" aria-label={step.text} checked={step.done} onChange={() => steps.save(steps.items.map(item => item.id === step.id ? { ...item, done: !item.done, completedAt: !item.done ? new Date().toISOString() : undefined } : item))} /><span className="focus-step-indicator"><Symbol>{step.done ? "check_circle" : "radio_button_unchecked"}</Symbol></span><span><strong>{step.text}</strong><small>{step.done && step.completedAt ? `${localTime(step.completedAt, timezone)} 完成 · 仅本机` : "待完成 · 仅本机步骤"}</small></span></label>) : <p className="focus-steps-empty">{taskId ? "还没有子步骤。从一个小动作开始，让重要的事更容易推进。" : "先选择或安排一项日程，再添加属于它的子步骤。"}</p>}</div>
    <InlineError error={steps.error} />
    <form className="focus-fleeting-form" onSubmit={capture}><Symbol>lightbulb</Symbol><label className="sr-only" htmlFor="focus-note-input">快速记录闪念备忘</label><input id="focus-note-input" value={note} onChange={event => { setNote(event.target.value); setSaved(false); }} maxLength={1000} autoComplete="off" placeholder="闪念备忘：捕获灵感或打扰，按回车暂存…" disabled={!ownerId} /><Button type="submit" size="sm" variant="ghost" disabled={!ownerId || !note.trim()}>暂存</Button></form>
    <InlineError error={notes.error} />{saved && <p role="status" className="focus-local-scope">闪念已暂存本机，不中断当前计时。</p>}
    {notes.items.length > 0 && <details className="focus-saved-notes"><summary>本机闪念备忘 · {notes.items.length} 条</summary><ul>{notes.items.map(item => <li key={item.id}><p>{item.text}</p><time dateTime={item.at}>{localTime(item.at, timezone)} · 仅本机</time><button type="button" aria-label={`删除闪念 ${item.text}`} onClick={() => notes.save(notes.items.filter(note => note.id !== item.id))}><Symbol>close</Symbol></button></li>)}</ul></details>}
  </section>;
}

const soundscapes: { kind: SoundscapeKind; title: string; icon: string; description: string }[] = [
  { kind: "rain", title: "森林细雨", icon: "rainy", description: "细密高频合成雨声" },
  { kind: "cafe", title: "咖啡杂音", icon: "local_cafe", description: "柔和中频合成底噪" },
  { kind: "ocean", title: "深海波动", icon: "waves", description: "缓慢起伏的低频声" },
  { kind: "brown", title: "布朗噪声", icon: "graphic_eq", description: "平稳浑厚的合成噪音" },
];
export function FocusSoundscape({ ownerId }: { ownerId: string }) {
  const [playing, setPlaying] = useState<SoundscapeKind>(), [pending, setPending] = useState<SoundscapeKind>(), [volume, setVolume] = useState(65), [error, setError] = useState<unknown>(null);
  const playback = useRef<SoundscapePlayback | undefined>(undefined), generation = useRef(0);
  useEffect(() => { setPlaying(undefined); setPending(undefined); setError(null); return () => { generation.current++; playback.current?.stop(); playback.current = undefined; }; }, [ownerId]);
  useEffect(() => { playback.current?.setVolume(volume / 100); }, [volume]);
  function stop() { generation.current++; playback.current?.stop(); playback.current = undefined; setPlaying(undefined); setPending(undefined); }
  async function toggle(kind: SoundscapeKind) {
    const wasPlaying = playing === kind; stop(); setError(null); if (wasPlaying) return;
    const turn = ++generation.current; setPending(kind);
    try { const next = await startSoundscape(kind, volume / 100); if (generation.current !== turn) { next.stop(); return; } playback.current = next; setPlaying(kind); }
    catch (failure) { if (generation.current === turn) setError(failure); }
    finally { if (generation.current === turn) setPending(undefined); }
  }
  return <section className="surface-card focus-soundscape" aria-label="沉浸白噪音伴侣"><header><h2><Symbol>headphones</Symbol>沉浸白噪音伴侣</h2><label><Symbol>volume_up</Symbol><input aria-label="白噪音音量" type="range" min={0} max={100} value={volume} onChange={event => setVolume(Number(event.target.value))} /><output>{volume}%</output></label></header><div className="focus-sound-options">{soundscapes.map(item => <button key={item.kind} type="button" className={playing === item.kind ? "playing" : ""} aria-pressed={playing === item.kind} disabled={!!pending} onClick={() => void toggle(item.kind)}><Symbol>{item.icon}</Symbol><span><strong>{item.title}</strong><small>{pending === item.kind ? "正在启动声音…" : playing === item.kind ? `播放中 · ${volume}% · 点按停止` : item.description}</small></span></button>)}</div><div className="focus-sound-status"><p>浏览器本机合成环境噪音，非实地录音；离开本页或切换账号会停止。</p>{playing && <Button variant="ghost" size="sm" onClick={stop}>停止播放</Button>}</div><InlineError error={error} /></section>;
}

const feelings = [{ label: "🔥 极佳", value: "Focused" }, { label: "✨ 平静", value: "Serene" }, { label: "☕ 疲惫", value: "Fatigued" }, { label: "⚡ 过载", value: "Exhausted" }] as const;
export function QuickFeelingFeedback({ ownerId }: { ownerId: string }) {
  const journal = useLocalMoodJournal(ownerId), navigate = useNavigate();
  return <div className="focus-quick-feelings"><p>快速体感反馈 <span>主观感受 · 仅本机</span></p><div>{feelings.map(feeling => <button type="button" key={feeling.value} disabled={!ownerId} onClick={() => { if (journal.record(feeling.value, `专注页快速反馈：${feeling.label.split(" ").slice(1).join(" ")}`)) navigate("/energy"); }}>{feeling.label}</button>)}</div><small>点按后保存并查看心情记录，不修改服务端精力分数。</small><InlineError error={journal.error} /></div>;
}
export function FocusMicrotaskCard() {
  const { data } = useLocalWorkspace();
  const candidates = data.tasks
    .filter(task => !task.completed && !task.archived)
    .sort((a, b) => Number(a.duration > 15) - Number(b.duration > 15) || a.duration - b.duration)
    .slice(0, 2);
  return <section className="surface-card focus-support-card"><header><Symbol>auto_awesome</Symbol><h2>时间晶体碎片填补</h2><span>{candidates.length ? "本机待办" : "自主选择"}</span></header><p>留出轻量任务的空间。进入微任务看板，查看当前账号保存在本机的小事。</p>{candidates.length ? <div className="focus-support-list">{candidates.map(task => { const query = new URLSearchParams({ new: "1", title: task.title, duration: String(Math.max(5, Math.min(480, task.duration))) }); return <div className="focus-support-item" key={task.id}><div><strong>{task.title}</strong><small>{task.duration} 分钟 · {task.priority} · 仅本机</small></div><Link to={`/calendar?${query.toString()}`} className="focus-support-action" aria-label={`将 ${task.title} 排入日历`}><Symbol>add_task</Symbol></Link></div>; })}</div> : <div className="focus-support-empty"><Symbol>hourglass_empty</Symbol><span>尚未运行服务端空隙匹配，不预填推荐任务或空闲时长。</span></div>}<Link to="/microtasks" className="button button-ghost"><Symbol>add_task</Symbol>前往微任务<Symbol>arrow_forward</Symbol></Link></section>;
}
export function FocusTeamCard() {
  const workspaces = useWorkspaces();
  const list = Array.isArray(workspaces.data?.workspaces) ? workspaces.data.workspaces : [];
  const primary = list[0];
  return <section className="surface-card focus-support-card"><header><Symbol>groups</Symbol><h2>协同自习室状态</h2><span>{primary ? "真实工作区" : "团队入口"}</span></header>{primary ? <div className="focus-support-empty"><Symbol>groups</Symbol><span>当前工作区：{primary.name}（{primary.memberCount} 位成员）。暂未接入实时在线自习状态，不显示虚构同桌。</span></div> : <div className="focus-support-empty"><Symbol>spatial_audio_off</Symbol><span>暂未接入在线自习状态，无可验证的在线成员。</span></div>}<p>团队页可查看真实工作区成员及其授权共享的安排。</p><Link to="/team" className="button button-ghost"><Symbol>groups</Symbol>前往团队协作</Link></section>;
}
