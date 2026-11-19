import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CalendarDays,
  Monitor,
  Moon,
  Settings,
  Sun,
  Timer,
  Users,
} from "lucide-react";
import { apiClient, type ApiComponents } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import { useAuthStore, type ThemeMode } from "@/stores/auth-store";

export type DataFreshness = ApiComponents["DataFreshness"];

interface NavItem {
  to: string;
  label: string;
  shortLabel: string;
  icon: typeof Timer;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/focus", label: "今日专注与精力", shortLabel: "专注", icon: Timer },
  { to: "/calendar", label: "智能日历与救援", shortLabel: "日历", icon: CalendarDays },
  { to: "/team", label: "团队协同排会", shortLabel: "团队", icon: Users },
  { to: "/energy", label: "穿戴精力洞察", shortLabel: "精力", icon: Activity },
  { to: "/settings", label: "账号与隐私", shortLabel: "设置", icon: Settings },
];

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: "light", label: "浅色", icon: Sun },
  { mode: "dark", label: "深色", icon: Moon },
  { mode: "system", label: "跟随系统", icon: Monitor },
];

const FRESHNESS_LABELS: Record<DataFreshness, string> = {
  live_wearable: "live_wearable · 实时同步",
  recent_wearable: "recent_wearable · 今日基线",
  replay_demo: "replay_demo · 回放测试源",
  baseline_only: "baseline_only · 未连接穿戴",
};

interface AppShellProps {
  children: ReactNode;
  dataFreshness?: DataFreshness;
}

export function AppShell({ children, dataFreshness = "baseline_only" }: AppShellProps) {
  const { themeMode, setThemeMode } = useAuthStore();

  const healthQuery = useQuery({
    queryKey: queryKeys.system.health,
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/api/v1/health");
      if (error || !data) {
        throw new Error("backend unreachable");
      }
      return data;
    },
    retry: false,
    staleTime: 30_000,
  });

  const isConnected = healthQuery.isSuccess && healthQuery.data.ok;

  return (
    <div className="min-h-screen bg-surface text-on-surface flex">
      {/* 桌面端固定 260px 侧栏 */}
      <aside
        className="hidden lg:flex lg:flex-col lg:shrink-0 bg-surface-container-low border-r"
        style={{ width: "var(--rc-sidebar-width)", borderColor: "var(--rc-line)" }}
      >
        <div
          className="flex items-center gap-3 px-5 border-b"
          style={{ height: "var(--rc-header-height)", borderColor: "var(--rc-line)" }}
        >
          <img
            src="/brand-logo.png"
            alt="时序智配"
            className="h-8 w-8 rounded-lg object-contain"
          />
          <div>
            <div className="font-headline text-base font-semibold tracking-tight text-primary">
              时序智配
            </div>
            <div className="text-[11px] text-on-surface-variant">
              Temporal Scheduler V2
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1" aria-label="主导航">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  "flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-on-primary shadow-sm"
                    : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
                ].join(" ")
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t space-y-3" style={{ borderColor: "var(--rc-line)" }}>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-on-surface-variant">穿戴数据状态</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-2.5 py-0.5 text-[11px] font-medium text-on-surface-variant">
              {FRESHNESS_LABELS[dataFreshness]}
            </span>
          </div>
          <div className="flex items-center gap-1 rounded-xl bg-surface-container p-1">
            {THEME_OPTIONS.map(({ mode, label, icon: Icon }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setThemeMode(mode)}
                className={[
                  "flex-1 inline-flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs transition-colors",
                  themeMode === mode
                    ? "bg-surface-container-lowest text-primary font-medium shadow-xs"
                    : "text-on-surface-variant hover:text-on-surface",
                ].join(" ")}
                aria-pressed={themeMode === mode}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* 主内容区域 */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header
          className="sticky top-0 z-10 flex items-center justify-between gap-4 px-5 lg:px-8 border-b backdrop-blur-md bg-surface/85"
          style={{ height: "var(--rc-header-height)", borderColor: "var(--rc-line)" }}
        >
          <div className="flex items-center gap-2.5 lg:hidden">
            <img src="/brand-logo.png" alt="时序智配" className="h-7 w-7 rounded-md" />
            <span className="font-headline font-semibold text-primary">时序智配</span>
          </div>
          <div className="hidden lg:block text-sm text-on-surface-variant">
            个人精力护盾与团队协同排会工作台
          </div>
          <div className="flex items-center gap-3">
            <span
              className={[
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                healthQuery.isPending
                  ? "bg-surface-container-high text-on-surface-variant"
                  : isConnected
                    ? "bg-tertiary-container text-on-tertiary-container"
                    : "bg-error-container text-on-error-container",
              ].join(" ")}
            >
              <span
                className={[
                  "h-2 w-2 rounded-full",
                  healthQuery.isPending
                    ? "bg-outline"
                    : isConnected
                      ? "bg-on-tertiary-container"
                      : "bg-error",
                ].join(" ")}
              />
              {healthQuery.isPending
                ? "正在检测服务端"
                : isConnected
                  ? "服务端已连通"
                  : "未连接服务端（只读骨架）"}
            </span>
          </div>
        </header>

        <main className="flex-1 p-5 lg:p-8 pb-24 lg:pb-8 max-w-[1360px] w-full mx-auto">
          {children}
        </main>
      </div>

      {/* 窄屏底部导航栏 */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-20 border-t bg-surface-container-lowest/95 backdrop-blur-md flex items-center justify-around px-2"
        style={{
          height: "calc(4.25rem + env(safe-area-inset-bottom))",
          paddingBottom: "env(safe-area-inset-bottom)",
          borderColor: "var(--rc-line)",
        }}
        aria-label="移动端导航"
      >
        {NAV_ITEMS.map(({ to, shortLabel, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                "flex flex-col items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium",
                isActive ? "text-primary" : "text-on-surface-variant",
              ].join(" ")
            }
          >
            <Icon className="h-5 w-5" />
            <span>{shortLabel}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
