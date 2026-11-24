import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiComponents } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import { useAuthStore } from "@/stores/auth-store";
import { FocusPage } from "./focus-page";
import { useFocusSession } from "./focus-session";

const profile: ApiComponents["UserProfile"] = { id: "calendar-focus-user", displayName: "专注测试", email: "focus@example.com", timezone: "Asia/Shanghai", themeMode: "light", createdAt: "2026-11-24T00:00:00Z", updatedAt: "2026-11-24T00:00:00Z" };
type Item = ApiComponents["ScheduleItemDTO"];
function item(id: string, startAt: string, endAt: string, status: Item["status"] = "planned"): Item {
  return { id, userId: profile.id, title: id, notes: "", category: "deep_work", cognitiveLoad: "high", flexibility: "flexible", status, startAt, endAt, durationMinutes: (Date.parse(endAt) - Date.parse(startAt)) / 60_000, reminderMinutes: 0, createdAt: profile.createdAt, updatedAt: profile.updatedAt };
}
const current = () => item("正在进行的日历事项", "2026-11-24T02:00:00Z", "2026-11-24T03:00:00Z");
const next = () => item("最近的下一项", "2026-11-24T03:00:00Z", "2026-11-24T03:30:00Z");
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
let items: Item[], cache: QueryClient, scheduleRequests: URL[], pendingPatch: (() => void) | undefined;
let deferPatch = false;
let failPreviousDay = false;
function mount() {
  cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={cache}><MemoryRouter><FocusPage /></MemoryRouter></QueryClientProvider>);
}
const title = () => screen.getByRole("heading", { level: 1 }).textContent;
async function refresh() { await act(async () => { await cache.invalidateQueries({ queryKey: queryKeys.schedule.itemsRoot }); await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function moveTo(time: string) { await act(async () => { vi.setSystemTime(new Date(time)); vi.advanceTimersByTime(1000); }); }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-11-24T02:30:00Z"));
  useAuthStore.getState().setSession("focus-token", profile);
  useFocusSession.getState().clear(); useFocusSession.getState().setMode("flow");
  items = []; scheduleRequests = []; deferPatch = false; pendingPatch = undefined; failPreviousDay = false;
  vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    if (request.method === "PATCH") {
      const { status } = await request.json() as { status: Item["status"] };
      const target = items.find(candidate => candidate.id === decodeURIComponent(url.pathname.split("/").at(-1)!))!;
      if (deferPatch) await new Promise<void>(resolve => { pendingPatch = resolve; });
      target.status = status;
      return json({ item: target, baselineLocalDay: "2026-11-24", baselineVersion: "v" });
    }
    if (url.pathname.endsWith("/schedule/items")) {
      scheduleRequests.push(url);
      if (failPreviousDay && url.searchParams.get("from") === "2026-11-23T16:00:00.000Z") return new Response("暂时无法读取原日程", { status: 503 });
      const from = Date.parse(url.searchParams.get("from")!), to = Date.parse(url.searchParams.get("to")!);
      return json({ items: items.filter(candidate => Date.parse(candidate.startAt) < to && Date.parse(candidate.endAt) > from && candidate.status !== "cancelled"), baselineLocalDay: "2026-11-24", baselineVersion: "v" });
    }
    if (url.pathname.endsWith("/rescue/history")) return json({ snapshots: [] });
    if (url.pathname.endsWith("/workspaces")) return json({ workspaces: [] });
    return json({ localDay: "2026-11-24", timezone: profile.timezone, computedAt: profile.createdAt, score: 55, tier: "steady", dataFreshness: "baseline_only", drivers: { summary: "服务端节律基线" }, diagnostics: { baselineReadyDays: 0 }, focusShields: [], hourlyCurve: [] });
  }));
});
afterEach(() => { cleanup(); cache?.clear(); useAuthStore.getState().clearSession(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("focus follows the live calendar", () => {
  it("selects the real current interval ahead of expired and future in-progress statuses", async () => {
    items = [item("过期但仍标记进行中", "2026-11-24T00:00:00Z", "2026-11-24T01:00:00Z", "in_progress"), next(), current()];
    useFocusSession.getState().choose(profile.id, items[0].id);
    mount(); await screen.findByRole("heading", { level: 1 });
    expect(title()).toBe(current().title);
    expect(screen.getByLabelText("日历关联状态").textContent).toContain("正在进行");
  });

  it("chooses the nearest valid future item across local dates and shows its actual date", async () => {
    const future = item("后天的日历事项", "2026-11-26T01:00:00Z", "2026-11-26T01:45:00Z");
    items = [item("更晚的事项", "2026-11-27T01:00:00Z", "2026-11-27T02:00:00Z"), future, item("已完成", "2026-11-24T03:00:00Z", "2026-11-24T04:00:00Z", "completed")];
    mount(); await screen.findByRole("heading", { name: future.title });
    expect(screen.getByLabelText("日历关联状态").textContent).toContain("下一项");
    expect(screen.getByLabelText("当前事项时间").textContent).toContain("11月26日");
    expect(screen.getByRole("link", { name: "在智能日历中查看当前事项" }).getAttribute("href")).toContain("day=2026-11-26");
    expect(scheduleRequests.every(url => Date.parse(url.searchParams.get("to")!) - Date.parse(url.searchParams.get("from")!) <= 62 * 86_400_000)).toBe(true);
  });

  it("advances an idle card at its end time without carrying the previous paused timer", async () => {
    items = [current(), next()];
    mount(); await screen.findByRole("heading", { name: current().title });
    fireEvent.click(screen.getByRole("button", { name: "开始专注" }));
    await screen.findByRole("button", { name: "暂停专注" });
    await moveTo("2026-11-24T02:31:00Z");
    fireEvent.click(screen.getByRole("button", { name: "暂停专注" }));
    expect(screen.getByRole("timer").textContent).toBe("01:01");
    await moveTo("2026-11-24T03:00:00Z");
    expect(title()).toBe(next().title);
    expect(screen.getByRole("timer").textContent).toBe("00:00");
  });

  it("updates the local day and nearest item at midnight even while idle", async () => {
    vi.setSystemTime(new Date("2026-11-24T15:59:58Z"));
    items = [item("午夜之前", "2026-11-24T15:00:00Z", "2026-11-24T16:00:00Z"), item("午夜之后", "2026-11-24T16:00:00Z", "2026-11-24T17:00:00Z")];
    mount(); await screen.findByRole("heading", { name: "午夜之前" });
    await moveTo("2026-11-24T16:00:01Z");
    await screen.findByRole("heading", { name: "午夜之后" });
    expect(scheduleRequests.some(url => url.searchParams.get("from") === "2026-11-24T16:00:00.000Z")).toBe(true);
  });

  it("responds to calendar invalidation when a nearer item is added or edited", async () => {
    items = [next()]; mount(); await screen.findByRole("heading", { name: next().title });
    items = [next(), current()]; await refresh();
    expect(title()).toBe(current().title);
    items[1] = { ...items[1], title: "日历中更新的标题", category: "meeting", cognitiveLoad: "low", durationMinutes: 20 };
    await refresh();
    expect(title()).toBe("日历中更新的标题");
    expect(screen.getByText("轻量任务")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "任务倒计时" }));
    expect(screen.getByRole("timer").textContent).toBe("20:00");
  });

  it("keeps a running session attached to its original item after midnight and through a calendar refresh", async () => {
    vi.setSystemTime(new Date("2026-11-24T15:59:00Z"));
    items = [item("仍在专注的原事项", "2026-11-24T15:00:00Z", "2026-11-24T16:00:00Z"), item("次日的新事项", "2026-11-24T16:00:00Z", "2026-11-24T17:00:00Z")];
    const first = mount(); await screen.findByRole("heading", { name: "仍在专注的原事项" });
    fireEvent.click(screen.getByRole("button", { name: "开始专注" })); await screen.findByRole("button", { name: "暂停专注" });
    await moveTo("2026-11-24T16:01:00Z"); await refresh();
    expect(title()).toBe("仍在专注的原事项");
    expect(screen.getByLabelText("日历关联状态").textContent).toContain("本次专注");
    expect(screen.getByRole("timer").textContent).toBe("02:01");
    first.unmount(); mount();
    await screen.findByRole("heading", { name: "仍在专注的原事项" });
    expect(screen.getByRole("button", { name: "暂停专注" })).toBeTruthy();
  });

  it("blocks starting another item until a cross-midnight running session can be verified", async () => {
    vi.setSystemTime(new Date("2026-11-24T15:59:00Z"));
    items = [{ ...item("still-running", "2026-11-24T15:00:00Z", "2026-11-24T16:00:00Z"), title: "仍在计时的事项" }, { ...item("following", "2026-11-24T16:00:00Z", "2026-11-24T17:00:00Z"), title: "后续事项" }];
    mount(); await screen.findByRole("heading", { name: "仍在计时的事项" });
    fireEvent.click(screen.getByRole("button", { name: "开始专注" })); await screen.findByRole("button", { name: "暂停专注" });
    failPreviousDay = true; await moveTo("2026-11-24T16:00:01Z"); await refresh();
    expect(await screen.findByRole("button", { name: "重新加载" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "后续事项" })).toBeNull();
    expect(useFocusSession.getState().itemId).toBe("still-running");
    expect(useFocusSession.getState().startedAt).not.toBeNull();
    failPreviousDay = false; fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByRole("heading", { name: "仍在计时的事项" })).toBeTruthy();
    expect(screen.getByRole("timer").textContent).not.toBe("00:00");
  });

  it.each(["completed", "cancelled"] as const)("stops the old session explicitly after its item becomes %s", async status => {
    items = [current(), next()]; mount(); await screen.findByRole("heading", { name: current().title });
    fireEvent.click(screen.getByRole("button", { name: "开始专注" })); await screen.findByRole("button", { name: "暂停专注" });
    await moveTo("2026-11-24T02:31:00Z");
    items[0].status = status; await refresh();
    expect(title()).toBe(next().title);
    expect(screen.getByRole("timer").textContent).toBe("00:00");
    expect(screen.queryByRole("button", { name: "暂停专注" })).toBeNull();
    expect(screen.getByText(/日程已变更.*计时已停止/)).toBeTruthy();
    expect(useFocusSession.getState().startedAt).toBeNull();
  });

  it("binds a delayed start response to the item that was clicked, even when the next interval starts", async () => {
    vi.setSystemTime(new Date("2026-11-24T02:59:59Z"));
    items = [current(), next()]; deferPatch = true;
    mount(); await screen.findByRole("heading", { name: current().title });
    fireEvent.click(screen.getByRole("button", { name: "开始专注" }));
    await waitFor(() => expect(pendingPatch).toBeTypeOf("function"));
    await moveTo("2026-11-24T03:00:01Z");
    await act(async () => { pendingPatch!(); });
    await screen.findByRole("button", { name: "暂停专注" });
    expect(useFocusSession.getState().itemId).toBe(current().id);
    expect(title()).toBe(current().title);
  });

  it("ignores a previous account's delayed start response", async () => {
    items = [current()]; deferPatch = true;
    mount(); await screen.findByRole("heading", { name: current().title });
    fireEvent.click(screen.getByRole("button", { name: "开始专注" }));
    await waitFor(() => expect(pendingPatch).toBeTypeOf("function"));
    await act(async () => { useAuthStore.getState().setSession("other-token", { ...profile, id: "other-account" }); pendingPatch!(); });
    await waitFor(() => expect(useFocusSession.getState().startedAt).toBeNull());
    expect(useFocusSession.getState().ownerId).toBeNull();
    expect(screen.queryByRole("heading", { name: current().title })).toBeNull();
  });
});
