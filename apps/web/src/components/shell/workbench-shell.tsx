import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { apiClient, type ApiComponents } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import { unwrap } from "@/api/unwrap";
import { useRealtime } from "@/api/use-realtime";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/ui/command-palette";
import { Popover } from "@/components/ui/popover";
import {
  ArrowRight,
  BatteryCharging,
  Bell,
  CalendarDays,
  Check,
  Command,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Timer,
  Users,
  X,
  Zap,
} from "@/components/ui/reference-icons";
import { useToast } from "@/components/ui/toast";
import { freshnessLabels, tierLabels, useEnergy } from "@/features/energy/queries";
import { useWorkspaces } from "@/features/team/queries";
import { localDate, localTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { useAuthStore, type ThemeMode } from "@/stores/auth-store";
import { useRouteMotion } from "./use-route-motion";

const navItems = [
  { to: "/focus", label: "今日专注", icon: Timer },
  { to: "/calendar", label: "时间地图", icon: CalendarDays },
  { to: "/team", label: "团队排会", icon: Users },
  { to: "/energy", label: "精力洞察", icon: Zap },
  { to: "/settings", label: "节律与隐私", icon: SlidersHorizontal },
] as const;

const mobileNavLabels: Record<string, string> = {
  "/focus": "专注",
  "/calendar": "日历",
  "/team": "团队",
  "/energy": "精力",
  "/settings": "设置",
};

const SIDEBAR_STORAGE_KEY = "shixu:sidebar-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const user = useAuthStore(state => state.user);
  const themeMode = useAuthStore(state => state.themeMode);
  const timezone = user?.timezone ?? "Asia/Shanghai";
  const today = localDate(new Date(), timezone);

  const location = useLocation();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const toast = useToast();
  const realtime = useRealtime();

  const main = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);
  const { surfaceRef, go } = useRouteMotion();

  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [commandOpen, setCommandOpen] = useState(false);

  const health = useQuery({
    queryKey: ["system", "health"],
    queryFn: async () => unwrap(await apiClient.GET("/api/v1/health")),
    retry: 1,
    staleTime: 30_000,
  });

  const energy = useEnergy(today);
  const workspaces = useWorkspaces();
  const workspaceList = Array.isArray(workspaces.data?.workspaces) ? workspaces.data.workspaces : [];

  const meetingQueries = useQueries({
    queries: workspaceList.map(workspace => ({
      queryKey: queryKeys.workspaces.meetings(workspace.id),
      queryFn: async () =>
        unwrap(
          await apiClient.GET("/api/v1/workspaces/{id}/meetings", {
            params: { path: { id: workspace.id } },
          }),
        ),
      staleTime: 30_000,
    })),
  });

  const pendingInvitations = useMemo(() => {
    if (!user?.id) return [];
    const items: Array<{
      workspaceId: string;
      workspaceName: string;
      meeting: ApiComponents["MeetingProposalDTO"];
    }> = [];
    workspaceList.forEach((workspace, index) => {
      const meetings = meetingQueries[index]?.data?.meetings ?? [];
      for (const meeting of meetings) {
        if (meeting.status === "cancelled") continue;
        const mine = meeting.participants.find(p => p.userId === user.id);
        if (mine?.responseStatus === "pending") {
          items.push({ workspaceId: workspace.id, workspaceName: workspace.name, meeting });
        }
      }
    });
    return items;
  }, [meetingQueries, user?.id, workspaceList]);

  const respondMutation = useMutation({
    mutationFn: async ({
      workspaceId,
      proposalId,
      status,
    }: {
      workspaceId: string;
      proposalId: string;
      status: "accepted" | "declined";
    }) =>
      unwrap(
        await apiClient.POST("/api/v1/workspaces/{id}/meetings/{proposalId}/respond", {
          params: { path: { id: workspaceId, proposalId } },
          body: { responseStatus: status },
        }),
      ),
    onSuccess: async (_, variables) => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: queryKeys.workspaces.meetings(variables.workspaceId) }),
        cache.invalidateQueries({ queryKey: queryKeys.workspaces.availabilityRoot(variables.workspaceId) }),
        cache.invalidateQueries({ queryKey: queryKeys.schedule.itemsRoot }),
        cache.invalidateQueries({ queryKey: queryKeys.energy.todayRoot }),
      ]);
      toast.push({
        tone: "success",
        title: variables.status === "accepted" ? "已接受会议邀请" : "已拒绝会议邀请",
        description: variables.status === "declined" ? "个人时间地图中的对应占用已释放。" : "已同步更新团队参会状态。",
      });
    },
  });

  const themeMutation = useMutation({
    mutationFn: async (next: ThemeMode) =>
      unwrap(await apiClient.PATCH("/api/v1/auth/me", { body: { themeMode: next } })),
    onSuccess: updated => {
      const auth = useAuthStore.getState();
      if (auth.accessToken && auth.user?.id === updated.id) {
        auth.setSession(auth.accessToken, updated);
      }
      cache.setQueryData(queryKeys.auth.me, updated);
    },
  });

  function cycleTheme(next?: ThemeMode) {
    const target: ThemeMode =
      next ?? (themeMode === "light" ? "dark" : themeMode === "dark" ? "system" : "light");
    useAuthStore.getState().setThemeMode(target);
    if (user) {
      themeMutation.mutate(target);
    }
  }

  function toggleSidebar() {
    setCollapsed(current => {
      const next = !current;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage unavailability
      }
      return next;
    });
  }

  function followLink(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return;
    }
    const link = (event.target as HTMLElement).closest("a");
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const url = new URL(link.href);
    if (url.origin !== window.location.origin || link.getAttribute("href")?.startsWith("#")) return;
    event.preventDefault();
    go(url.pathname + url.search + url.hash);
  }

  useEffect(() => {
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    window.scrollTo(0, 0);
    if (!document.querySelector('[role="dialog"]')) {
      main.current?.focus({ preventScroll: true });
    }
  }, [location.pathname]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && key === "k") {
        event.preventDefault();
        setCommandOpen(open => !open);
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (event.altKey && !event.ctrlKey && !event.metaKey && key === "s") {
        event.preventDefault();
        go("/calendar?rescue=1");
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [go]);

  const activeNav = navItems.find(item => item.to === location.pathname);
  const pageTitle = activeNav?.label ?? "时间工作台";
  const events = realtime.events ?? [];
  const unreadCount = (realtime.unreadCount ?? 0) + pendingInvitations.length;

  const energyData = typeof energy.data?.score === "number" ? energy.data : undefined;
  const energyTier = energyData?.tier;
  const nextShield = energyData?.focusShields?.[0];

  const ThemeIcon = themeMode === "dark" ? Moon : themeMode === "light" ? Sun : Monitor;

  return (
    <div
      className={cn("workbench-shell", collapsed && "is-sidebar-collapsed")}
      onClickCapture={followLink}
    >
      <a href="#main-content" className="skip-link">
        跳到主要内容
      </a>

      <aside className="workbench-sidebar" aria-label="工作台侧栏">
        <div className="sidebar-brand-row">
          <Link to="/focus" className="sidebar-brand">
            <img src="/brand-logo.png" alt="时序智配标志" />
            {!collapsed && (
              <div>
                <strong>时序智配</strong>
                <span>Temporal Scheduler</span>
              </div>
            )}
          </Link>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={toggleSidebar}
            aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
            title={collapsed ? "展开侧栏" : "折叠侧栏"}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>

        <nav className="sidebar-navigation" aria-label="主导航">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={({ isActive }) => cn("sidebar-link", isActive && "active")}
            >
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <Link to="/energy" className="sidebar-wearable-card" title="查看穿戴精力洞察">
            <span className={cn("wearable-dot", energyData && `tier-${energyData.tier}`)} />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <strong>{energyData ? freshnessLabels[energyData.dataFreshness] : "等待精力状态"}</strong>
                <span>
                  {energyData?.diagnostics.lastSyncedAt
                    ? `同步于 ${localTime(energyData.diagnostics.lastSyncedAt, timezone)}`
                    : "点击查看生理节律"}
                </span>
              </div>
            )}
          </Link>

          <div className="sidebar-account-card">
            <Link to="/settings?tab=account" className="account-identity" title={user?.displayName ?? "账户设置"}>
              <span className="avatar">{user?.displayName?.slice(0, 1) ?? "时"}</span>
              {!collapsed && (
                <div className="min-w-0">
                  <strong>{user?.displayName ?? "未登录"}</strong>
                  <small>{timezone}</small>
                </div>
              )}
            </Link>
            {!collapsed && (
              <button
                type="button"
                className="sidebar-theme-btn"
                onClick={() => cycleTheme()}
                aria-label="切换浅深色主题"
                title={`当前：${themeMode === "dark" ? "深色" : themeMode === "light" ? "浅色" : "跟随系统"}（点击切换）`}
              >
                <ThemeIcon size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>

      <div className="workbench-main">
        <header className="workbench-topbar">
          <div className="topbar-breadcrumb">
            <span className="mobile-wordmark">时序智配</span>
            <div className="desktop-breadcrumb">
              <span>时序智配</span>
              <span className="breadcrumb-sep">/</span>
              <strong>{pageTitle}</strong>
            </div>
            <span
              role="status"
              className={cn("connection-pill", health.isError && "is-error")}
              title={realtime.state === "connected" ? "WebSocket 实时通道已连接" : "正在同步连接状态"}
            >
              <span
                className={cn(
                  "status-dot",
                  health.isError
                    ? "bg-error"
                    : realtime.state === "connected"
                      ? "bg-energy-peak"
                      : "bg-energy-strained",
                )}
              />
              <span>
                {health.isPending
                  ? "连接中"
                  : health.isError
                    ? "服务不可用"
                    : realtime.state === "connected"
                      ? "实时同步"
                      : "重连中"}
              </span>
            </span>
          </div>

          <div className="topbar-actions">
            <Popover
              label="实时精力状态"
              trigger={({ toggle, ...aria }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className={cn("topbar-energy-pill", energyTier && `tier-${energyTier}`)}
                  {...aria}
                >
                  <BatteryCharging size={15} aria-hidden="true" />
                  <strong className="tabular-nums">{energyData ? `${energyData.score} 分` : "精力 —"}</strong>
                  <span className="hidden sm:inline">
                    {energyData ? tierLabels[energyData.tier] : "读取中"}
                  </span>
                </button>
              )}
              panelClassName="w-80"
            >
              {close => (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-outline">今日认知电量</p>
                      <p className="font-headline text-2xl font-bold text-primary tabular-nums">
                        {energyData ? `${energyData.score} / 100` : "暂无数据"}
                      </p>
                    </div>
                    {energyData && (
                      <span className="badge badge-info">{freshnessLabels[energyData.dataFreshness]}</span>
                    )}
                  </div>
                  {energyData ? (
                    <>
                      <p className="text-xs leading-relaxed text-on-surface-variant">
                        {energyData.drivers?.summary}
                      </p>
                      {nextShield && (
                        <div className="rounded-xl bg-energy-peak-bg px-3 py-2 text-xs text-energy-peak">
                          <strong>下一段专注保护窗</strong>
                          <p className="mt-0.5 tabular-nums">
                            {localTime(nextShield.startAt, timezone)} – {localTime(nextShield.endAt, timezone)} · 均值{" "}
                            {nextShield.avgScore}
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-on-surface-variant">尚未获取到今日精力数据，可在精力洞察页查看诊断。</p>
                  )}
                  <div className="flex items-center justify-between border-t border-outline-variant/30 pt-2.5">
                    <Link
                      to="/energy"
                      onClick={close}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-secondary hover:underline"
                    >
                      查看 24h 节律与归因 <ArrowRight size={13} />
                    </Link>
                    <Link
                      to="/energy?replay=1"
                      onClick={close}
                      className="text-xs text-on-surface-variant hover:text-primary"
                    >
                      回放演练
                    </Link>
                  </div>
                </div>
              )}
            </Popover>

            <button
              type="button"
              className="topbar-cmd-btn"
              onClick={() => setCommandOpen(true)}
              aria-label="打开命令面板"
              title="命令面板 (Ctrl+K / ⌘K)"
            >
              <Command size={14} aria-hidden="true" />
              <span className="hidden lg:inline">命令</span>
              <kbd className="hidden xl:inline">⌘K</kbd>
            </button>

            <Popover
              label="实时通知中心"
              onOpenChange={open => {
                if (open) realtime.markAllRead?.();
              }}
              trigger={({ toggle, ...aria }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className="topbar-bell-btn"
                  aria-label="通知中心"
                  {...aria}
                >
                  <Bell size={17} aria-hidden="true" />
                  {unreadCount > 0 && (
                    <span className="topbar-bell-badge tabular-nums">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>
              )}
              panelClassName="w-[340px] max-w-[calc(100vw-24px)]"
            >
              {close => (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <strong className="text-sm font-bold text-primary">实时协同与提醒</strong>
                    {events.length > 0 && (
                      <button
                        type="button"
                        onClick={() => realtime.clearFeed?.()}
                        className="text-xs text-outline hover:text-on-surface"
                      >
                        清空记录
                      </button>
                    )}
                  </div>

                  {pendingInvitations.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
                        待回复会议邀请 ({pendingInvitations.length})
                      </p>
                      {pendingInvitations.map(({ workspaceId, workspaceName, meeting }) => (
                        <div
                          key={meeting.id}
                          className="rounded-xl border border-secondary/25 bg-surface-container-low p-2.5 text-xs"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <strong className="text-[13px] text-on-surface">{meeting.title}</strong>
                              <p className="text-on-surface-variant">
                                {workspaceName}
                                {meeting.confirmedStartAt &&
                                  ` · ${localTime(meeting.confirmedStartAt, timezone)}`}
                              </p>
                            </div>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={respondMutation.isPending}
                              onClick={() =>
                                respondMutation.mutate({
                                  workspaceId,
                                  proposalId: meeting.id,
                                  status: "accepted",
                                })
                              }
                            >
                              <Check size={13} /> 接受
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={respondMutation.isPending}
                              onClick={() =>
                                respondMutation.mutate({
                                  workspaceId,
                                  proposalId: meeting.id,
                                  status: "declined",
                                })
                              }
                            >
                              拒绝
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                    {events.length === 0 && pendingInvitations.length === 0 ? (
                      <p className="py-6 text-center text-xs text-outline">
                        暂无新通知。穿戴同步、过载预警与团队会议变更会在此实时出现。
                      </p>
                    ) : (
                      events.map(item => (
                        <Link
                          key={item.id}
                          to={item.to}
                          onClick={close}
                          className="rounded-xl p-2.5 hover:bg-surface-container-low transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <strong className="text-xs font-semibold text-on-surface">{item.title}</strong>
                            <time className="text-[11px] text-outline tabular-nums">
                              {localTime(item.occurredAt, timezone)}
                            </time>
                          </div>
                          <p className="mt-0.5 text-xs text-on-surface-variant line-clamp-2">{item.detail}</p>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              )}
            </Popover>

            <Button
              variant="outline"
              size="sm"
              className="hidden md:inline-flex"
              onClick={() => navigate("/team?meeting=1")}
            >
              <Sparkles size={14} /> 发起排会
            </Button>

            <Button
              variant="secondary"
              size="sm"
              className="hidden sm:inline-flex"
              onClick={() => navigate("/calendar?rescue=1")}
            >
              <Zap size={14} /> 紧急救援
            </Button>

            <Button
              variant="secondary"
              size="icon"
              className="sm:hidden"
              aria-label="新增日程"
              onClick={() => navigate("/calendar?new=1")}
            >
              <Plus size={18} />
            </Button>
          </div>
        </header>

        {realtime.alert && (
          <div className="overload-banner" role="status">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>{realtime.alert.message}</span>
            <Link to={`/calendar?rescue=1&trigger=${realtime.alert.triggerReason}`}>查看保护方案</Link>
            <button type="button" onClick={realtime.dismissAlert} aria-label="关闭保护提示">
              <X size={16} />
            </button>
          </div>
        )}

        <main ref={main} id="main-content" tabIndex={-1} className="workbench-content">
          <div ref={surfaceRef} className="route-surface">
            {children}
          </div>
        </main>
      </div>

      <nav className="mobile-navigation" aria-label="移动端导航">
        {navItems.map(({ to, icon: Icon }) => {
          const selected = location.pathname === to;
          return (
            <Link
              key={to}
              to={to}
              className={selected ? "active" : ""}
              aria-current={selected ? "page" : undefined}
            >
              <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
              <small>{mobileNavLabels[to]}</small>
            </Link>
          );
        })}
      </nav>

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onCycleTheme={next => cycleTheme(next)}
      />
    </div>
  );
}
