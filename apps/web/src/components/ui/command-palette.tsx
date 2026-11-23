import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  FlaskConical,
  Moon,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Timer,
  Users,
  Zap,
} from "@/components/ui/reference-icons";
import { Dialog } from "@/components/ui/dialog";
import { useAuthStore, type ThemeMode } from "@/stores/auth-store";
import { cn } from "@/lib/utils";

interface CommandAction {
  id: string;
  group: string;
  label: string;
  hint: string;
  keywords: string;
  icon: typeof Timer;
  run: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onCycleTheme,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCycleTheme?: (next: ThemeMode) => void;
}) {
  const navigate = useNavigate();
  const themeMode = useAuthStore(state => state.themeMode);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const actions = useMemo<CommandAction[]>(() => {
    const go = (path: string) => {
      onOpenChange(false);
      navigate(path);
    };
    const nextTheme: ThemeMode = themeMode === "light" ? "dark" : themeMode === "dark" ? "system" : "light";
    return [
      { id: "nav-focus", group: "导航", label: "前往今日专注", hint: "/focus", keywords: "focus 专注 心流 计时", icon: Timer, run: () => go("/focus") },
      { id: "nav-calendar", group: "导航", label: "前往智能时间地图", hint: "/calendar", keywords: "calendar 日历 甘特 月视图", icon: CalendarDays, run: () => go("/calendar") },
      { id: "nav-team", group: "导航", label: "前往团队排会", hint: "/team", keywords: "team 团队 协作 会议", icon: Users, run: () => go("/team") },
      { id: "nav-energy", group: "导航", label: "前往穿戴精力洞察", hint: "/energy", keywords: "energy 精力 hrv 睡眠 节律", icon: Zap, run: () => go("/energy") },
      { id: "nav-settings", group: "导航", label: "前往节律与隐私设置", hint: "/settings", keywords: "settings 隐私 账户 诊断", icon: SlidersHorizontal, run: () => go("/settings") },
      { id: "act-new", group: "快捷操作", label: "新建个人日程", hint: "+ 日程", keywords: "new schedule 创建 日程", icon: Plus, run: () => go("/calendar?new=1") },
      { id: "act-rescue", group: "快捷操作", label: "启动突发日程救援（三方案推演）", hint: "Alt+S", keywords: "rescue 救援 紧急 过载", icon: Zap, run: () => go("/calendar?rescue=1") },
      { id: "act-meeting", group: "快捷操作", label: "发起团队智能排会", hint: "黄金窗口", keywords: "meeting 排会 团队 窗口", icon: Sparkles, run: () => go("/team?meeting=1") },
      { id: "act-replay", group: "快捷操作", label: "打开生理节律回放演练", hint: "/energy", keywords: "replay 回放 演练 疲劳", icon: FlaskConical, run: () => go("/energy?replay=1") },
      {
        id: "act-theme",
        group: "外观",
        label: `切换工作台主题（当前：${themeMode === "dark" ? "深色" : themeMode === "light" ? "浅色" : "跟随系统"}）`,
        hint: nextTheme === "dark" ? "切至深色" : nextTheme === "light" ? "切至浅色" : "切至系统",
        keywords: "theme 主题 深色 浅色 dark light",
        icon: themeMode === "dark" ? Sun : Moon,
        run: () => {
          onCycleTheme?.(nextTheme);
          onOpenChange(false);
        },
      },
    ];
  }, [navigate, onCycleTheme, onOpenChange, themeMode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(item => `${item.label} ${item.keywords} ${item.hint}`.toLowerCase().includes(q));
  }, [actions, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="工作台命令面板" description="快速跳转视图或触发核心操作">
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2.5 rounded-xl border border-outline-variant bg-surface px-3 py-2.5 focus-within:border-secondary">
          <Search size={16} className="text-outline shrink-0" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (!filtered.length) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex(i => (i + 1) % filtered.length);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex(i => (i - 1 + filtered.length) % filtered.length);
              } else if (event.key === "Enter") {
                event.preventDefault();
                filtered[activeIndex]?.run();
              }
            }}
            placeholder="输入命令或搜索视图（如：救援、排会、精力、深色）…"
            aria-label="搜索命令"
            autoFocus
            className="w-full bg-transparent text-sm text-on-surface outline-none"
          />
        </label>
        <div role="listbox" aria-label="可用命令" className="max-h-72 overflow-y-auto flex flex-col gap-1">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-xs text-outline">未找到匹配的命令</p>
          ) : (
            filtered.map((item, index) => {
              const Icon = item.icon;
              const active = index === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={item.run}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                    active ? "bg-primary-fixed/60 text-on-primary-fixed" : "hover:bg-surface-container-low text-on-surface",
                  )}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon size={16} className="shrink-0 text-primary" aria-hidden="true" />
                    <span className="truncate text-[13px] font-medium">{item.label}</span>
                  </span>
                  <span className="shrink-0 rounded-md bg-surface-container px-2 py-0.5 text-[11px] font-medium text-on-surface-variant">
                    {item.hint}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </Dialog>
  );
}
