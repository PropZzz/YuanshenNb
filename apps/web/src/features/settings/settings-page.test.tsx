import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ApiComponents } from "@/api/client";
import { useAuthStore } from "@/stores/auth-store";
import { SettingsPage } from "./settings-page";

const initialUser: ApiComponents["UserProfile"] = { id: "user-1", displayName: "测试用户", email: "person@example.com", timezone: "Asia/Shanghai", themeMode: "light", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" };
const initialProfile: ApiComponents["EnergyProfileDTO"] = { userId: "user-1", chronotype: "balanced", workStartMinute: 540, workEndMinute: 1080, minRecoveryBufferMin: 15, preferredFocusWindows: [], updatedAt: "2026-11-01T00:00:00Z" };
const workspace: ApiComponents["WorkspaceDTO"] = { id: "workspace-1", name: "架构协作组", description: "", inviteCode: "ABC123", ownerId: "user-1", memberCount: 2, myRole: "owner", myPrivacyLevel: "energy_tier", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" };
const caches: QueryClient[] = []; let calls: Request[]; let currentUser: ApiComponents["UserProfile"];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function mount() { const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); caches.push(cache); render(<QueryClientProvider client={cache}><MemoryRouter><SettingsPage /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => {
  calls = []; currentUser = { ...initialUser }; useAuthStore.getState().setSession("access", currentUser);
  vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
    calls.push(request); const path = new URL(request.url).pathname;
    if (request.method === "PATCH" && path === "/api/v1/auth/me") { currentUser = { ...currentUser, ...JSON.parse(await request.clone().text()) }; return json(currentUser); }
    if (path === "/api/v1/auth/me") return json(currentUser);
    if (path === "/api/v1/energy/profile") return request.method === "PUT" ? json({ ...initialProfile, ...JSON.parse(await request.clone().text()) }) : json(initialProfile);
    if (request.method === "PATCH") return json({ workspaceId: workspace.id, userId: currentUser.id, displayName: currentUser.displayName, timezone: currentUser.timezone, role: "owner", joinedAt: initialUser.createdAt, privacyLevel: JSON.parse(await request.clone().text()).privacyLevel } satisfies ApiComponents["WorkspaceMemberDTO"]);
    return json({ workspaces: [workspace] } satisfies ApiComponents["WorkspaceListResponse"]);
  }));
});
afterEach(() => { cleanup(); caches.splice(0).forEach(cache => cache.clear()); vi.unstubAllGlobals(); useAuthStore.getState().clearSession(); document.documentElement.classList.remove("dark"); });

describe("account, rhythm and workspace privacy settings", () => {
  it("patches the actual account name and timezone and updates the authenticated profile only after success", async () => {
    mount(); await screen.findByDisplayValue("测试用户"); const user = userEvent.setup();
    await user.clear(screen.getByLabelText("显示名称")); await user.type(screen.getByLabelText("显示名称"), "新的显示名");
    await user.clear(screen.getByLabelText("所在时区")); await user.type(screen.getByLabelText("所在时区"), "Europe/Paris");
    await user.click(screen.getByRole("button", { name: "保存账户信息" })); await screen.findByText("账户信息已保存");
    const request = calls.find(call => call.method === "PATCH" && new URL(call.url).pathname === "/api/v1/auth/me")!;
    expect(JSON.parse(await request.clone().text())).toMatchObject({ displayName: "新的显示名", timezone: "Europe/Paris" });
    expect(useAuthStore.getState().user?.timezone).toBe("Europe/Paris");
  });
  it("persists a theme selection through the account API", async () => {
    mount(); await screen.findByDisplayValue("测试用户"); await userEvent.setup().click(screen.getByRole("button", { name: "深色" }));
    await waitFor(() => expect(useAuthStore.getState().themeMode).toBe("dark"));
    const request = calls.find(call => call.method === "PATCH")!; expect(JSON.parse(await request.clone().text())).toEqual({ themeMode: "dark" });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
  it("puts contracted work hours, chronotype, recovery buffer and editable focus windows", async () => {
    mount(); await screen.findByLabelText("工作开始"); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "选择工作开始" }));
    expect(screen.getByRole("listbox", { name: "小时" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "确认时间" }));
    fireEvent.change(screen.getByLabelText("工作开始"), { target: { value: "08:30" } }); fireEvent.change(screen.getByLabelText("工作结束"), { target: { value: "17:30" } });
    await user.click(screen.getByRole("radio", { name: /夜猫型/ })); await user.clear(screen.getByLabelText("最小恢复缓冲（分钟）")); await user.type(screen.getByLabelText("最小恢复缓冲（分钟）"), "20");
    await user.click(screen.getByRole("button", { name: "添加专注窗口" }));
    fireEvent.change(screen.getByLabelText("专注窗口 1 开始"), { target: { value: "09:45" } }); fireEvent.change(screen.getByLabelText("专注窗口 1 结束"), { target: { value: "11:15" } });
    await user.click(screen.getByRole("button", { name: "保存工作节律" })); await screen.findByText("工作节律已保存");
    const request = calls.find(call => call.method === "PUT")!;
    expect(JSON.parse(await request.clone().text())).toEqual({ workStartMinute: 510, workEndMinute: 1050, chronotype: "night_owl", minRecoveryBufferMin: 20, preferredFocusWindows: [{ startMinute: 585, endMinute: 675 }] });
  });
  it("saves workspace privacy independently to the corresponding workspace endpoint", async () => {
    mount(); const select = await screen.findByLabelText("架构协作组的共享范围"); await userEvent.setup().selectOptions(select, "busy_only"); await screen.findByText("共享范围已保存");
    const request = calls.find(call => call.method === "PATCH")!; expect(new URL(request.url).pathname).toBe("/api/v1/workspaces/workspace-1/me");
    expect(JSON.parse(await request.clone().text())).toEqual({ privacyLevel: "busy_only" });
  });
  it("does not claim success or change the stored profile after a failed save", async () => {
    const fetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => request.method === "PATCH" ? json({ type: "https://shixu.app/errors/SERVICE_UNAVAILABLE", code: "SERVICE_UNAVAILABLE", title: "Unavailable", status: 503, detail: "保存未完成，请重试" }, 503) : fetch(request)));
    mount(); await screen.findByDisplayValue("测试用户"); const user = userEvent.setup(); await user.clear(screen.getByLabelText("显示名称")); await user.type(screen.getByLabelText("显示名称"), "尚未保存"); await user.click(screen.getByRole("button", { name: "保存账户信息" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("保存未完成"));
    expect(screen.queryByText("账户信息已保存")).toBeNull(); expect(useAuthStore.getState().user?.displayName).toBe("测试用户");
  });
});
