import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ApiComponents } from "@/api/client";
import { useAuthStore } from "@/stores/auth-store";
import { ProfilePage } from "./profile-page";

const user: ApiComponents["UserProfile"] = { id: "profile-user", displayName: "真实用户", email: "profile@example.com", timezone: "Asia/Shanghai", themeMode: "light", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" };
const profile: ApiComponents["EnergyProfileDTO"] = { userId: user.id, chronotype: "balanced", workStartMinute: 540, workEndMinute: 1080, minRecoveryBufferMin: 15, preferredFocusWindows: [], updatedAt: user.updatedAt };
const caches: QueryClient[] = []; let requests: Request[];
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
function mount() { const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); caches.push(cache); render(<QueryClientProvider client={cache}><MemoryRouter><ProfilePage /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => {
  requests = []; useAuthStore.getState().setSession("access", { ...user });
  vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
    requests.push(request); const path = new URL(request.url).pathname;
    if (path === "/api/v1/auth/me") return json(request.method === "PATCH" ? { ...user, ...JSON.parse(await request.clone().text()) } : user);
    if (path === "/api/v1/energy/profile") return json(profile);
    if (path === "/api/v1/workspaces") return json({ workspaces: [] });
    if (path === "/api/v1/schedule/items") return json({ items: [], baselineVersion: "1" });
    return json({ localDay: "2026-11-19", timezone: user.timezone, computedAt: user.updatedAt, score: 37, tier: "strained", dataFreshness: "baseline_only", drivers: { summary: "基线估算" }, diagnostics: { baselineReadyDays: 0 }, hourlyCurve: [], focusShields: [] });
  }));
});
afterEach(() => { cleanup(); caches.splice(0).forEach(cache => cache.clear()); vi.unstubAllGlobals(); useAuthStore.getState().clearSession(); });

describe("separate original profile surface", () => {
  it("shows the original profile modules without fabricating historical statistics", async () => {
    mount(); await screen.findByRole("heading", { name: "真实用户" });
    for (const name of ["专注时长趋势与认知能量震荡", "番茄钟与认知节律微调", "免打扰与认知护盾策略", "日历与外部协同双向同步", "工作台外观与快捷指令"]) expect(screen.getByRole("heading", { name })).toBeTruthy();
    expect(screen.getByText("暂无跨日专注与能量记录")).toBeTruthy();
    expect(screen.queryByText("94.2")).toBeNull(); expect(screen.queryByText("连续专注第 42 天")).toBeNull();
    expect(screen.getByRole("button", { name: "数字工牌" })).toBeTruthy();
  });
  it("edits the actual account in its own drawer and saves through the account API", async () => {
    mount(); await screen.findByRole("heading", { name: "真实用户" }); const event = userEvent.setup();
    await event.click(screen.getByRole("button", { name: "修改昵称" }));
    const drawer = screen.getByRole("dialog"); await event.clear(within(drawer).getByLabelText("显示名称")); await event.type(within(drawer).getByLabelText("显示名称"), "修改后的用户");
    await event.click(within(drawer).getByRole("button", { name: "保存账户信息" }));
    await waitFor(() => expect(useAuthStore.getState().user?.displayName).toBe("修改后的用户"));
    const request = requests.find(item => item.method === "PATCH")!;
    expect(JSON.parse(await request.clone().text())).toEqual({ displayName: "修改后的用户", timezone: "Asia/Shanghai" });
  });
  it("applies atmospheric tone and compact mode locally per account", async () => {
    mount(); await screen.findByRole("heading", { name: "真实用户" }); const event = userEvent.setup();
    await event.click(screen.getByRole("button", { name: "墨玉青绿" }));
    await event.click(screen.getByRole("checkbox", { name: /超紧凑高密度模式/ }));
    expect(document.documentElement.dataset.profileTone).toBe("jade");
    expect(document.documentElement.dataset.profileCompact).toBe("true");
    expect(JSON.parse(localStorage.getItem(`shixu:profile-appearance:${user.id}`)!)).toEqual({ tone: "jade", compact: true });
  });
});
