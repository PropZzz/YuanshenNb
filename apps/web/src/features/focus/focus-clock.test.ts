import { describe, expect, it } from "vitest";
import { remainingSeconds, formatTimer } from "./focus-clock";

describe("wall clock focus timer", () => {
  it("recovers elapsed background time from its absolute deadline", () => {
    const deadline = Date.parse("2026-11-19T02:25:00Z");
    expect(remainingSeconds(deadline, Date.parse("2026-11-19T02:00:00Z"))).toBe(1500);
    expect(remainingSeconds(deadline, Date.parse("2026-11-19T02:17:10Z"))).toBe(470);
    expect(remainingSeconds(deadline, Date.parse("2026-11-19T03:00:00Z"))).toBe(0);
  });
  it("formats a stable padded timer without negative values", () => {
    expect(formatTimer(1500)).toBe("25:00");
    expect(formatTimer(9)).toBe("00:09");
    expect(formatTimer(-2)).toBe("00:00");
  });
});
