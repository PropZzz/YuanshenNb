const dateParts = (value: string | number | Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
};
export function localDate(value: string | number | Date = new Date(), timeZone = "Asia/Shanghai"): string {
  const p = dateParts(value, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}
export function localTime(value: string | number | Date, timeZone = "Asia/Shanghai"): string {
  const p = dateParts(value, timeZone);
  return `${p.hour}:${p.minute}`;
}
export function localDateTimeToISO(value: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("请选择完整的日期与时间");
  const [year, month, day, hour, minute] = value.split(/[-T:]/).map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = wall;
  for (let i = 0; i < 4; i++) {
    const p = dateParts(candidate, timeZone);
    const projected = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    if (projected === wall) break;
    candidate += wall - projected;
  }
  if (`${localDate(candidate, timeZone)}T${localTime(candidate, timeZone)}` !== value) throw new Error("所选本地时间不存在，请避开夏令时切换时段");
  return new Date(candidate).toISOString();
}
export function localInput(value: string, timeZone: string): string { return `${localDate(value, timeZone)}T${localTime(value, timeZone)}`; }
export function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function shiftMonth(day: string, offset: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + offset, 1, 12));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0, 12)).getUTCDate();
  next.setUTCDate(Math.min(date, lastDay));
  return next.toISOString().slice(0, 10);
}
export function weekDays(day: string): string[] {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return Array.from({ length: 7 }, (_, i) => shiftDay(day, i - ((weekday + 6) % 7)));
}
export function monthDays(day: string): string[] {
  const firstOfMonth = `${day.slice(0, 7)}-01`;
  const weekday = new Date(`${firstOfMonth}T12:00:00Z`).getUTCDay();
  const gridStart = shiftDay(firstOfMonth, -((weekday + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => shiftDay(gridStart, i));
}
export function isoWeekNumber(day: string): number {
  const date = new Date(`${day}T12:00:00Z`);
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4, 12));
  return Math.round((thursday.getTime() - yearStart.getTime()) / 604_800_000) + 1;
}
export function dayRange(day: string, timeZone: string, count = 1) {
  return { from: localDateTimeToISO(`${day}T00:00`, timeZone), to: localDateTimeToISO(`${shiftDay(day, count)}T00:00`, timeZone) };
}
export function displayDay(day: string, options: Intl.DateTimeFormatOptions = { month: "long", day: "numeric", weekday: "long" }): string {
  return new Intl.DateTimeFormat("zh-CN", { ...options, timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}
export function minuteLabel(minute: number): string { return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`; }

