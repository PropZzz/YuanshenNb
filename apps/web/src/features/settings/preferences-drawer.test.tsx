import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiComponents } from "@/api/client";
import { useAuthStore } from "@/stores/auth-store";
import { PreferencesDrawer } from "./preferences-drawer";

const user: ApiComponents["UserProfile"] = { id: "preferences-user", displayName: "测试用户", email: "preference@example.com", timezone: "Asia/Shanghai", themeMode: "light", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" };
const caches: QueryClient[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function mount(onClose = vi.fn()) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  caches.push(cache);
  return { ...render(<QueryClientProvider client={cache}><PreferencesDrawer open onClose={onClose} /></QueryClientProvider>), onClose };
}
beforeEach(() => { useAuthStore.getState().setSession("access", { ...user }); });
afterEach(() => { cleanup(); caches.splice(0).forEach(cache => cache.clear()); vi.unstubAllGlobals(); useAuthStore.getState().clearSession(); document.documentElement.classList.remove("dark"); });

describe("original independent preferences drawer", () => {
  it("previews a theme without persisting it and restores the saved theme on close", async () => {
    const fetch = vi.fn(async () => json(user)); vi.stubGlobal("fetch", fetch);
    const { onClose } = mount(); const event = userEvent.setup();
    await event.click(screen.getByRole("button", { name: "深色模式" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(useAuthStore.getState().user?.themeMode).toBe("light");
    expect(fetch.mock.calls.length).toBe(0);
    await event.click(within(screen.getByRole("dialog")).getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
  it("keeps every original settings section visible and unavailable capabilities disabled", () => {
    mount();
    for (const name of ["语言与国际化", "系统通知与外部提醒", "外观模式与强调色", "时序引擎行为偏好"]) expect(screen.getByRole("heading", { name })).toBeTruthy();
    expect((screen.getByRole("button", { name: "English" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: "桌面系统推送通知" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "截止橙 #E5A15B" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("重排前显示代价比较确认")).toBeTruthy();
  });
  it("persists only the supported theme after explicit save", async () => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => { requests.push(request); return json({ ...user, themeMode: "dark" }); }));
    const { onClose } = mount(); const event = userEvent.setup();
    await event.click(screen.getByRole("button", { name: "深色模式" }));
    await event.click(screen.getByRole("button", { name: "保存并应用配置" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(requests.length).toBe(1); expect(requests[0].method).toBe("PATCH");
    expect(new URL(requests[0].url).pathname).toBe("/api/v1/auth/me");
    expect(JSON.parse(await requests[0].clone().text())).toEqual({ themeMode: "dark" });
    expect(useAuthStore.getState().user?.themeMode).toBe("dark");
  });
  it("leaves an unsuccessful save open and rolls the preview back when dismissed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ type: "https://shixu.app/errors/SERVICE_UNAVAILABLE", code: "SERVICE_UNAVAILABLE", title: "Unavailable", status: 503, detail: "外观保存失败" }, 503)));
    const { onClose } = mount(); const event = userEvent.setup();
    await event.click(screen.getByRole("button", { name: "深色模式" })); await event.click(screen.getByRole("button", { name: "保存并应用配置" }));
    expect((await screen.findByRole("alert")).textContent).toContain("外观保存失败");
    expect(onClose).not.toHaveBeenCalled(); expect(useAuthStore.getState().themeMode).toBe("light");
    await event.click(within(screen.getByRole("dialog")).getByRole("button", { name: "关闭" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
