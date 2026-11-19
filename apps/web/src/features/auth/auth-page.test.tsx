import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AuthPage } from "./auth-page";
import { useAuthStore } from "@/stores/auth-store";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useAuthStore.getState().clearSession(); });
describe("real authentication form", () => {
  it("collects credentials, posts to the contracted login endpoint, and stores only access credentials in memory", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accessToken: "access", refreshToken: "never-persist-this", expiresInSeconds: 900, user: { id: "1", displayName: "测试账号", email: "person@example.com", timezone: "Asia/Shanghai", themeMode: "light", createdAt: "2026-11-19T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    render(<MemoryRouter><AuthPage mode="login" /></MemoryRouter>);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("邮箱地址"), "person@example.com");
    await user.type(screen.getByLabelText("密码", { exact: true }), "a-real-password");
    await user.click(screen.getByRole("button", { name: "登录并进入工作台" }));
    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe("access"));
    const request = fetch.mock.calls[0][0] as Request;
    expect(new URL(request.url, "http://localhost").pathname).toBe("/api/v1/auth/login");
    expect(JSON.parse(await request.clone().text())).toMatchObject({ email: "person@example.com", password: "a-real-password" });
    expect(localStorage.length).toBe(0);
  });
  it("displays a server credential error instead of navigating to a fake authenticated view", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 401, type: "https://shixu.app/errors/INVALID_CREDENTIALS", code: "INVALID_CREDENTIALS", title: "Unauthorized", detail: "邮箱或密码不正确" }), { status: 401, headers: { "Content-Type": "application/problem+json" } })));
    render(<MemoryRouter><AuthPage mode="login" /></MemoryRouter>);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("邮箱地址"), "person@example.com");
    await user.type(screen.getByLabelText("密码", { exact: true }), "wrong-password");
    await user.click(screen.getByRole("button", { name: "登录并进入工作台" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("邮箱或密码不正确"));
    expect(useAuthStore.getState().status).toBe("unauthenticated");
  });
});
