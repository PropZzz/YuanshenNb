import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ApiComponents } from "@/api/client";
import { useAuthStore } from "@/stores/auth-store";
import { FocusPage } from "./focus-page";

const profile: ApiComponents["UserProfile"] = { id: "focus-user", displayName: "专注测试", email: "focus@example.com", timezone: "Asia/Shanghai", themeMode: "light", createdAt: "2026-11-19T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z" };
const task = { id: "task-1", userId: profile.id, title: "真实专注任务", notes: "实际任务说明", category: "deep_work", cognitiveLoad: "high", flexibility: "flexible", status: "planned", startAt: "2026-11-19T02:00:00Z", endAt: "2026-11-19T03:00:00Z", durationMinutes: 60, reminderMinutes: 0, createdAt: "2026-11-19T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z" };
const energy = { localDay: "2026-11-19", timezone: "Asia/Shanghai", computedAt: "2026-11-19T06:00:00Z", score: 55, tier: "steady", dataFreshness: "baseline_only", drivers: { sleepRecoveryScore: 30, autonomicDeltaScore: 0, circadianScore: 25, cognitiveLoadDrainScore: 0, recoveryBufferBonusScore: 0, summary: "服务端节律基线" }, diagnostics: { baselineReadyDays: 0 }, focusShields: [], hourlyCurve: [] };
const caches: QueryClient[] = []; let requests: Request[];
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
function Location() { return <output aria-label="当前路径">{useLocation().pathname}</output>; }
function mount() { const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); caches.push(cache); return render(<QueryClientProvider client={cache}><MemoryRouter><FocusPage /><Location /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => {
  localStorage.clear(); requests = []; useAuthStore.getState().setSession("access", profile);
  vi.stubGlobal("fetch", vi.fn(async (request: Request) => { requests.push(request); const path = new URL(request.url).pathname;
    if (path.endsWith("/schedule/items")) return json({ items: [task, { ...task, id: "task-2", title: "下一项真实任务", startAt: "2026-11-19T04:00:00Z", endAt: "2026-11-19T05:00:00Z" }], baselineVersion: "v", baselineLocalDay: "2026-11-19" });
    if (path.endsWith("/rescue/history")) return json({ snapshots: [] });
    return json(energy);
  }));
});
afterEach(() => { cleanup(); caches.splice(0).forEach(cache => cache.clear()); vi.unstubAllGlobals(); useAuthStore.getState().clearSession(); });

describe("restored local focus tools", () => {
  it("adds and completes task-isolated local steps without writing schedule changes", async () => {
    mount(); await screen.findByRole("heading", { name: task.title }); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "添加子步骤" }));
    await user.type(screen.getByLabelText("子步骤内容"), "整理真实材料"); await user.click(screen.getByRole("button", { name: "保存子步骤" }));
    const step = screen.getByRole("checkbox", { name: "整理真实材料" }); await user.click(step);
    expect((step as HTMLInputElement).checked).toBe(true); expect(screen.getByText("1 / 1 已完成")).toBeTruthy();
    const stored = JSON.parse(localStorage.getItem(`shixu:focus-steps:${profile.id}:task-1`) ?? "[]");
    expect(stored[0]).toMatchObject({ text: "整理真实材料", done: true });
    await user.click(screen.getByRole("button", { name: /下一项真实任务.*选择专注/ }));
    expect(screen.queryByRole("checkbox", { name: "整理真实材料" })).toBeNull();
    expect(requests.every(request => request.method === "GET")).toBe(true);
  });
  it("captures fleeting notes on Enter and reloads only the current account's local notes", async () => {
    const first = mount(); await screen.findByRole("heading", { name: task.title });
    await userEvent.setup().type(screen.getByLabelText("快速记录闪念备忘"), "稍后核对材料{Enter}");
    expect(screen.getByText("稍后核对材料")).toBeTruthy(); first.unmount();
    mount(); expect(await screen.findByText("稍后核对材料")).toBeTruthy();
    await act(async () => useAuthStore.getState().setSession("next-access", { ...profile, id: "another-account" }));
    expect(screen.queryByText("稍后核对材料")).toBeNull();
  });
  it("records a quick subjective feeling locally then opens energy without changing the server score", async () => {
    mount(); await screen.findByRole("heading", { name: task.title });
    await userEvent.setup().click(screen.getByRole("button", { name: "☕ 疲惫" }));
    expect(screen.getByLabelText("当前路径").textContent).toBe("/energy");
    const stored = JSON.parse(localStorage.getItem(`shixu:mood-journal:${profile.id}`) ?? "[]");
    expect(stored[0]).toMatchObject({ emotion: "Fatigued", kind: "checkin" });
    expect(requests.every(request => request.method === "GET")).toBe(true);
  });
  it("offers four honest synthesized soundscapes and reports unsupported audio instead of pretending to play", async () => {
    vi.stubGlobal("AudioContext", undefined); mount(); await screen.findByRole("heading", { name: task.title });
    const section = screen.getByRole("region", { name: "沉浸白噪音伴侣" });
    for (const name of ["森林细雨", "咖啡杂音", "深海波动", "布朗噪声"]) expect(within(section).getByRole("button", { name: new RegExp(name) })).toBeTruthy();
    fireEvent.change(within(section).getByLabelText("白噪音音量"), { target: { value: "35" } });
    await userEvent.setup().click(within(section).getByRole("button", { name: /森林细雨/ }));
    expect((await within(section).findByRole("alert")).textContent).toContain("声音");
    expect(within(section).queryByText(/播放中/)).toBeNull();
  });
  it("offers a reversible local immersion view while preserving the existing task timer", async () => {
    mount(); await screen.findByRole("heading", { name: task.title }); const user = userEvent.setup();
    const before = screen.getByRole("timer", { name: "本次专注计时" }).textContent;
    await user.click(screen.getByRole("button", { name: "沉浸 · 勿扰" }));
    expect(screen.getByText(/不会屏蔽系统通知/)).toBeTruthy(); expect(screen.getByRole("timer").textContent).toBe(before);
    await user.click(screen.getByRole("button", { name: "退出沉浸" }));
    expect(screen.queryByRole("button", { name: "退出沉浸" })).toBeNull();
    expect(requests.every(request => request.method === "GET")).toBe(true);
  });
  it("shows real navigation for microtasks and teams without invented gaps or online peers", async () => {
    mount(); await screen.findByRole("heading", { name: task.title });
    expect(screen.getByRole("heading", { name: "时间晶体碎片填补" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /前往微任务/ }).getAttribute("href")).toBe("/microtasks");
    expect(screen.getByRole("link", { name: /前往团队协作/ }).getAttribute("href")).toBe("/team");
    expect(screen.queryByText(/正在静默冲刺|探测到 15m 缝隙/)).toBeNull();
  });
  it("lists real user-saved local short microtasks when present without modifying schedules", async () => {
    localStorage.setItem(`shixu:local-workspace:v1:${profile.id}`, JSON.stringify({
      version: 1,
      tasks: [{ id: "m1", title: "核对文档链接", description: "", duration: 10, priority: "P2", load: "low", tags: [], completed: false, createdAt: "2026-11-19T00:00:00Z" }],
      goals: [],
      drafts: {},
    }));
    mount(); await screen.findByRole("heading", { name: task.title });
    expect(screen.getByText("核对文档链接")).toBeTruthy();
    expect(screen.getByRole("link", { name: "将 核对文档链接 排入日历" }).getAttribute("href")).toContain("/calendar?new=1");
  });
});
