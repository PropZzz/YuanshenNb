import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, Fingerprint, Globe2, Monitor, Moon, Plus, ShieldCheck, Sun, Sunrise, Trash2, Users, UserRound } from "@/components/ui/reference-icons";
import { apiClient, type ApiComponents } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import { unwrap } from "@/api/unwrap";
import { Button } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/date-time-field";
import { EmptyState, ErrorState, InlineError, LoadingState } from "@/components/ui/states";
import { minuteLabel } from "@/lib/datetime";
import { useAuthStore } from "@/stores/auth-store";
import { useEnergyProfile } from "@/features/energy/queries";
import { privacyLabels, useWorkspaces } from "@/features/team/queries";

type User = ApiComponents["UserProfile"];
type Theme = ApiComponents["ThemeMode"];
type Chronotype = ApiComponents["Chronotype"];
const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [{ value: "light", label: "浅色", icon: Sun }, { value: "dark", label: "深色", icon: Moon }, { value: "system", label: "跟随系统", icon: Monitor }];
const chronotypes: { value: Chronotype; label: string; description: string; icon: typeof Sun }[] = [{ value: "morning_lark", label: "晨型", description: "更偏好上午的工作节律", icon: Sunrise }, { value: "balanced", label: "均衡型", description: "兼顾上午与下午的专注", icon: Sun }, { value: "night_owl", label: "夜猫型", description: "更偏好较晚的工作节律", icon: Moon }];

export function SettingsPage() {
  const me = useQuery({ queryKey: queryKeys.auth.me, queryFn: async () => unwrap(await apiClient.GET("/api/v1/auth/me")), staleTime: 60_000 });
  const profile = useEnergyProfile(), workspaces = useWorkspaces();
  return <div className="settings-page"><h1 className="sr-only">账号与隐私</h1>
    <section className="settings-account-grid"><article className="settings-account-card surface-card">{me.isPending ? <LoadingState label="正在读取账户信息" /> : me.isError ? <ErrorState error={me.error} retry={() => void me.refetch()} /> : <AccountSettings key={me.data.id} user={me.data} />}</article></section>
    <section className="settings-detail-grid"><article className="settings-rhythm-card surface-card">{profile.isPending ? <LoadingState label="正在读取个人工作节律" /> : profile.isError ? <ErrorState error={profile.error} retry={() => void profile.refetch()} /> : <RhythmSettings key={profile.data.userId} profile={profile.data} timezone={me.data?.timezone ?? useAuthStore.getState().user?.timezone ?? "Asia/Shanghai"} />}</article>
      <article className="settings-workspaces-card surface-card"><div className="settings-section-heading"><span className="settings-section-icon"><Users size={19} /></span><div><h2>团队共享范围</h2><p>为每一个团队选择适合的隐私颗粒度。</p></div></div>{workspaces.isPending ? <LoadingState label="正在读取团队共享设置" /> : workspaces.isError ? <ErrorState error={workspaces.error} retry={() => void workspaces.refetch()} /> : workspaces.data.workspaces.length ? <div className="settings-workspace-list">{workspaces.data.workspaces.map(workspace => <WorkspacePrivacy key={workspace.id} workspace={workspace} />)}</div> : <EmptyState icon={Users} title="还没有加入团队" description="加入或创建团队后，可以在这里分别管理每个团队的共享范围。" action="前往团队" to="/team" />}<div className="settings-privacy-legend"><h3><ShieldCheck size={15} />三个等级，都不共享原始生理数据</h3><dl><div><dt>仅忙闲</dt><dd>只显示占用状态，不显示精力档位与标题。</dd></div><div><dt>忙闲与精力等级</dt><dd>增加高峰、平稳等档位，不显示精确分数。</dd></div><div><dt>共享日程标题</dt><dd>在忙闲与精力档位之外，允许查看日程标题。</dd></div></dl></div></article></section>
  </div>;
}

export function AccountSettings({ user }: { user: User }) {
  const cache = useQueryClient();
  const [name, setName] = useState(user.displayName), [timezone, setTimezone] = useState(user.timezone), [validation, setValidation] = useState<Error | null>(null);
  function acceptUser(saved: User) {
    cache.setQueryData(queryKeys.auth.me, saved);
    const auth = useAuthStore.getState(); if (auth.accessToken && auth.user?.id === saved.id) auth.setSession(auth.accessToken, saved);
    void cache.invalidateQueries({ queryKey: queryKeys.energy.todayRoot });
    void cache.invalidateQueries({ queryKey: ["workspace"] });
  }
  const account = useMutation({ mutationFn: async (body: ApiComponents["UpdateMeRequest"]) => unwrap(await apiClient.PATCH("/api/v1/auth/me", { body })), onSuccess: saved => { acceptUser(saved); setName(saved.displayName); setTimezone(saved.timezone); } });
  const theme = useMutation({ mutationFn: async (themeMode: Theme) => unwrap(await apiClient.PATCH("/api/v1/auth/me", { body: { themeMode } satisfies ApiComponents["UpdateMeRequest"] })), onSuccess: acceptUser });
  const pending = account.isPending || theme.isPending;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setValidation(null);
    if (!name.trim()) { setValidation(new Error("请填写显示名称")); return; }
    try { new Intl.DateTimeFormat("zh-CN", { timeZone: timezone.trim() }).format(); } catch { setValidation(new Error("请填写有效的 IANA 时区，例如 Asia/Shanghai")); return; }
    account.mutate({ displayName: name.trim(), timezone: timezone.trim() });
  }
  return <><div className="settings-passport"><span className="settings-avatar">{user.displayName.slice(0, 1) || <UserRound size={25} />}</span><div><span className="settings-passport-eyebrow">个人账户通行证</span><h2>{user.displayName}</h2><p>{user.email}</p></div><span className="settings-passport-mark"><Fingerprint size={25} /></span></div><form onSubmit={submit} className="settings-account-form"><fieldset disabled={pending}><div className="form-grid"><label className="field">显示名称<input value={name} maxLength={64} required autoComplete="nickname" onChange={event => { setName(event.target.value); account.reset(); setValidation(null); }} /></label><label className="field">所在时区<input value={timezone} required list="settings-timezones" spellCheck={false} autoComplete="off" onChange={event => { setTimezone(event.target.value); account.reset(); setValidation(null); }} /><datalist id="settings-timezones">{["Asia/Shanghai", "Asia/Tokyo", "Asia/Singapore", "Europe/Paris", "Europe/London", "America/New_York", "America/Los_Angeles", "UTC"].map(zone => <option value={zone} key={zone} />)}</datalist></label></div></fieldset><p className="settings-field-note"><Globe2 size={13} />时间地图与精力曲线会按你的时区展示。</p><InlineError error={validation ?? account.error} /><div className="settings-account-actions"><span role="status" className="settings-save-state">{account.isSuccess ? <><Check size={14} />账户信息已保存</> : account.isPending ? "正在保存账户信息…" : ""}</span><Button type="submit" variant="secondary" pending={account.isPending} disabled={theme.isPending}>保存账户信息</Button></div></form><div className="settings-theme-section"><div className="settings-label-row"><div><h3>工作台外观</h3><p>选择主题后立即保存到账户。</p></div><span role="status" className="settings-save-state">{theme.isPending ? "正在保存主题…" : theme.isSuccess ? <><Check size={13} />外观主题已保存</> : ""}</span></div><div className="settings-theme-options" aria-label="外观主题">{themeOptions.map(({ value, label, icon: Icon }) => <Button key={value} variant="ghost" className="settings-theme-option" aria-pressed={user.themeMode === value} disabled={pending} onClick={() => { if (user.themeMode !== value) theme.mutate(value); }}><span className={`settings-theme-preview preview-${value}`}><i /><i /><i /></span><span><Icon size={14} />{label}{user.themeMode === value && <Check size={13} />}</span></Button>)}</div><InlineError error={theme.error} /></div></>;
}

type FocusDraft = { id: number; start: string; end: string };
function clockValue(minute: number) { return minuteLabel(minute === 1440 ? 0 : minute); }
function parseClock(value: string, endOfDay = false) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("请填写完整的工作或专注时间");
  const [hours, minutes] = value.split(":").map(Number), result = hours * 60 + minutes;
  return endOfDay && result === 0 ? 1440 : result;
}
export function RhythmSettings({ profile, timezone }: { profile: ApiComponents["EnergyProfileDTO"]; timezone: string }) {
  const cache = useQueryClient();
  const [start, setStart] = useState(clockValue(profile.workStartMinute)), [end, setEnd] = useState(clockValue(profile.workEndMinute)), [chronotype, setChronotype] = useState(profile.chronotype), [buffer, setBuffer] = useState(String(profile.minRecoveryBufferMin));
  const [windows, setWindows] = useState<FocusDraft[]>(() => profile.preferredFocusWindows.map((window, index) => ({ id: index, start: clockValue(window.startMinute), end: clockValue(window.endMinute) })));
  const nextWindowId = useRef(profile.preferredFocusWindows.length), [validation, setValidation] = useState<Error | null>(null);
  const save = useMutation({ mutationFn: async (body: ApiComponents["UpdateEnergyProfileRequest"]) => unwrap(await apiClient.PUT("/api/v1/energy/profile", { body })), onSuccess: saved => { cache.setQueryData(queryKeys.energy.profile, saved); void cache.invalidateQueries({ queryKey: queryKeys.energy.todayRoot }); void cache.invalidateQueries({ queryKey: ["workspace"] }); } });
  function changed() { save.reset(); setValidation(null); }
  function updateWindow(id: number, key: "start" | "end", value: string) { changed(); setWindows(current => current.map(window => window.id === id ? { ...window, [key]: value } : window)); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setValidation(null);
    try {
      const workStartMinute = parseClock(start), workEndMinute = parseClock(end, true), minRecoveryBufferMin = Number(buffer);
      if (workStartMinute >= workEndMinute) throw new Error("工作结束时间需晚于开始时间");
      if (!Number.isInteger(minRecoveryBufferMin) || minRecoveryBufferMin < 5 || minRecoveryBufferMin > 60) throw new Error("恢复缓冲需为 5 至 60 分钟的整数");
      const preferredFocusWindows: ApiComponents["DailyMinuteWindow"][] = windows.map((window, index) => { const startMinute = parseClock(window.start), endMinute = parseClock(window.end, true); if (startMinute >= endMinute) throw new Error(`专注窗口 ${index + 1} 的结束时间需晚于开始时间`); return { startMinute, endMinute }; });
      save.mutate({ workStartMinute, workEndMinute, chronotype, minRecoveryBufferMin, preferredFocusWindows });
    } catch (error) { setValidation(error instanceof Error ? error : new Error("请检查工作节律设置")); }
  }
  return <><div className="settings-section-heading"><span className="settings-section-icon"><Clock3 size={19} /></span><div><h2>个人工作节律</h2><p>为工作边界、专注保护和恢复缓冲提供依据。</p></div></div><form className="settings-rhythm-form" onSubmit={submit}><fieldset disabled={save.isPending} className="settings-rhythm-fields"><div className="settings-label-row"><h3>日常工作时间窗</h3><span><Globe2 size={12} />{timezone}</span></div><div className="form-grid"><DateTimeField label="工作开始" type="time" required value={start} onChange={value => { setStart(value); changed(); }} /><DateTimeField label="工作结束" type="time" required value={end} onChange={value => { setEnd(value); changed(); }} /></div><p className="settings-field-note">结束时间 00:00 表示当日结束；所有时间按本地时区解释。</p><div className="settings-chronotype"><h3>个人节律类型</h3><div role="radiogroup" aria-label="个人节律类型">{chronotypes.map(({ value, label, description, icon: Icon }) => <label key={value} className={chronotype === value ? "selected" : ""}><input type="radio" name="chronotype" value={value} checked={chronotype === value} onChange={() => { setChronotype(value); changed(); }} /><Icon size={19} /><strong>{label}</strong><small>{description}</small></label>)}</div></div><label className="field settings-buffer-field">最小恢复缓冲（分钟）<div><input aria-label="最小恢复缓冲（分钟）" type="number" min={5} max={60} step={1} required value={buffer} onChange={event => { setBuffer(event.target.value); changed(); }} /><span>分钟</span></div><small>救援方案会按此设置保留恢复时间，不会自动移动既有日程。</small></label><div className="settings-focus-windows"><div className="settings-label-row"><div><h3>首选专注窗口</h3><p>可留空，让服务端根据精力预测推荐。</p></div><Button variant="ghost" size="sm" onClick={() => { changed(); setWindows(current => [...current, { id: nextWindowId.current++, start: "", end: "" }]); }}><Plus size={14} />添加专注窗口</Button></div>{windows.length ? windows.map((window, index) => <div className="settings-focus-window" key={window.id}><span>{String(index + 1).padStart(2, "0")}</span><DateTimeField label={`专注窗口 ${index + 1} 开始`} type="time" required value={window.start} onChange={value => updateWindow(window.id, "start", value)} /><span>—</span><DateTimeField label={`专注窗口 ${index + 1} 结束`} type="time" required value={window.end} onChange={value => updateWindow(window.id, "end", value)} /><Button variant="ghost" size="icon" aria-label={`移除专注窗口 ${index + 1}`} onClick={() => { changed(); setWindows(current => current.filter(item => item.id !== window.id)); }}><Trash2 size={15} /></Button></div>) : <p className="settings-no-focus">尚未设置首选窗口，使用个体节律推荐。</p>}</div></fieldset><InlineError error={validation ?? save.error} /><div className="form-actions"><span role="status" className="settings-save-state">{save.isPending ? "正在保存工作节律…" : save.isSuccess ? <><Check size={14} />工作节律已保存</> : ""}</span><Button type="submit" variant="secondary" pending={save.isPending}>保存工作节律</Button></div></form></>;
}

export function WorkspacePrivacy({ workspace }: { workspace: ApiComponents["WorkspaceDTO"] }) {
  const cache = useQueryClient();
  const save = useMutation({ mutationFn: async (privacyLevel: ApiComponents["PrivacyLevel"]) => unwrap(await apiClient.PATCH("/api/v1/workspaces/{id}/me", { params: { path: { id: workspace.id } }, body: { privacyLevel } satisfies ApiComponents["UpdateWorkspaceMemberConfigRequest"] })), onSuccess: saved => { cache.setQueryData<ApiComponents["WorkspaceListResponse"]>(queryKeys.workspaces.all, current => current ? { ...current, workspaces: current.workspaces.map(item => item.id === workspace.id ? { ...item, myPrivacyLevel: saved.privacyLevel } : item) } : current); void cache.invalidateQueries({ queryKey: queryKeys.workspaces.members(workspace.id) }); void cache.invalidateQueries({ queryKey: queryKeys.workspaces.availabilityRoot(workspace.id) }); } });
  return <section className="settings-workspace"><div className="settings-workspace-heading"><span><Users size={17} /></span><div><h3>{workspace.name}</h3><p>{workspace.memberCount} 位成员 · {workspace.myRole === "owner" ? "创建者" : workspace.myRole === "admin" ? "管理员" : "成员"}</p></div></div><label className="field"><span className="sr-only">{workspace.name}的共享范围</span><select value={save.isPending ? save.variables : workspace.myPrivacyLevel} disabled={save.isPending} onChange={event => save.mutate(event.target.value as ApiComponents["PrivacyLevel"])}>{Object.entries(privacyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><span role="status" className="settings-save-state">{save.isPending ? "正在保存共享范围…" : save.isSuccess ? <><Check size={13} />共享范围已保存</> : "选择后立即保存，仅影响此团队"}</span><InlineError error={save.error} /></section>;
}
