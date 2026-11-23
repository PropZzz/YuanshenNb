import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Activity,
  Check,
  Clock3,
  Database,
  Fingerprint,
  Globe2,
  LockKeyhole,
  LogOut,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Sun,
  Sunrise,
  Trash2,
  UserRound,
  Users,
  Wifi,
  WifiOff,
} from "@/components/ui/reference-icons";
import { apiClient, type ApiComponents } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import { assertSuccess, unwrap } from "@/api/unwrap";
import { useRealtime } from "@/api/use-realtime";
import { Button } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/date-time-field";
import { EmptyState, ErrorState, InlineError, LoadingState, Notice } from "@/components/ui/states";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { minuteLabel } from "@/lib/datetime";
import { useAuthStore } from "@/stores/auth-store";
import { useEnergyProfile } from "@/features/energy/queries";
import { privacyLabels, useWorkspaces } from "@/features/team/queries";
import "./settings.css";

type User = ApiComponents["UserProfile"];
type Theme = ApiComponents["ThemeMode"];
type Chronotype = ApiComponents["Chronotype"];
type SettingsTab = "rhythm" | "privacy" | "account" | "diagnostics";

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

const chronotypes: {
  value: Chronotype;
  label: string;
  description: string;
  icon: typeof Sun;
  curve: string;
}[] = [
  {
    value: "morning_lark",
    label: "晨型",
    description: "更偏好上午的工作节律",
    icon: Sunrise,
    curve: "M 4 28 Q 22 4 42 18 T 76 30",
  },
  {
    value: "balanced",
    label: "均衡型",
    description: "兼顾上午与下午的专注",
    icon: Sun,
    curve: "M 4 28 Q 24 8 40 16 T 76 26",
  },
  {
    value: "night_owl",
    label: "夜猫型",
    description: "更偏好较晚的工作节律",
    icon: Moon,
    curve: "M 4 30 Q 30 26 48 12 T 76 14",
  },
];

function resolveTab(params: URLSearchParams): SettingsTab {
  const tab = params.get("tab") ?? params.get("panel");
  if (tab === "privacy" || tab === "account" || tab === "diagnostics" || tab === "rhythm") {
    return tab;
  }
  return "rhythm";
}

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const activeTab = resolveTab(params);

  const me = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: async () => unwrap(await apiClient.GET("/api/v1/auth/me")),
    staleTime: 60_000,
  });
  const profile = useEnergyProfile();
  const workspaces = useWorkspaces();

  const tabItems: TabItem<SettingsTab>[] = [
    { value: "rhythm", label: "个人节律与缓冲", icon: <Clock3 size={15} /> },
    {
      value: "privacy",
      label: "团队隐私与授权",
      icon: <ShieldCheck size={15} />,
      badge: workspaces.data?.workspaces.length,
    },
    { value: "account", label: "账户与外观", icon: <UserRound size={15} /> },
    { value: "diagnostics", label: "系统连接与诊断", icon: <Activity size={15} /> },
  ];

  function selectTab(next: SettingsTab) {
    setParams(
      curr => {
        curr.set("tab", next);
        curr.delete("panel");
        return curr;
      },
      { replace: true },
    );
  }

  return (
    <div className="settings-page">
      <header className="settings-hub-header">
        <div>
          <h1>设置与隐私控制中心</h1>
          <p>统一管理你的生物节律偏好、团队共享边界、工作台外观与服务端健康诊断。</p>
        </div>
        <Tabs items={tabItems} value={activeTab} onChange={selectTab} label="设置分类" />
      </header>

      {activeTab === "rhythm" && (
        <section className="surface-card settings-panel" role="tabpanel" aria-label="个人节律与缓冲">
          {profile.isPending ? (
            <LoadingState label="正在读取个人工作节律" />
          ) : profile.isError ? (
            <ErrorState error={profile.error} retry={() => void profile.refetch()} />
          ) : (
            <RhythmSettings
              key={profile.data.userId}
              profile={profile.data}
              timezone={me.data?.timezone ?? useAuthStore.getState().user?.timezone ?? "Asia/Shanghai"}
            />
          )}
        </section>
      )}

      {activeTab === "privacy" && (
        <section className="surface-card settings-panel" role="tabpanel" aria-label="团队隐私与授权">
          <div className="settings-section-heading">
            <span className="settings-section-icon">
              <Users size={19} />
            </span>
            <div>
              <h2>团队共享范围</h2>
              <p>为每一个团队选择适合的隐私颗粒度，并在下方实时模拟队友看到的视图。</p>
            </div>
          </div>

          {workspaces.isPending ? (
            <LoadingState label="正在读取团队共享设置" />
          ) : workspaces.isError ? (
            <ErrorState error={workspaces.error} retry={() => void workspaces.refetch()} />
          ) : workspaces.data.workspaces.length ? (
            <PrivacyHub workspaces={workspaces.data.workspaces} />
          ) : (
            <EmptyState
              icon={Users}
              title="还没有加入团队"
              description="加入或创建团队后，可以在这里分别管理每个团队的共享范围。"
              action="前往团队"
              to="/team"
            />
          )}
        </section>
      )}

      {activeTab === "account" && (
        <section className="surface-card settings-account-card" role="tabpanel" aria-label="账户与外观">
          {me.isPending ? (
            <LoadingState label="正在读取账户信息" />
          ) : me.isError ? (
            <ErrorState error={me.error} retry={() => void me.refetch()} />
          ) : (
            <AccountSettings key={me.data.id} user={me.data} />
          )}
        </section>
      )}

      {activeTab === "diagnostics" && (
        <section className="surface-card settings-panel" role="tabpanel" aria-label="系统连接与诊断">
          <DiagnosticsPanel />
        </section>
      )}
    </div>
  );
}

export function AccountSettings({ user }: { user: User }) {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(user.displayName);
  const [timezone, setTimezone] = useState(user.timezone);
  const [validation, setValidation] = useState<Error | null>(null);
  const [logoutError, setLogoutError] = useState<unknown>(null);

  function acceptUser(saved: User) {
    cache.setQueryData(queryKeys.auth.me, saved);
    const auth = useAuthStore.getState();
    if (auth.accessToken && auth.user?.id === saved.id) auth.setSession(auth.accessToken, saved);
    void cache.invalidateQueries({ queryKey: queryKeys.energy.todayRoot });
    void cache.invalidateQueries({ queryKey: ["workspace"] });
  }

  const account = useMutation({
    mutationFn: async (body: ApiComponents["UpdateMeRequest"]) =>
      unwrap(await apiClient.PATCH("/api/v1/auth/me", { body })),
    onSuccess: saved => {
      acceptUser(saved);
      setName(saved.displayName);
      setTimezone(saved.timezone);
      toast.push({ title: "账户信息已保存", tone: "success" });
    },
  });

  const theme = useMutation({
    mutationFn: async (themeMode: Theme) =>
      unwrap(
        await apiClient.PATCH("/api/v1/auth/me", {
          body: { themeMode } satisfies ApiComponents["UpdateMeRequest"],
        }),
      ),
    onSuccess: saved => {
      acceptUser(saved);
      toast.push({ title: "外观主题已切换", tone: "success" });
    },
  });

  const logout = useMutation({
    mutationFn: async () => {
      assertSuccess(await apiClient.POST("/api/v1/auth/logout", { body: {} }));
    },
    onSuccess: () => {
      useAuthStore.getState().clearSession();
      cache.clear();
      navigate("/login", { replace: true });
    },
    onError: error => setLogoutError(error),
  });

  const pending = account.isPending || theme.isPending || logout.isPending;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidation(null);
    if (!name.trim()) {
      setValidation(new Error("请填写显示名称"));
      return;
    }
    try {
      new Intl.DateTimeFormat("zh-CN", { timeZone: timezone.trim() }).format();
    } catch {
      setValidation(new Error("请填写有效的 IANA 时区，例如 Asia/Shanghai"));
      return;
    }
    account.mutate({ displayName: name.trim(), timezone: timezone.trim() });
  }

  return (
    <>
      <div className="settings-passport">
        <span className="settings-avatar">
          {user.displayName.slice(0, 1) || <UserRound size={25} />}
        </span>
        <div>
          <span className="settings-passport-eyebrow">个人账户通行证</span>
          <h2>{user.displayName}</h2>
          <p>{user.email}</p>
        </div>
        <span className="settings-passport-mark">
          <Fingerprint size={25} />
        </span>
      </div>

      <form onSubmit={submit} className="settings-account-form">
        <fieldset disabled={pending}>
          <div className="form-grid">
            <label className="field">
              显示名称
              <input
                value={name}
                maxLength={64}
                required
                autoComplete="nickname"
                onChange={event => {
                  setName(event.target.value);
                  account.reset();
                  setValidation(null);
                }}
              />
            </label>
            <label className="field">
              所在时区
              <input
                value={timezone}
                required
                list="settings-timezones"
                spellCheck={false}
                autoComplete="off"
                onChange={event => {
                  setTimezone(event.target.value);
                  account.reset();
                  setValidation(null);
                }}
              />
              <datalist id="settings-timezones">
                {[
                  "Asia/Shanghai",
                  "Asia/Tokyo",
                  "Asia/Singapore",
                  "Europe/Paris",
                  "Europe/London",
                  "America/New_York",
                  "America/Los_Angeles",
                  "UTC",
                ].map(zone => (
                  <option value={zone} key={zone} />
                ))}
              </datalist>
            </label>
          </div>
        </fieldset>
        <p className="settings-field-note">
          <Globe2 size={13} />
          时间地图与精力曲线会按你的时区展示。
        </p>
        <InlineError error={validation ?? account.error} />
        <div className="settings-account-actions">
          <span role="status" className="settings-save-state">
            {account.isSuccess ? (
              <>
                <Check size={14} />
                账户信息已保存
              </>
            ) : account.isPending ? (
              "正在保存账户信息…"
            ) : (
              ""
            )}
          </span>
          <Button
            type="submit"
            variant="secondary"
            pending={account.isPending}
            disabled={theme.isPending}
          >
            保存账户信息
          </Button>
        </div>
      </form>

      <div className="settings-theme-section">
        <div className="settings-label-row">
          <div>
            <h3>工作台外观</h3>
            <p>选择主题后立即保存到账户。</p>
          </div>
          <span role="status" className="settings-save-state">
            {theme.isPending ? (
              "正在保存主题…"
            ) : theme.isSuccess ? (
              <>
                <Check size={13} />
                外观主题已保存
              </>
            ) : (
              ""
            )}
          </span>
        </div>

        <div className="settings-theme-options" aria-label="外观主题">
          {themeOptions.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant="ghost"
              className="settings-theme-option"
              aria-pressed={user.themeMode === value}
              disabled={pending}
              onClick={() => {
                if (user.themeMode !== value) theme.mutate(value);
              }}
            >
              <span className={`settings-theme-preview preview-${value}`}>
                <i />
                <i />
                <i />
              </span>
              <span>
                <Icon size={14} />
                {label}
                {user.themeMode === value && <Check size={13} />}
              </span>
            </Button>
          ))}
        </div>
        <InlineError error={theme.error} />

        <div className="settings-logout-row">
          <div>
            <strong>当前会话控制</strong>
            <p>退出当前登录账户，清除本机缓存与认证令牌。</p>
          </div>
          <Button
            type="button"
            variant="outline"
            pending={logout.isPending}
            disabled={pending}
            onClick={() => {
              setLogoutError(null);
              logout.mutate();
            }}
          >
            <LogOut size={14} />
            退出登录
          </Button>
        </div>
        <InlineError error={logoutError} />
      </div>
    </>
  );
}

type FocusDraft = { id: number; start: string; end: string };

function clockValue(minute: number) {
  return minuteLabel(minute === 1440 ? 0 : minute);
}

function parseClockSafe(value: string, endOfDay = false): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  const result = hours * 60 + minutes;
  return endOfDay && result === 0 ? 1440 : result;
}

function parseClock(value: string, endOfDay = false) {
  const result = parseClockSafe(value, endOfDay);
  if (result === null) throw new Error("请填写完整的工作或专注时间");
  return result;
}

export function RhythmSettings({
  profile,
  timezone,
}: {
  profile: ApiComponents["EnergyProfileDTO"];
  timezone: string;
}) {
  const cache = useQueryClient();
  const toast = useToast();
  const [start, setStart] = useState(clockValue(profile.workStartMinute));
  const [end, setEnd] = useState(clockValue(profile.workEndMinute));
  const [chronotype, setChronotype] = useState(profile.chronotype);
  const [buffer, setBuffer] = useState(String(profile.minRecoveryBufferMin));
  const [windows, setWindows] = useState<FocusDraft[]>(() =>
    profile.preferredFocusWindows.map((window, index) => ({
      id: index,
      start: clockValue(window.startMinute),
      end: clockValue(window.endMinute),
    })),
  );
  const nextWindowId = useRef(profile.preferredFocusWindows.length);
  const [validation, setValidation] = useState<Error | null>(null);

  const save = useMutation({
    mutationFn: async (body: ApiComponents["UpdateEnergyProfileRequest"]) =>
      unwrap(await apiClient.PUT("/api/v1/energy/profile", { body })),
    onSuccess: saved => {
      cache.setQueryData(queryKeys.energy.profile, saved);
      void cache.invalidateQueries({ queryKey: queryKeys.energy.todayRoot });
      void cache.invalidateQueries({ queryKey: ["workspace"] });
      toast.push({ title: "工作节律已保存", tone: "success" });
    },
  });

  function changed() {
    save.reset();
    setValidation(null);
  }

  function updateWindow(id: number, key: "start" | "end", value: string) {
    changed();
    setWindows(current =>
      current.map(window => (window.id === id ? { ...window, [key]: value } : window)),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidation(null);
    try {
      const workStartMinute = parseClock(start);
      const workEndMinute = parseClock(end, true);
      const minRecoveryBufferMin = Number(buffer);
      if (workStartMinute >= workEndMinute) throw new Error("工作结束时间需晚于开始时间");
      if (
        !Number.isInteger(minRecoveryBufferMin) ||
        minRecoveryBufferMin < 5 ||
        minRecoveryBufferMin > 60
      ) {
        throw new Error("恢复缓冲需为 5 至 60 分钟的整数");
      }
      const preferredFocusWindows: ApiComponents["DailyMinuteWindow"][] = windows.map(
        (window, index) => {
          const startMinute = parseClock(window.start);
          const endMinute = parseClock(window.end, true);
          if (startMinute >= endMinute) {
            throw new Error(`专注窗口 ${index + 1} 的结束时间需晚于开始时间`);
          }
          return { startMinute, endMinute };
        },
      );
      save.mutate({
        workStartMinute,
        workEndMinute,
        chronotype,
        minRecoveryBufferMin,
        preferredFocusWindows,
      });
    } catch (error) {
      setValidation(error instanceof Error ? error : new Error("请检查工作节律设置"));
    }
  }

  const previewWorkStart = parseClockSafe(start) ?? profile.workStartMinute;
  const previewWorkEnd = parseClockSafe(end, true) ?? profile.workEndMinute;
  const validWork = previewWorkEnd > previewWorkStart;
  const previewWindows = windows
    .map((w, idx) => ({
      id: w.id,
      index: idx + 1,
      s: parseClockSafe(w.start),
      e: parseClockSafe(w.end, true),
    }))
    .filter((w): w is { id: number; index: number; s: number; e: number } =>
      w.s !== null && w.e !== null && w.e > w.s,
    );

  return (
    <>
      <div className="settings-section-heading">
        <span className="settings-section-icon">
          <Clock3 size={19} />
        </span>
        <div>
          <h2>个人工作节律与恢复缓冲</h2>
          <p>为工作边界、专注保护和恢复缓冲提供依据，下方 24 小时节律带随编辑实时更新。</p>
        </div>
      </div>

      {/* Live 24-Hour Visual Rhythm Bar */}
      <div className="settings-rhythm-preview" data-rhythm-preview aria-label="24小时节律实时预览">
        <div className="settings-rhythm-preview-head">
          <strong>24 小时工作与专注护盾分布预览</strong>
          <span>
            工作时段：{start || "--:--"}–{end || "--:--"} · 专注窗口 {previewWindows.length} 段
          </span>
        </div>
        <div className="settings-rhythm-bar">
          {validWork && (
            <div
              className="settings-rhythm-work"
              data-work-band
              title={`工作时间窗 ${minuteLabel(previewWorkStart)}–${minuteLabel(previewWorkEnd)}`}
              style={{
                left: `${(previewWorkStart / 1440) * 100}%`,
                width: `${((previewWorkEnd - previewWorkStart) / 1440) * 100}%`,
              }}
            />
          )}
          {previewWindows.map(w => (
            <div
              key={w.id}
              className="settings-rhythm-focus"
              data-focus-band
              title={`首选专注窗口 ${w.index} (${minuteLabel(w.s)}–${minuteLabel(w.e)})`}
              style={{
                left: `${(w.s / 1440) * 100}%`,
                width: `${((w.e - w.s) / 1440) * 100}%`,
              }}
            >
              <span>专注 {w.index}</span>
            </div>
          ))}
        </div>
        <div className="settings-rhythm-ticks">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>
      </div>

      <form className="settings-rhythm-form" onSubmit={submit}>
        <fieldset disabled={save.isPending} className="settings-rhythm-fields">
          <div className="settings-label-row">
            <h3>日常工作时间窗</h3>
            <span>
              <Globe2 size={12} />
              {timezone}
            </span>
          </div>

          <div className="form-grid">
            <DateTimeField
              label="工作开始"
              type="time"
              required
              value={start}
              onChange={value => {
                setStart(value);
                changed();
              }}
            />
            <DateTimeField
              label="工作结束"
              type="time"
              required
              value={end}
              onChange={value => {
                setEnd(value);
                changed();
              }}
            />
          </div>
          <p className="settings-field-note">结束时间 00:00 表示当日结束；所有时间按本地时区解释。</p>

          <div className="settings-chronotype">
            <h3>个人节律类型</h3>
            <div role="radiogroup" aria-label="个人节律类型">
              {chronotypes.map(({ value, label, description, icon: Icon, curve }) => (
                <label key={value} className={chronotype === value ? "selected" : ""}>
                  <input
                    type="radio"
                    name="chronotype"
                    value={value}
                    checked={chronotype === value}
                    onChange={() => {
                      setChronotype(value);
                      changed();
                    }}
                  />
                  <Icon size={18} />
                  <svg className="settings-chronotype-curve" viewBox="0 0 80 34" aria-hidden="true">
                    <path d={curve} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </label>
              ))}
            </div>
          </div>

          <label className="field settings-buffer-field">
            最小恢复缓冲（分钟）
            <div className="settings-buffer-controls">
              <input
                aria-label="最小恢复缓冲（分钟）"
                type="number"
                min={5}
                max={60}
                step={1}
                required
                value={buffer}
                onChange={event => {
                  setBuffer(event.target.value);
                  changed();
                }}
              />
              <input
                type="range"
                aria-label="恢复缓冲滑块"
                min={5}
                max={60}
                step={5}
                value={Math.max(5, Math.min(60, Number(buffer) || 15))}
                onChange={event => {
                  setBuffer(event.target.value);
                  changed();
                }}
              />
              <span>分钟</span>
            </div>
            <small>救援方案会按此设置保留恢复时间，不会自动移动既有日程。</small>
          </label>

          <div className="settings-focus-windows">
            <div className="settings-label-row">
              <div>
                <h3>首选专注窗口</h3>
                <p>可留空，让服务端根据精力预测推荐。</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  changed();
                  setWindows(current => [
                    ...current,
                    { id: nextWindowId.current++, start: "", end: "" },
                  ]);
                }}
              >
                <Plus size={14} />
                添加专注窗口
              </Button>
            </div>

            {windows.length ? (
              windows.map((window, index) => (
                <div className="settings-focus-window" key={window.id}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <DateTimeField
                    label={`专注窗口 ${index + 1} 开始`}
                    type="time"
                    required
                    value={window.start}
                    onChange={value => updateWindow(window.id, "start", value)}
                  />
                  <span>—</span>
                  <DateTimeField
                    label={`专注窗口 ${index + 1} 结束`}
                    type="time"
                    required
                    value={window.end}
                    onChange={value => updateWindow(window.id, "end", value)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`移除专注窗口 ${index + 1}`}
                    onClick={() => {
                      changed();
                      setWindows(current => current.filter(item => item.id !== window.id));
                    }}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              ))
            ) : (
              <p className="settings-no-focus">尚未设置首选窗口，使用个体节律推荐。</p>
            )}
          </div>
        </fieldset>

        <InlineError error={validation ?? save.error} />
        <div className="form-actions">
          <span role="status" className="settings-save-state">
            {save.isPending ? (
              "正在保存工作节律…"
            ) : save.isSuccess ? (
              <>
                <Check size={14} />
                工作节律已保存
              </>
            ) : (
              ""
            )}
          </span>
          <Button type="submit" variant="secondary" pending={save.isPending}>
            保存工作节律
          </Button>
        </div>
      </form>
    </>
  );
}

function PrivacyHub({ workspaces }: { workspaces: ApiComponents["WorkspaceDTO"][] }) {
  const [selectedId, setSelectedId] = useState(workspaces[0]?.id ?? "");
  const active = workspaces.find(w => w.id === selectedId) ?? workspaces[0];
  const level = active?.myPrivacyLevel ?? "busy_only";

  return (
    <div className="settings-privacy-grid">
      <div className="settings-workspace-list">
        {workspaces.map(workspace => (
          <WorkspacePrivacy
            key={workspace.id}
            workspace={workspace}
            selected={workspace.id === active?.id}
            onInspect={() => setSelectedId(workspace.id)}
          />
        ))}
      </div>

      {/* Live Teammate View Simulator Card */}
      <aside className="settings-privacy-simulator" aria-label="队友视角实时预览">
        <div className="simulator-head">
          <LockKeyhole size={16} />
          <div>
            <h3>队友视角实时预览</h3>
            <p>
              当前模拟：{active?.name} · <b>{privacyLabels[level]}</b>
            </p>
          </div>
        </div>

        <div className="simulator-timeline">
          <div className="simulator-member-row">
            <span>你的时间轴投影</span>
            <div className="simulator-track">
              {level !== "busy_only" && (
                <div className="simulator-energy-strip" data-sim-energy>
                  精力档位：精力峰值
                </div>
              )}
              <div className="simulator-slot">
                <strong>{level === "full_title" ? "架构方案深度评审" : "忙碌"}</strong>
                <time>10:00–11:30</time>
              </div>
            </div>
          </div>
        </div>

        <div className="simulator-redacted-box">
          <ShieldCheck size={15} />
          <span>原始心率、HRV、睡眠阶段与精确精力分数在三个等级下均永不共享。</span>
        </div>

        <div className="settings-privacy-legend">
          <dl>
            <div>
              <dt>仅忙闲</dt>
              <dd>只显示占用状态，不显示精力档位与标题。</dd>
            </div>
            <div>
              <dt>忙闲与精力等级</dt>
              <dd>增加高峰、平稳等档位，不显示精确分数。</dd>
            </div>
            <div>
              <dt>共享日程标题</dt>
              <dd>在忙闲与精力档位之外，允许查看日程标题。</dd>
            </div>
          </dl>
        </div>
      </aside>
    </div>
  );
}

export function WorkspacePrivacy({
  workspace,
  selected,
  onInspect,
}: {
  workspace: ApiComponents["WorkspaceDTO"];
  selected?: boolean;
  onInspect?: () => void;
}) {
  const cache = useQueryClient();
  const toast = useToast();

  const save = useMutation({
    mutationFn: async (privacyLevel: ApiComponents["PrivacyLevel"]) =>
      unwrap(
        await apiClient.PATCH("/api/v1/workspaces/{id}/me", {
          params: { path: { id: workspace.id } },
          body: { privacyLevel } satisfies ApiComponents["UpdateWorkspaceMemberConfigRequest"],
        }),
      ),
    onSuccess: saved => {
      cache.setQueryData<ApiComponents["WorkspaceListResponse"]>(
        queryKeys.workspaces.all,
        current =>
          current
            ? {
                ...current,
                workspaces: current.workspaces.map(item =>
                  item.id === workspace.id ? { ...item, myPrivacyLevel: saved.privacyLevel } : item,
                ),
              }
            : current,
      );
      void cache.invalidateQueries({ queryKey: queryKeys.workspaces.members(workspace.id) });
      void cache.invalidateQueries({
        queryKey: queryKeys.workspaces.availabilityRoot(workspace.id),
      });
      toast.push({ title: `已更新「${workspace.name}」共享范围`, tone: "success" });
    },
  });

  return (
    <section
      className={`settings-workspace ${selected ? "is-selected" : ""}`}
      onClick={onInspect}
    >
      <div className="settings-workspace-heading">
        <span>
          <Users size={17} />
        </span>
        <div>
          <h3>{workspace.name}</h3>
          <p>
            {workspace.memberCount} 位成员 ·{" "}
            {workspace.myRole === "owner" ? "创建者" : workspace.myRole === "admin" ? "管理员" : "成员"}
          </p>
        </div>
      </div>

      <label className="field">
        <span className="sr-only">{workspace.name}的共享范围</span>
        <select
          value={save.isPending ? save.variables : workspace.myPrivacyLevel}
          disabled={save.isPending}
          onChange={event => {
            onInspect?.();
            save.mutate(event.target.value as ApiComponents["PrivacyLevel"]);
          }}
        >
          {Object.entries(privacyLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <span role="status" className="settings-save-state">
        {save.isPending ? (
          "正在保存共享范围…"
        ) : save.isSuccess ? (
          <>
            <Check size={13} />
            共享范围已保存
          </>
        ) : (
          "选择后立即保存，仅影响此团队"
        )}
      </span>
      <InlineError error={save.error} />
    </section>
  );
}

function DiagnosticsPanel() {
  const realtime = useRealtime();
  const events = realtime.events ?? [];

  const health = useQuery({
    queryKey: ["system", "health"],
    queryFn: async () => {
      const started = performance.now();
      const data = unwrap(await apiClient.GET("/api/v1/health"));
      const latencyMs = Math.max(1, Math.round(performance.now() - started));
      return { data, latencyMs };
    },
    retry: false,
  });

  return (
    <div className="settings-diagnostics">
      <div className="settings-section-heading">
        <span className="settings-section-icon">
          <Server size={19} />
        </span>
        <div className="flex-1">
          <h2>系统连接与服务端健康诊断</h2>
          <p>实时探测后端 `/api/v1/health` 可达性、数据库状态与 WebSocket 实时订阅通道。</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          pending={health.isFetching}
          onClick={() => void health.refetch()}
        >
          <RefreshCw size={14} />
          重新检测连接
        </Button>
      </div>

      {health.isPending ? (
        <LoadingState label="正在探测服务端健康状态" />
      ) : health.isError ? (
        <ErrorState error={health.error} retry={() => void health.refetch()} />
      ) : (
        <div className="diagnostics-grid">
          <article className="diagnostics-card">
            <div className="diagnostics-card-head">
              <Server size={16} />
              <strong>HTTP 服务状态</strong>
              <span className={`badge ${health.data.data.ok ? "badge-success" : "badge-warn"}`}>
                {health.data.data.ok ? "在线正常" : "异常降级"}
              </span>
            </div>
            <dl>
              <div>
                <dt>往返延迟</dt>
                <dd>{health.data.latencyMs} ms</dd>
              </div>
              <div>
                <dt>服务版本</dt>
                <dd>{health.data.data.version}</dd>
              </div>
              <div>
                <dt>服务端时间</dt>
                <dd>{health.data.data.serverTime}</dd>
              </div>
            </dl>
          </article>

          <article className="diagnostics-card">
            <div className="diagnostics-card-head">
              <Database size={16} />
              <strong>数据库与实时通道</strong>
              <span
                className={`badge ${
                  health.data.data.dbStatus === "up" ? "badge-success" : "badge-warn"
                }`}
              >
                DB: {health.data.data.dbStatus}
              </span>
            </div>
            <dl>
              <div>
                <dt>WebSocket 状态</dt>
                <dd className="inline-flex items-center gap-1.5">
                  {realtime.state === "connected" ? <Wifi size={14} /> : <WifiOff size={14} />}
                  {realtime.state === "connected"
                    ? "已连接"
                    : realtime.state === "connecting"
                      ? "连接中"
                      : "已断开"}
                </dd>
              </div>
              <div>
                <dt>本会话实时事件</dt>
                <dd>{events.length} 条推送记录</dd>
              </div>
            </dl>
          </article>
        </div>
      )}

      <Notice>
        这里展示的所有状态均来自真实 API 与当前浏览器的 WebSocket 连接，不包含虚构的本地日志。
      </Notice>
    </div>
  );
}
