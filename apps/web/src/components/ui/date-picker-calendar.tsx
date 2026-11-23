import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "@/components/ui/reference-icons";
import { isValidDay, monthDays, shiftDay, shiftMonth, weekDays } from "@/lib/datetime";

/** A draft calendar: browsing and keyboard focus never commit the form value. */
export function DatePickerCalendar({
  value,
  onChange,
  today,
}: {
  value: string;
  onChange: (day: string) => void;
  today: string;
}) {
  const [focused, setFocused] = useState(value);
  const [month, setMonth] = useState(`${value.slice(0, 7)}-01`);
  const grid = useRef<HTMLDivElement>(null);
  const requestFocus = useRef(false);
  const id = useId();
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const years = Array.from(
    { length: Math.min(9999, year + 100) - Math.max(1, year - 100) + 1 },
    (_, index) => Math.max(1, year - 100) + index,
  );

  useLayoutEffect(() => {
    if (requestFocus.current) {
      grid.current?.querySelector<HTMLButtonElement>(`[data-calendar-day="${focused}"]`)?.focus();
      requestFocus.current = false;
    }
  }, [focused, month]);

  function move(day: string, focus = true) {
    if (!isValidDay(day)) return;
    requestFocus.current = focus;
    setFocused(day);
    setMonth(`${day.slice(0, 7)}-01`);
  }

  function browse(offset: number) {
    move(shiftMonth(focused.slice(0, 7) === month.slice(0, 7) ? focused : month, offset), false);
  }

  function changeMonth(nextYear: number, nextMonth: number) {
    const anchor = new Date(`${month}T12:00:00Z`);
    anchor.setUTCFullYear(nextYear, nextMonth - 1, 1);
    const last = new Date(anchor);
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    const date = String(Math.min(Number(focused.slice(-2)), last.getUTCDate())).padStart(2, "0");
    move(`${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-${date}`, false);
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    let next: string | undefined;
    if (event.key === "ArrowLeft") next = shiftDay(day, -1);
    if (event.key === "ArrowRight") next = shiftDay(day, 1);
    if (event.key === "ArrowUp") next = shiftDay(day, -7);
    if (event.key === "ArrowDown") next = shiftDay(day, 7);
    if (event.key === "Home") next = weekDays(day)[0];
    if (event.key === "End") next = weekDays(day)[6];
    if (event.key === "PageUp") next = shiftMonth(day, event.shiftKey ? -12 : -1);
    if (event.key === "PageDown") next = shiftMonth(day, event.shiftKey ? 12 : 1);
    if (next) {
      event.preventDefault();
      move(next);
    }
  }

  return (
    <div className="date-picker-calendar">
      <div className="reference-month-heading">
        <button
          type="button"
          aria-label="上个月"
          disabled={month === "0001-01-01"}
          onClick={() => browse(-1)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <div className="date-picker-month-selects">
          <select
            aria-label="年份"
            value={year}
            onChange={event => changeMonth(Number(event.target.value), monthNumber)}
          >
            {years.map(value => (
              <option key={value} value={value}>
                {value} 年
              </option>
            ))}
          </select>
          <select
            aria-label="月份"
            value={monthNumber}
            onChange={event => changeMonth(year, Number(event.target.value))}
          >
            {Array.from({ length: 12 }, (_, index) => (
              <option key={index + 1} value={index + 1}>
                {index + 1} 月
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          aria-label="下个月"
          disabled={month === "9999-12-01"}
          onClick={() => browse(1)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {year}年{monthNumber}月
      </span>
      <div className="reference-month-weekdays" aria-hidden="true">
        {["一", "二", "三", "四", "五", "六", "日"].map(day => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <p id={id} className="sr-only">
        方向键移动日期，Home 和 End 选择周首尾，PageUp 和 PageDown 翻月，按回车选中后确认。
      </p>
      <div ref={grid} className="reference-month-days" role="group" aria-label="日期" aria-describedby={id}>
        {monthDays(month).map(day => (
          <button
            type="button"
            key={day}
            data-calendar-day={day}
            tabIndex={day === focused ? 0 : -1}
            disabled={!isValidDay(day)}
            aria-label={day}
            aria-pressed={value === day}
            aria-current={day === today ? "date" : undefined}
            className={day.slice(0, 7) !== month.slice(0, 7) ? "outside" : ""}
            onKeyDown={event => navigate(event, day)}
            onClick={() => {
              move(day, false);
              onChange(day);
            }}
          >
            {Number(day.slice(-2))}
          </button>
        ))}
      </div>
      <p className="date-picker-selection">待确认：{value}</p>
      <button
        type="button"
        className="date-picker-today"
        onClick={() => {
          move(today);
          onChange(today);
        }}
      >
        回到今天
      </button>
    </div>
  );
}
