import { useId } from "react";
import { LayoutGroup, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { ChevronLeft, ChevronRight, FileUp, History, Plus, RefreshCw, SlidersHorizontal, Zap } from "@/components/ui/reference-icons";
import { Button } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/date-time-field";
import { Popover } from "@/components/ui/popover";
import { displayDay, isoWeekNumber, weekDays } from "@/lib/datetime";
import { calendarDisplayFilters, type CalendarOptions } from "./calendar-options";
import "./calendar-toolbar.css";

export type CalendarView = "day" | "week" | "month" | "gantt";
const views: { value: CalendarView; label: string }[] = [
  { value: "day", label: "日视图" }, { value: "week", label: "周视图" },
  { value: "month", label: "月视图" }, { value: "gantt", label: "甘特视图" },
];

interface CalendarToolbarProps {
  day: string;
  today: string;
  timezone: string;
  view: CalendarView;
  periodUnit: string;
  weekly: boolean;
  options: CalendarOptions;
  railOpen: boolean;
  error?: string;
  onSelectDay: (day: string) => void;
  onChangeView: (view: CalendarView) => void;
  onStepPeriod: (direction: 1 | -1) => void;
  onChangeOptions: (options: CalendarOptions) => void;
  onOpen: (name: "new" | "import" | "rescue" | "options") => void;
  onToggleRail: () => void;
  onRefresh: () => void;
}

export function CalendarToolbar({ day, today, timezone, view, periodUnit, weekly, options, railOpen, error, onSelectDay, onChangeView, onStepPeriod, onChangeOptions, onOpen, onToggleRail, onRefresh }: CalendarToolbarProps) {
  const id = useId(), reducedMotion = useReducedMotion();
  const days = weekDays(day);
  const caption = view === "month" ? "整月安排，一览全局" : weekly
    ? `${displayDay(days[0], { month: "short", day: "numeric" })} — ${displayDay(days[6], { month: "short", day: "numeric" })} · 第 ${isoWeekNumber(day)} 周`
    : displayDay(day, { month: "long", day: "numeric", weekday: "long" });

  return <section className="calendar-toolbar" data-view={view} aria-label="日历控制栏">
    <header className="calendar-toolbar-header">
      <div className="calendar-toolbar-heading">
        <h1>{displayDay(day, { year: "numeric", month: "long" })}</h1>
        <p>{caption}</p>
      </div>
      <div className="calendar-period-control" role="group" aria-label="日期导航">
        <Button variant="ghost" size="icon" aria-label={`上一${periodUnit}`} onClick={() => onStepPeriod(-1)}><ChevronLeft size={16} /></Button>
        <button type="button" className="calendar-today" onClick={() => onSelectDay(today)}>今天</button>
        <Button variant="ghost" size="icon" aria-label={`下一${periodUnit}`} onClick={() => onStepPeriod(1)}><ChevronRight size={16} /></Button>
      </div>
      <div className="calendar-toolbar-actions">
        <Button variant="secondary" size="sm" onClick={() => onOpen("new")}><Plus size={16} /><span>新增日程</span></Button>
        <Button variant="outline" size="sm" onClick={() => onOpen("import")}><FileUp size={15} /><span>导入</span></Button>
        <Button variant="outline" size="sm" className="calendar-rescue-trigger" aria-label="紧急救援" onClick={() => onOpen("rescue")}><Zap size={15} /><span><span className="calendar-rescue-prefix">紧急</span>救援</span></Button>
      </div>
    </header>

    <div className="calendar-toolbar-controls">
      <LayoutGroup id={id}>
        <div className="calendar-view-switch" role="group" aria-label="日历视图">
          {views.map(({ value, label }) => <button type="button" key={value} aria-pressed={view === value} onClick={() => onChangeView(value)}>
            {view === value && <m.span aria-hidden="true" initial={false} layoutId="calendar-view" className="calendar-view-indicator" transition={reducedMotion ? { duration: 0 } : { type: "spring", bounce: 0, visualDuration: .22 }} />}
            <span className="calendar-view-label">{label}</span>
          </button>)}
        </div>
      </LayoutGroup>
      <div className="calendar-toolbar-tools">
        <div className="calendar-jump-date"><DateTimeField label="跳转日期" type="date" value={day} onChange={onSelectDay} timezone={timezone} /></div>
        <Popover label="显示筛选" trigger={({ toggle, ...aria }) => <Button variant="outline" size="sm" className="calendar-filter-trigger" aria-label="筛选" onClick={toggle} {...aria}><SlidersHorizontal size={15} /><span>筛选</span></Button>} panelClassName="calendar-filter-popover">
          {close => <div className="calendar-filter-content">
            <div className="calendar-filter-heading"><strong>显示内容</strong><button type="button" onClick={() => { close(); onOpen("options"); }}>更多显示选项</button></div>
            <label className="calendar-filter-energy"><input type="checkbox" aria-label="精力预测底色" disabled={view === "month" || view === "gantt"} checked={options.energyBands} onChange={event => onChangeOptions({ ...options, energyBands: event.target.checked })} /><span>精力预测底色<small>日 / 周视图显示逐时预测</small></span></label>
            {calendarDisplayFilters.map(({ key, label }) => <label key={key}><input type="checkbox" checked={options[key]} onChange={event => onChangeOptions({ ...options, [key]: event.target.checked })} /><span>{label}</span></label>)}
          </div>}
        </Popover>
        <Button variant={railOpen ? "outline" : "ghost"} size="icon" aria-pressed={railOpen} aria-label="切换摘要与救援快照栏" title="查看日程摘要与救援快照" onClick={onToggleRail}><History size={16} /></Button>
        <Button variant="ghost" size="icon" aria-label="刷新日历" title="刷新日历" onClick={onRefresh}><RefreshCw size={16} /></Button>
      </div>
    </div>

    <nav className="calendar-week-picker" aria-label="本周日期">
      {days.map(date => <button type="button" key={date} aria-pressed={date === day} aria-current={date === today ? "date" : undefined} aria-label={displayDay(date, { month: "long", day: "numeric", weekday: "long" })} onClick={() => onSelectDay(date)}>
        <span>{date === today ? "今天" : displayDay(date, { weekday: "short" })}</span>
        <time dateTime={date}>{Number(date.slice(-2))}</time>
      </button>)}
    </nav>
    {error && <p className="calendar-selection-status" role="alert">{error}</p>}
  </section>;
}
