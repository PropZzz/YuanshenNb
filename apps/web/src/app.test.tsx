import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { useAuthStore } from "@/stores/auth-store";

vi.mock("@/api/use-realtime", () => ({
  useRealtime: () => ({
    state: "connected",
    alert: null,
    events: [],
    unreadCount: 0,
    dismissAlert: () => {},
    markAllRead: () => {},
    clearFeed: () => {},
  }),
}));

beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAuthStore.getState().clearSession();
  document.documentElement.classList.remove("dark");
});

const profile = {
  id: "person-1",
  displayName: "测试账号",
  email: "test@example.com",
  timezone: "Asia/Shanghai",
  themeMode: "light" as const,
  createdAt: "2026-11-19T00:00:00Z",
  updatedAt: "2026-11-19T00:00:00Z",
};

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

it("guards the workbench and exposes the actual login form to a signed-out visitor", async () => {
  useAuthStore.getState().markUnauthenticated();
  window.history.replaceState({}, "", "/focus");
  render(<App />);
  expect(await screen.findByLabelText("邮箱地址")).toBeTruthy();
  expect(window.location.pathname).toBe("/login");
});

it("renders the split-screen account passport without disabled guest entry buttons", async () => {
  useAuthStore.getState().markUnauthenticated();
  window.history.replaceState({}, "", "/login");
  render(<App />);
  expect(await screen.findByRole("heading", { name: "账户通行证" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "以游客身份继续" })).toBeNull();
  expect(screen.getByRole("button", { name: "返回上一页" })).toBeTruthy();
});

it("validates the restored confirmation password before submitting registration", async () => {
  useAuthStore.getState().markUnauthenticated();
  window.history.replaceState({}, "", "/register");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<App />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("显示名称"), "验收账户");
  await user.type(screen.getByLabelText("邮箱地址"), "confirm@example.com");
  await user.type(screen.getByLabelText("密码", { exact: true }), "Example-Password-1");
  await user.type(screen.getByLabelText("确认密码", { exact: true }), "Example-Password-2");
  await user.click(screen.getByRole("button", { name: "创建账号并开始使用" }));
  expect(await screen.findByText("两次输入的密码不一致")).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});

it("shows a compact reference empty state instead of a disabled focus timer", async () => {
  useAuthStore.getState().setSession("access", profile);
  window.history.replaceState({}, "", "/focus");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path.includes("schedule/items")) return respond({ items: [] });
      if (path.includes("rescue/history")) return respond({ snapshots: [] });
      return respond({ detail: "offline" }, 503);
    }),
  );
  render(<App />);
  await screen.findByRole("link", { name: /去安排第一段专注/ }, { timeout: 5_000 });
  expect(screen.queryByRole("timer")).toBeNull();
  expect(screen.getByRole("button", { name: "检查今日日程" })).toBeTruthy();
});

it("lets the reference week strip select the calendar date without writing a schedule", async () => {
  useAuthStore.getState().setSession("access", profile);
  window.history.replaceState({}, "", "/calendar");
  const writes: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (request.method !== "GET") writes.push(path);
      if (path.includes("schedule/items")) return respond({ items: [] });
      if (path.includes("rescue/history")) return respond({ snapshots: [] });
      return respond({ detail: "offline" }, 503);
    }),
  );
  render(<App />);
  const strip = await screen.findByRole("navigation", { name: "本周日期" }, { timeout: 5_000 });
  const dates = [...strip.querySelectorAll("button")];
  expect(dates).toHaveLength(7);
  const target = dates.find(button => button.getAttribute("aria-pressed") === "false")!;
  const chosen = target.querySelector("time")!.dateTime;
  await userEvent.setup().click(target);
  expect((screen.getByLabelText("跳转日期") as HTMLInputElement).value).toBe(chosen);
  expect(target.getAttribute("aria-pressed")).toBe("true");
  expect(writes).toEqual([]);
});

it("opens fatigue protection directly without requiring an urgent task", async () => {
  useAuthStore.getState().setSession("access", profile);
  window.history.replaceState({}, "", "/calendar?rescue=1&trigger=wearable_fatigue");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path.includes("schedule/items")) return respond({ items: [] });
      if (path.includes("rescue/history")) return respond({ snapshots: [] });
      return respond({ detail: "offline" }, 503);
    }),
  );
  render(<App />);
  await screen.findByRole("dialog", { name: "日程救援决策台" });
  expect((screen.getByLabelText("救援原因") as HTMLSelectElement).value).toBe("wearable_fatigue");
  expect(screen.queryByLabelText("紧急任务")).toBeNull();
});

it("saves theme changes through /settings?tab=account into the account endpoint", async () => {
  useAuthStore.getState().setSession("access", profile);
  window.history.replaceState({}, "", "/settings?tab=account");
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (request.method === "PATCH") {
        const body = await request.json();
        bodies.push(body);
        return respond({ ...profile, ...body });
      }
      if (path.endsWith("/auth/me")) return respond(profile);
      if (path.includes("energy/profile")) {
        return respond({
          userId: profile.id,
          chronotype: "balanced",
          workStartMinute: 540,
          workEndMinute: 1080,
          minRecoveryBufferMin: 15,
          preferredFocusWindows: [],
          updatedAt: profile.updatedAt,
        });
      }
      if (path.includes("workspaces")) return respond({ workspaces: [] });
      return respond({ ok: true });
    }),
  );
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "深色" }));
  await waitFor(() => expect(bodies).toEqual([{ themeMode: "dark" }]));
  await waitFor(() => expect(useAuthStore.getState().themeMode).toBe("dark"));
});

it("does not display the previous account's cached schedules after an identity change", async () => {
  useAuthStore.getState().setSession("access", profile);
  window.history.replaceState({}, "", "/focus");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path.includes("schedule/items")) {
        return respond({
          items:
            request.headers.get("Authorization") === "Bearer access"
              ? [
                  {
                    id: "a",
                    title: "只属于甲的日程",
                    category: "deep_work",
                    cognitiveLoad: "high",
                    status: "planned",
                    startAt: "2026-11-19T01:00:00Z",
                    endAt: "2026-11-19T02:00:00Z",
                    durationMinutes: 60,
                  },
                ]
              : [],
        });
      }
      if (path.includes("rescue/history")) return respond({ snapshots: [] });
      return respond({ detail: "offline" }, 503);
    }),
  );
  render(<App />);
  await screen.findByRole("heading", { name: "只属于甲的日程" });
  act(() =>
    useAuthStore
      .getState()
      .setSession("another-access", { ...profile, id: "person-2", displayName: "乙账号" }),
  );
  await waitFor(() => expect(screen.queryByRole("heading", { name: "只属于甲的日程" })).toBeNull());
  expect(await screen.findByRole("link", { name: /去安排第一段专注/ })).toBeTruthy();
});

it("renders 5 core nav items and moves focus to top when navigating to another workbench view", async () => {
  useAuthStore.getState().setSession("access", profile);
  window.history.replaceState({}, "", "/focus");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path.includes("schedule/items")) return respond({ items: [] });
      if (path.includes("rescue/history")) return respond({ snapshots: [] });
      return respond({ detail: "offline" }, 503);
    }),
  );
  render(<App />);
  expect(screen.getByRole("navigation", { name: "主导航" }).querySelectorAll("a")).toHaveLength(5);
  expect(screen.getByRole("navigation", { name: "移动端导航" }).querySelectorAll("a")).toHaveLength(5);
  await userEvent.setup().click(document.querySelector('main a[href="/energy"]')!);
  await screen.findByRole("heading", { name: "情绪与能量追踪" }, { timeout: 5_000 });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("main")));
  expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
});

it("offers an honest empty focus state using server schedules rather than placeholder tasks", async () => {
  useAuthStore.getState().setSession("access", profile);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path.includes("schedule/items")) {
        return respond({ items: [], baselineVersion: "v", baselineLocalDay: "2026-11-19" });
      }
      if (path.includes("rescue/history")) return respond({ snapshots: [] });
      if (path.includes("energy/today")) return respond({ detail: "unavailable" }, 503);
      return respond({ ok: true });
    }),
  );
  window.history.replaceState({}, "", "/focus");
  render(<App />);
  expect(await screen.findByRole("link", { name: /去安排第一段专注/ })).toBeTruthy();
  expect(screen.queryByText("86 分")).toBeNull();
});

it("starts and completes a real task through status mutations", async () => {
  useAuthStore.getState().setSession("access", profile);
  const item = {
    id: "item-1",
    userId: profile.id,
    title: "撰写真实任务",
    notes: "",
    category: "deep_work",
    cognitiveLoad: "high",
    flexibility: "flexible",
    status: "planned",
    startAt: "2026-11-19T02:00:00Z",
    endAt: "2026-11-19T03:00:00Z",
    durationMinutes: 60,
    reminderMinutes: 0,
    createdAt: "2026-11-19T00:00:00Z",
    updatedAt: "2026-11-19T00:00:00Z",
  };
  const statuses: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (request.method === "PATCH") {
        const body = await request.json();
        statuses.push(body.status);
        item.status = body.status;
        return respond({ item, baselineVersion: "v", baselineLocalDay: "2026-11-19" });
      }
      if (path.includes("schedule/items")) {
        return respond({ items: [item], baselineVersion: "v", baselineLocalDay: "2026-11-19" });
      }
      if (path.includes("rescue/history")) return respond({ snapshots: [] });
      if (path.includes("energy/today")) return respond({ detail: "unavailable" }, 503);
      return respond({ ok: true });
    }),
  );
  window.history.replaceState({}, "", "/focus");
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "开始专注" }));
  await waitFor(() => expect(statuses).toEqual(["in_progress"]));
  expect(await screen.findByRole("button", { name: "暂停专注" })).toBeTruthy();
  await user.click(document.querySelector('main a[href="/energy"]')!);
  await user.click(
    screen.getByRole("navigation", { name: "主导航" }).querySelector('a[href="/focus"]')!,
  );
  expect(await screen.findByRole("button", { name: "暂停专注" })).toBeTruthy();
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "完成当前任务" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  await user.click(screen.getByRole("button", { name: "完成当前任务" }));
  await waitFor(() => expect(statuses).toEqual(["in_progress", "completed"]));
});
