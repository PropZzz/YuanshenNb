import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { LayoutGroup, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useRouteMotion } from "./use-route-motion";
import { apiClient } from "@/api/client";
import { unwrap } from "@/api/unwrap";
import { useRealtime } from "@/api/use-realtime";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { BatteryCharging, CalendarPlus, Command, PanelLeftClose, PanelLeftOpen, Search } from "@/components/ui/reference-icons";
import { SemanticIcon } from "@/components/ui/semantic-icon";
import { localDate } from "@/lib/datetime";
import { AuthModal } from "@/features/auth/auth-page";
import { freshnessLabels, useEnergy } from "@/features/energy/queries";
import { PreferencesDrawer } from "@/features/settings/preferences-drawer";
import { useProfileAppearance } from "@/features/settings/profile-appearance";
import { useAuthStore } from "@/stores/auth-store";

const navItems = [
  { to: "/focus", label: "专注", icon: "timer", group: "今天" },
  { to: "/calendar", label: "智能日历", icon: "calendar_today", group: "" },
  { to: "/energy", label: "情绪与能量", icon: "zap", group: "" },
  { to: "/microtasks", label: "微任务", icon: "checklist", group: "规划" },
  { to: "/goals", label: "目标", icon: "flag", group: "" },
  { to: "/team", label: "团队", icon: "group", group: "协作" },
  { to: "/review", label: "智能复盘", icon: "insights", group: "系统" },
  { to: "/diagnostics", label: "接入与诊断", icon: "hub", group: "" },
  { to: "/profile", label: "我的", icon: "person", group: "" },
];
const mobilePaths = ["/focus", "/calendar", "/microtasks", "/team", "/profile"];
const desktopParent: Record<string, string> = { "/bluetooth": "/diagnostics", "/settings": "/profile", "/integrations": "/calendar" };
const mobileParent: Record<string, string> = { "/goals": "/profile", "/review": "/profile", "/diagnostics": "/profile", "/energy": "/profile", "/bluetooth": "/profile", "/settings": "/profile", "/integrations": "/calendar" };
function Symbol({ name }: { name: string }) { return <SemanticIcon name={name} />; }

const commands = [
  { path: "/focus", label: "专注", group: "今天", icon: "timer" },
  { path: "/calendar", label: "智能日历", group: "今天", icon: "calendar_today" },
  { path: "/energy", label: "情绪与能量", group: "今天", icon: "zap" },
  { path: "/microtasks", label: "微任务", group: "规划", icon: "checklist" },
  { path: "/goals", label: "目标", group: "规划", icon: "flag" },
  { path: "/team", label: "团队", group: "协作", icon: "group" },
  { path: "/review", label: "智能复盘", group: "系统", icon: "insights" },
  { path: "/diagnostics", label: "接入与诊断", group: "系统", icon: "hub" },
  { path: "/profile", label: "我的", group: "系统", icon: "person" },
  { path: "/integrations", label: "跨平台接入", group: "智能日历", icon: "apps" },
  { path: "/bluetooth", label: "蓝牙设备", group: "接入与诊断", icon: "hub" },
  { path: "/settings", label: "账户设置", group: "我的", icon: "settings" },
  { path: "/calendar?new=1", label: "新增日程", group: "快捷操作", icon: "add" },
  { path: "/calendar?rescue=1", label: "查看日程救援方案", group: "快捷操作 · Alt+S", icon: "shield" },
  { path: "/microtasks?panel=capture", label: "快速捕获微任务", group: "快捷操作 · Ctrl/Cmd+Shift+K", icon: "add_task" },
];

export function AppShell({ children, previewLocked = false }: { children: ReactNode; previewLocked?: boolean }) {
  const user = useAuthStore(state => state.user);
  const authenticated = useAuthStore(state => state.status === "authenticated");
  const userId = user?.id;
  const timezone = user?.timezone ?? "Asia/Shanghai";
  useProfileAppearance(userId);
  const location = useLocation(), navigate = useNavigate(), realtime = useRealtime();
  const [params, setParams] = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [switchAccountOpen, setSwitchAccountOpen] = useState(false);
  const [switchAccountMode, setSwitchAccountMode] = useState<"login" | "register">("login");

  const shellRef = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null), previousPath = useRef(location.pathname);
  const energyDay = previewLocked || !authenticated ? "" : localDate(new Date(), timezone);
  const energy = useEnergy(energyDay);
  const { surfaceRef, go } = useRouteMotion();
  const navigationId = useId(), reducedMotion = useReducedMotion();
  const selectionTransition = reducedMotion
    ? { duration: 0 }
    : { type: "spring" as const, bounce: 0, visualDuration: 0.24 };
  const desktopPath = desktopParent[location.pathname] ?? location.pathname;
  const mobilePath = mobileParent[location.pathname] ?? location.pathname;
  const modalRecessed = Boolean(previewLocked || switchAccountOpen);

  useEffect(() => {
    const node = shellRef.current;
    if (!node) return;
    if (modalRecessed) {
      node.setAttribute("inert", "");
    } else {
      node.removeAttribute("inert");
    }
  }, [modalRecessed]);

  function followLink(event: MouseEvent<HTMLDivElement>) {
    if (previewLocked) return;
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self") || link.getAttribute("href")?.startsWith("#")) return;
    const url = new URL(link.href);
    if (url.origin !== window.location.origin) return;
    event.preventDefault();
    go(url.pathname + url.search + url.hash);
  }

  useEffect(() => {
    if (previewLocked) return;
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    window.scrollTo(0, 0);
    if (!document.querySelector('[role="dialog"]')) main.current?.focus({ preventScroll: true });
  }, [location.pathname, previewLocked]);

  useEffect(() => {
    if (previewLocked) return;
    function shortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.repeat || document.querySelector('[role="dialog"]')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (event.altKey && !event.ctrlKey && !event.metaKey && key === "s") { event.preventDefault(); go("/calendar?rescue=1"); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "k") { event.preventDefault(); go("/microtasks?panel=capture"); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "b") { event.preventDefault(); go("/microtasks"); }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === "k") {
        event.preventDefault();
        setCommandSearch("");
        setActiveIndex(0);
        setCommandOpen(true);
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [go, previewLocked]);

  const filteredCommands = useMemo(() => {
    const query = commandSearch.trim().toLocaleLowerCase();
    return query ? commands.filter(command => `${command.label} ${command.group}`.toLocaleLowerCase().includes(query)) : commands;
  }, [commandSearch]);

  useEffect(() => {
    setActiveIndex(0);
  }, [commandSearch, commandOpen]);

  const health = useQuery({
    queryKey: ["system", "health"],
    queryFn: async () => unwrap(await apiClient.GET("/api/v1/health")),
    retry: 1,
    staleTime: 30_000,
    enabled: !previewLocked && authenticated,
  });

  const active = navItems.find(item => item.to === location.pathname);
  const extraLabels: Record<string, string> = { "/energy": "情绪与能量", "/bluetooth": "蓝牙设备", "/settings": "账户设置", "/integrations": "跨平台接入" };
  const label = previewLocked ? "账户通行证" : active?.label ?? extraLabels[location.pathname] ?? "时间工作台";
  function preferences(open: boolean) {
    const next = new URLSearchParams(params);
    if (open) next.set("preferences", "1");
    else next.delete("preferences");
    setParams(next, { replace: !open });
  }

  return (
    <LayoutGroup id={navigationId}>
      <div
        ref={shellRef}
        className={`workbench-shell ${collapsed ? "sidebar-collapsed" : ""} ${modalRecessed ? "is-recessed" : ""}`}
        aria-hidden={modalRecessed || undefined}
        onClickCapture={followLink}
      >
        <a href="#main-content" className="skip-link">跳到主要内容</a>
        <aside className="workbench-sidebar">
          <div className="sidebar-brand-row">
            <Link to="/focus" className="sidebar-brand">
              <img src="/brand-logo.png" alt="" width={32} height={32} />
              <div><strong>时序智配</strong><span>时间工作台</span></div>
            </Link>
            <button
              type="button"
              className="sidebar-collapse"
              aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
              aria-pressed={collapsed}
              title={collapsed ? "展开侧栏" : "折叠侧栏"}
              onClick={() => setCollapsed(value => !value)}
            >
              {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
          </div>
          <nav className="sidebar-navigation" aria-label="主导航">
            {navItems.map(({ to, label: title, icon, group }) => {
              const selected = !previewLocked && desktopPath === to;
              return (
                <div key={to} className={group ? "nav-section-start" : undefined}>
                  {group && <p className="nav-group">{group}</p>}
                  <Link
                    to={to}
                    title={collapsed ? title : undefined}
                    aria-label={title}
                    aria-current={selected ? "page" : undefined}
                    className={`sidebar-link ${selected ? "active" : ""}`}
                  >
                    {selected && (
                      <m.span
                        layoutId="workbench-nav-active"
                        initial={false}
                        aria-hidden="true"
                        className="nav-active-indicator"
                        transition={selectionTransition}
                      />
                    )}
                    <Symbol name={icon} />
                    <span className="nav-label">{title}</span>
                  </Link>
                </div>
              );
            })}
          </nav>
          <div className="sidebar-bottom">
            <button
              type="button"
              className="sidebar-account-switch"
              disabled={previewLocked}
              title="切换账户"
              aria-label="切换账户"
              onClick={() => {
                setSwitchAccountMode("login");
                setSwitchAccountOpen(true);
              }}
            >
              <span className="avatar" aria-hidden="true">{user?.displayName?.slice(0, 1) || "时"}</span>
              <div>
                <strong>{previewLocked ? "等待验证" : user?.displayName ?? "工作台账户"}</strong>
                <small>切换账户</small>
              </div>
              <Symbol name="switch_account" />
            </button>
          </div>
        </aside>

        <div className="workbench-main">
          <header className="workbench-topbar">
            <div className="topbar-breadcrumb">
              <span className="mobile-wordmark">时序智配</span>
              <div className="desktop-breadcrumb">时序智配 <span>/</span> <strong>{label}</strong></div>
              <span role="status" className={`connection-pill ${!previewLocked && health.isError ? "is-error" : ""}`}>
                <i className={`status-dot ${!previewLocked && health.isError ? "is-offline" : ""}`} />
                {previewLocked
                  ? "等待登录验证"
                  : health.isPending
                    ? "正在连接"
                    : health.isError
                      ? "服务暂不可用"
                      : realtime.state === "connected"
                        ? "实时同步已连接"
                        : "实时同步重连中"}
              </span>
            </div>
            <div className="topbar-actions">
              <Link
                className="energy-pill"
                to="/energy"
                aria-label={!previewLocked && energy.data ? `今日精力 ${energy.data.score} 分，${freshnessLabels[energy.data.dataFreshness]}` : "查看精力状态"}
              >
                <BatteryCharging size={16} />
                <span>精力</span>
                <strong>{!previewLocked ? (energy.data?.score ?? "—") : "—"}</strong>
                <small>{previewLocked ? "待登录" : energy.data ? freshnessLabels[energy.data.dataFreshness] : energy.isError ? "暂不可用" : "读取中"}</small>
              </Link>
              <Button
                variant="outline"
                className="topbar-command"
                aria-label="打开全局命令面板"
                disabled={previewLocked}
                onClick={() => { setCommandSearch(""); setActiveIndex(0); setCommandOpen(true); }}
              >
                <Command size={15} />
                <span>命令</span>
                <kbd>Ctrl / ⌘ K</kbd>
              </Button>
              <Button variant="secondary" className="topbar-add" disabled={previewLocked} onClick={() => navigate("/calendar?new=1")}>
                <CalendarPlus size={16} />
                <span>新增日程</span>
              </Button>
              <Button variant="outline" aria-label="设置" disabled={previewLocked} onClick={() => preferences(true)}>
                <Symbol name="settings" />
              </Button>
              <Button variant="secondary" className="mobile-quick-add" aria-label="新增日程" disabled={previewLocked} onClick={() => navigate("/calendar?new=1")}>
                <Symbol name="add" />
              </Button>
            </div>
          </header>
          {!previewLocked && realtime.alert && (
            <div className="overload-banner" role="status">
              <Symbol name="shield" />
              <span>{realtime.alert.message}</span>
              <Link to="/calendar?rescue=1&trigger=wearable_fatigue">查看保护方案</Link>
              <button type="button" onClick={realtime.dismissAlert} aria-label="关闭保护提示"><Symbol name="close" /></button>
            </div>
          )}
          <main ref={main} id="main-content" tabIndex={-1} className="workbench-content">
            <div ref={surfaceRef} className="route-surface">{children}</div>
          </main>
        </div>

        <nav className="mobile-navigation" aria-label="移动端导航">
          {mobilePaths.map(to => {
            const item = navItems.find(value => value.to === to)!;
            const selected = !previewLocked && mobilePath === to;
            return (
              <Link key={to} to={to} className={selected ? "active" : ""} aria-current={selected ? "page" : undefined}>
                {selected && (
                  <m.span
                    layoutId="mobile-nav-active"
                    initial={false}
                    aria-hidden="true"
                    className="mobile-nav-indicator"
                    transition={selectionTransition}
                  />
                )}
                <Symbol name={item.icon} />
                <small>{item.label}</small>
              </Link>
            );
          })}
        </nav>

        {!previewLocked && (
          <>
            <Dialog open={commandOpen} onOpenChange={setCommandOpen} title="全局命令" description="搜索页面与常用操作" className="command-dialog" width={600}>
              <label className="command-search">
                <Search size={18} />
                <input
                  autoFocus
                  value={commandSearch}
                  onChange={event => setCommandSearch(event.target.value)}
                  onKeyDown={event => {
                    if (!filteredCommands.length) return;
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setActiveIndex(current => (current + 1) % filteredCommands.length);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setActiveIndex(current => (current - 1 + filteredCommands.length) % filteredCommands.length);
                    } else if (event.key === "Enter") {
                      event.preventDefault();
                      const chosen = filteredCommands[activeIndex] ?? filteredCommands[0];
                      if (chosen) {
                        setCommandOpen(false);
                        go(chosen.path);
                      }
                    }
                  }}
                  placeholder="搜索页面或操作…"
                  aria-label="搜索命令"
                  aria-activedescendant={filteredCommands[activeIndex] ? `command-opt-${activeIndex}` : undefined}
                />
                <kbd>Esc</kbd>
              </label>
              <div className="command-results" role="listbox" aria-label="命令结果">
                {filteredCommands.length ? filteredCommands.map((command, index) => {
                  const selected = index === activeIndex;
                  return (
                    <button
                      id={`command-opt-${index}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      key={command.path}
                      className={selected ? "is-active" : undefined}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => { setCommandOpen(false); go(command.path); }}
                    >
                      <Symbol name={command.icon} />
                      <span>{command.label}</span>
                      <small>{command.group}</small>
                    </button>
                  );
                }) : <p className="command-empty">没有匹配的页面或操作</p>}
              </div>
            </Dialog>
            <PreferencesDrawer open={params.get("preferences") === "1"} onClose={() => preferences(false)} />
          </>
        )}
      </div>
      {!previewLocked && (
        <AuthModal
          open={switchAccountOpen}
          mode={switchAccountMode}
          blocking={false}
          onClose={() => setSwitchAccountOpen(false)}
          onModeChange={setSwitchAccountMode}
        />
      )}
    </LayoutGroup>
  );
}
