import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, Clock3, X } from "@/components/ui/reference-icons";
import { isValidDay, localDate } from "@/lib/datetime";
import { DatePickerCalendar } from "./date-picker-calendar";

export interface DateTimeFieldProps {
  name?: string;
  label: string;
  timezone?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  type?: "time" | "datetime-local" | "date";
}

export function DateTimeField({
  label,
  value,
  defaultValue,
  onChange,
  type = "datetime-local",
  timezone,
  ...props
}: DateTimeFieldProps) {
  const [local, setLocal] = useState(defaultValue ?? "");
  const [picker, setPicker] = useState<"time" | "date" | null>(null);
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [selectedDay, setSelectedDay] = useState("");
  const today = localDate(new Date(), timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const id = useId();
  const field = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const current = value ?? local;
  const [popupNode, setPopupNode] = useState<HTMLDivElement | null>(null);
  const bindPopup = useCallback((node: HTMLDivElement | null) => {
    popup.current = node;
    setPopupNode(node);
  }, []);

  useLayoutEffect(() => {
    if (!picker || !popupNode) return;
    const place = () => {
      const anchor = field.current?.getBoundingClientRect();
      if (!anchor) return;
      const rect = popupNode.getBoundingClientRect();
      const below = anchor.bottom + 6;
      const top =
        below + rect.height <= window.innerHeight - 12
          ? below
          : Math.max(12, anchor.top - rect.height - 6);
      const left = Math.max(12, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 12));
      setPosition(previous => (previous.top === top && previous.left === left ? previous : { top, left }));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [picker, popupNode]);

  function change(next: string) {
    setLocal(next);
    onChange?.(next);
  }

  function show(kind: "date" | "time", button: HTMLButtonElement) {
    opener.current = button;
    const time = type === "time" ? current : current.split("T")[1] ?? "09:00";
    setHour(Number(time.slice(0, 2)) || 0);
    setMinute(Number(time.slice(3, 5)) || 0);
    const day = isValidDay(current.slice(0, 10)) ? current.slice(0, 10) : today;
    setSelectedDay(day);
    const rect = field.current!.getBoundingClientRect();
    const height = kind === "date" ? 408 : 320;
    setPosition({
      left: Math.max(12, Math.min(rect.right - 260, window.innerWidth - 272)),
      top: rect.bottom + height > window.innerHeight ? Math.max(12, rect.top - height) : rect.bottom + 6,
    });
    setPicker(kind);
  }

  function applyTime() {
    const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    change(type === "time" ? time : `${current.slice(0, 10) || today}T${time}`);
    setPicker(null);
  }

  function applyDate() {
    change(type === "date" ? selectedDay : `${selectedDay}T${current.split("T")[1] || "09:00"}`);
    setPicker(null);
  }

  function moveTime(event: KeyboardEvent<HTMLDivElement>, kind: "hour" | "minute") {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const max = kind === "hour" ? 23 : 59;
    const old = kind === "hour" ? hour : minute;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? max
          : (old + (event.key === "ArrowDown" ? 1 : max)) % (max + 1);
    (kind === "hour" ? setHour : setMinute)(next);
    event.currentTarget.querySelector(`[data-value="${next}"]`)?.scrollIntoView?.({ block: "nearest" });
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="reference-time-field" ref={field}>
        <input {...props} id={id} type={type} value={current} onChange={e => change(e.target.value)} />
        {type !== "time" && (
          <button
            type="button"
            disabled={props.disabled}
            aria-label={label.endsWith("日期") ? `选择${label}` : `选择${label}日期`}
            aria-expanded={picker === "date"}
            onClick={e => show("date", e.currentTarget)}
          >
            <CalendarDays size={16} aria-hidden="true" />
          </button>
        )}
        {type !== "date" && (
          <button
            type="button"
            disabled={props.disabled}
            aria-label={`选择${label}`}
            aria-expanded={picker === "time"}
            onClick={e => show("time", e.currentTarget)}
          >
            <Clock3 size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <DialogPrimitive.Root open={picker !== null} onOpenChange={open => { if (!open) setPicker(null); }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="time-picker-overlay" />
          <DialogPrimitive.Content
            ref={bindPopup}
            data-picker={picker}
            className="reference-time-popover"
            style={position}
            aria-describedby={undefined}
            onOpenAutoFocus={event => {
              event.preventDefault();
              if (picker === "date") {
                popup.current?.querySelector<HTMLElement>('[data-calendar-day][tabindex="0"]')?.focus();
                return;
              }
              popup.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus();
              popup.current
                ?.querySelectorAll<HTMLElement>('[aria-selected="true"]')
                .forEach(option => option.scrollIntoView?.({ block: "nearest", inline: "nearest" }));
            }}
            onCloseAutoFocus={event => {
              if (opener.current?.isConnected) {
                event.preventDefault();
                opener.current.focus();
              }
            }}
          >
            {picker === "date" ? (
              <>
                <header>
                  <DialogPrimitive.Title>选择日期</DialogPrimitive.Title>
                  <button
                    type="button"
                    className="reference-picker-dismiss"
                    aria-label="关闭日期选择"
                    onClick={() => setPicker(null)}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </header>
                <DatePickerCalendar value={selectedDay} onChange={setSelectedDay} today={today} />
                <div className="reference-date-actions">
                  <button type="button" onClick={() => setPicker(null)}>取消</button>
                  <button type="button" className="button button-primary" onClick={applyDate}>确认日期</button>
                </div>
              </>
            ) : (
              <>
                <header>
                  <DialogPrimitive.Title>{`选择${label}`}</DialogPrimitive.Title>
                  <strong>{String(hour).padStart(2, "0")}:{String(minute).padStart(2, "0")}</strong>
                </header>
                <div className="reference-time-columns">
                  {(["hour", "minute"] as const).map(kind => (
                    <div key={kind}>
                      <span>{kind === "hour" ? "小时" : "分钟"}</span>
                      <div
                        role="listbox"
                        aria-label={kind === "hour" ? "小时" : "分钟"}
                        tabIndex={0}
                        onKeyDown={event => moveTime(event, kind)}
                      >
                        {Array.from({ length: kind === "hour" ? 24 : 60 }, (_, n) => (
                          <button
                            key={n}
                            type="button"
                            role="option"
                            data-value={n}
                            aria-label={`${n} ${kind === "hour" ? "时" : "分"}`}
                            aria-selected={(kind === "hour" ? hour : minute) === n}
                            onClick={() => (kind === "hour" ? setHour : setMinute)(n)}
                          >
                            {String(n).padStart(2, "0")}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" className="button button-primary w-full mt-3" onClick={applyTime}>
                  确认时间
                </button>
              </>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}
