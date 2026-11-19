import { useCallback, useEffect, useRef, type ReactNode, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { apiClient } from "@/api/client";
import { unwrap } from "@/api/unwrap";
import { useRealtime } from "@/api/use-realtime";
import { Button } from "@/components/ui/button";
import { PreferencesDrawer } from "@/features/settings/preferences-drawer";
import { useProfileAppearance } from "@/features/settings/profile-appearance";
import { useAuthStore } from "@/stores/auth-store";

const navItems = [
  { to: "/focus", label: "专注", icon: "timer", group: "今天" },
  { to: "/calendar", label: "智能日历", icon: "calendar_today", group: "" },
  { to: "/microtasks", label: "微任务", icon: "checklist", group: "规划" },
  { to: "/goals", label: "目标", icon: "flag", group: "" },
  { to: "/team", label: "团队", icon: "group", group: "协作" },
  { to: "/review", label: "智能复盘", icon: "insights", group: "系统" },
  { to: "/diagnostics", label: "接入与诊断", icon: "hub", group: "" },
  { to: "/profile", label: "我的", icon: "person", group: "" },
];
const mobilePaths = ["/focus", "/calendar", "/microtasks", "/team", "/profile"];
const mobileParent: Record<string, string> = { "/goals": "/profile", "/review": "/profile", "/diagnostics": "/profile", "/energy": "/profile", "/bluetooth": "/profile", "/settings": "/profile", "/integrations": "/calendar" };
function Symbol({ name }: { name: string }) { return <span className="material-symbols-outlined" aria-hidden="true">{name}</span>; }

export function AppShell({ children }: { children: ReactNode }) {
  const userId = useAuthStore(state => state.user?.id);
  useProfileAppearance(userId);
  const location = useLocation(), navigate = useNavigate(), realtime = useRealtime();
  const [params, setParams] = useSearchParams();
  const main = useRef<HTMLElement>(null), previousPath = useRef(location.pathname);
  const transition = useRef<{skipTransition:()=>void}|null>(null);
  const go = useCallback((to:string)=>{
    const documentWithMotion = document as Document & {startViewTransition?:(change:()=>void)=>{skipTransition:()=>void}};
    if(typeof documentWithMotion.startViewTransition!=="function" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches){navigate(to);return;}
    transition.current?.skipTransition();
    transition.current=documentWithMotion.startViewTransition(()=>{flushSync(()=>navigate(to));});
  },[navigate]);
  useEffect(()=>()=>transition.current?.skipTransition(),[]);
  function followLink(event:MouseEvent<HTMLDivElement>){
    if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
    const link=(event.target as HTMLElement).closest("a");
    if(!link||link.hasAttribute("download")||(link.target&&link.target!=="_self"))return;
    const url=new URL(link.href);if(url.origin!==window.location.origin||url.pathname===location.pathname)return;
    event.preventDefault();go(url.pathname+url.search);
  }
  useEffect(() => {
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    window.scrollTo(0, 0);
    if (!document.querySelector('[role="dialog"]')) main.current?.focus({ preventScroll: true });
  }, [location.pathname]);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.repeat || document.querySelector('[role="dialog"]')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (event.altKey && !event.ctrlKey && !event.metaKey && key === "s") { event.preventDefault(); go("/calendar?rescue=1"); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "k") { event.preventDefault(); go("/microtasks?panel=capture"); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "b") { event.preventDefault(); go("/microtasks"); }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [go]);
  const health = useQuery({ queryKey: ["system", "health"], queryFn: async () => unwrap(await apiClient.GET("/api/v1/health")), retry: 1, staleTime: 30_000 });
  const active = navItems.find(item => item.to === location.pathname);
  const extraLabels: Record<string, string> = { "/energy": "情绪与能量", "/bluetooth": "蓝牙设备", "/settings": "账户设置", "/integrations": "跨平台接入" };
  const label = active?.label ?? extraLabels[location.pathname] ?? "时间工作台";
  function preferences(open: boolean) { const next = new URLSearchParams(params); if (open) next.set("preferences", "1"); else next.delete("preferences"); setParams(next, { replace: !open }); }
  return <div className="workbench-shell" onClickCapture={followLink}>
    <a href="#main-content" className="skip-link">跳到主要内容</a>
    <aside className="workbench-sidebar">
      <Link to="/focus" className="sidebar-brand"><img src="/brand-logo.png" alt="时序智配标志" /><div><strong>时序智配</strong><span>时间地图工作台</span></div></Link>
      <nav className="sidebar-navigation" aria-label="主导航">{navItems.map(({ to, label: title, icon, group }) => <div key={to} className={group ? "nav-section-start" : undefined}>{group && <p className="nav-group">{group}</p>}<NavLink to={to} className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}><Symbol name={icon} /><span>{title}</span></NavLink></div>)}</nav>
      <div className="sidebar-bottom"><button type="button" className="sidebar-notifications" disabled title="系统通知尚未接入"><Symbol name="notifications" />系统通知<small>预留</small></button></div>
    </aside>
    <div className="workbench-main">
      <header className="workbench-topbar"><div className="topbar-breadcrumb"><span className="mobile-wordmark">时序智配</span><div className="desktop-breadcrumb">时序智配 <span>/</span> <strong>{label}</strong></div><span role="status" className={`connection-pill ${health.isError ? "is-error" : ""}`}>{health.isPending ? "正在连接" : health.isError ? "服务暂不可用" : realtime.state === "connected" ? "实时同步已连接" : "实时同步重连中"}</span></div><div className="topbar-actions"><Button variant="secondary" className="mobile-quick-add" aria-label="新增日程" onClick={() => navigate("/calendar?new=1")}><Symbol name="add" /></Button><Button variant="outline" aria-label="设置" onClick={() => preferences(true)}><Symbol name="settings" /></Button></div></header>
      {realtime.alert && <div className="overload-banner" role="status"><Symbol name="shield" /><span>{realtime.alert.message}</span><Link to="/calendar?rescue=1&trigger=wearable_fatigue">查看保护方案</Link><button onClick={realtime.dismissAlert} aria-label="关闭保护提示"><Symbol name="close" /></button></div>}
      <main ref={main} id="main-content" tabIndex={-1} className="workbench-content"><div className="route-surface" key={location.pathname}>{children}</div></main>
    </div>
    <nav className="mobile-navigation" aria-label="移动端导航">{mobilePaths.map(to => { const item = navItems.find(value => value.to === to)!; const selected = (mobileParent[location.pathname] ?? location.pathname) === to; return <Link key={to} to={to} className={selected ? "active" : ""} aria-current={selected ? "page" : undefined}><Symbol name={item.icon} /><small>{item.label}</small></Link>; })}</nav>
    <PreferencesDrawer open={params.get("preferences") === "1"} onClose={() => preferences(false)} />
  </div>;
}
