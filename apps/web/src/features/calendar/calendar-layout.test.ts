import { describe, expect, it } from "vitest";
import type { ApiComponents } from "@/api/client";
import { layoutDayEvents } from "./calendar-layout";
import { localDate, localDateTimeToISO, localTime, shiftDay, weekDays } from "@/lib/datetime";

function item(id: string, startAt: string, endAt: string): ApiComponents["ScheduleItemDTO"] {
  return { id, userId: "u", title: id, notes: "", category: "deep_work", cognitiveLoad: "high", flexibility: "flexible", status: "planned", startAt, endAt, durationMinutes: (Date.parse(endAt) - Date.parse(startAt)) / 60000, reminderMinutes: 10, createdAt: startAt, updatedAt: startAt };
}

describe("calendar physical-time projection", () => {
  it("converts a local input to UTC and projects it back without persisting pixels", () => {
    const iso = localDateTimeToISO("2026-11-19T09:30", "Asia/Shanghai");
    expect(iso).toBe("2026-11-19T01:30:00.000Z");
    expect(localDate(iso, "Asia/Shanghai")).toBe("2026-11-19");
    expect(localTime(iso, "Asia/Shanghai")).toBe("09:30");
  });
  it("handles winter/summer timezone offsets and rejects a nonexistent DST time", () => {
    expect(localDateTimeToISO("2026-07-01T09:00", "America/New_York")).toBe("2026-07-01T13:00:00.000Z");
    expect(localDateTimeToISO("2026-11-19T09:00", "America/New_York")).toBe("2026-11-19T14:00:00.000Z");
    expect(() => localDateTimeToISO("2026-03-08T02:30", "America/New_York")).toThrow();
  });
  it("builds a Monday-based week across year and month boundaries", () => {
    expect(weekDays("2027-01-01")).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("packs intersecting events into readable columns and reuses a lane at an exact boundary", () => {
    const input = [item("a", "2026-11-19T01:00:00Z", "2026-11-19T02:00:00Z"), item("b", "2026-11-19T01:30:00Z", "2026-11-19T02:30:00Z"), item("c", "2026-11-19T02:00:00Z", "2026-11-19T03:00:00Z")];
    const packed = layoutDayEvents(input, "2026-11-19", "Asia/Shanghai");
    expect(packed.map(p => [p.item.id, p.startMinute, p.column, p.columns])).toEqual([["a", 540, 0, 2], ["b", 570, 1, 2], ["c", 600, 0, 2]]);
    expect(input[0].startAt).toBe("2026-11-19T01:00:00Z");
  });
  it("clips a cross-midnight event and omits cancelled and next-day events", () => {
    const cancelled = { ...item("cancelled", "2026-11-18T17:00:00Z", "2026-11-18T18:00:00Z"), status: "cancelled" as const };
    const result = layoutDayEvents([item("overnight", "2026-11-18T15:30:00Z", "2026-11-18T16:30:00Z"), cancelled, item("next", "2026-11-19T16:00:00Z", "2026-11-19T17:00:00Z")], "2026-11-19", "Asia/Shanghai");
    expect(result).toHaveLength(1);
    expect(result[0].startMinute).toBe(0);
    expect(result[0].endMinute).toBe(30);
  });
});
