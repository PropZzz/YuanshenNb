import type { ApiComponents } from "@/api/client";
import { localDate, localTime } from "@/lib/datetime";
export interface PositionedEvent { item: ApiComponents["ScheduleItemDTO"]; startMinute: number; endMinute: number; column: number; columns: number }
const minutes = (value: string, timeZone: string) => { const [h, m] = localTime(value, timeZone).split(":").map(Number); return h * 60 + m; };
// Rendering-only column packing: it never moves an event or computes a schedule.
export function layoutDayEvents(items: ApiComponents["ScheduleItemDTO"][], day: string, timeZone: string): PositionedEvent[] {
  const visible = items.filter(item => item.status !== "cancelled" && localDate(item.startAt, timeZone) <= day && (localDate(item.endAt, timeZone) > day || (localDate(item.endAt, timeZone) === day && minutes(item.endAt, timeZone) > 0)))
    .map(item => ({ item, startMinute: localDate(item.startAt, timeZone) < day ? 0 : minutes(item.startAt, timeZone), endMinute: localDate(item.endAt, timeZone) > day ? 1440 : minutes(item.endAt, timeZone), column: 0, columns: 1 }))
    .filter(item => item.endMinute > item.startMinute).sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute || a.item.id.localeCompare(b.item.id));
  let group: PositionedEvent[] = [], ends: number[] = [], groupEnd = -1;
  const flush = () => { group.forEach(item => { item.columns = ends.length; }); group = []; ends = []; };
  for (const event of visible) {
    if (event.startMinute >= groupEnd) flush();
    let column = ends.findIndex(end => end <= event.startMinute);
    if (column < 0) column = ends.length;
    ends[column] = event.endMinute;
    event.column = column;
    group.push(event);
    groupEnd = Math.max(group.length === 1 ? -1 : groupEnd, event.endMinute);
  }
  flush();
  return visible;
}

