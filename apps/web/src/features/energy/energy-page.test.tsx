import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ApiComponents } from "@/api/client";
import { localDate, shiftDay } from "@/lib/datetime";
import { useAuthStore } from "@/stores/auth-store";
import { EnergyPage } from "./energy-page";

const snapshot: ApiComponents["EnergyTodayResponse"] = {
  localDay: "2026-11-19",
  timezone: "Asia/Shanghai",
  computedAt: "2026-11-19T06:00:00Z",
  score: 37,
  tier: "strained",
  dataFreshness: "baseline_only",
  drivers: {
    sleepRecoveryScore: 30,
    autonomicDeltaScore: 0,
    circadianScore: 7,
    cognitiveLoadDrainScore: 0,
    recoveryBufferBonusScore: 0,
    summary: "未连接穿戴，当前为节律基线估算",
  },
  diagnostics: { baselineReadyDays: 0 },
  focusShields: [],
  hourlyCurve: [
    { hourStartAt: "2026-11-19T01:00:00Z", score: 52, tier: "strained" },
    { hourStartAt: "2026-11-19T02:00:00Z", score: 56, tier: "steady" },
    { hourStartAt: "2026-11-19T03:00:00Z", score: 50, tier: "strained" },
  ],
};

const caches: QueryClient[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  caches.push(cache);
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <EnergyPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.getState().setSession("access", {
    id: "user-1",
    displayName: "测试用户",
    email: "person@example.com",
    timezone: "Asia/Shanghai",
    themeMode: "light",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  });
});

afterEach(() => {
  cleanup();
  caches.splice(0).forEach(cache => cache.clear());
  vi.unstubAllGlobals();
  useAuthStore.getState().clearSession();
});

describe("wearable energy insights", () => {
  it("records local moods when randomUUID is unavailable on an HTTP deployment", async () => {
    vi.stubGlobal("crypto", {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) =>
        new URL(request.url).pathname.includes("/schedule/items")
          ? json({ items: [] })
          : json(snapshot),
      ),
    );
    mount();
    await screen.findByRole("meter");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "心境与呼吸" }));
    await user.click(await screen.findByRole("button", { name: "记录打卡" }));
    expect(await screen.findByText("已保存到此浏览器，未上传服务器。")).toBeTruthy();
    const entries = JSON.parse(localStorage.getItem("shixu:mood-journal:user-1") ?? "[]");
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toEqual(expect.any(String));
    expect(entries[0].id.length).toBeGreaterThan(0);
  });

  it("records an account-isolated local mood without overwriting measured energy or calling a write API", async () => {
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        requests.push(request);
        return new URL(request.url).pathname.includes("/schedule/items")
          ? json({ items: [] })
          : json(snapshot);
      }),
    );
    mount();
    await screen.findByRole("meter");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "心境与呼吸" }));
    await user.click(await screen.findByRole("button", { name: "轻微疲倦 Fatigued" }));
    await user.type(screen.getByLabelText("添加状态笔记"), "真实的本机状态记录");
    await user.click(screen.getByRole("button", { name: "记录打卡" }));
    expect(await screen.findByText("真实的本机状态记录")).toBeTruthy();
    expect(requests.every(request => request.method === "GET")).toBe(true);
    const stored = JSON.parse(localStorage.getItem("shixu:mood-journal:user-1") ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ emotion: "Fatigued", note: "真实的本机状态记录" });
    await user.click(screen.getByRole("button", { name: "查看打卡详情" }));
    const detailDialog = screen.getByRole("dialog", { name: "心境打卡详情" });
    expect(within(detailDialog).getByText(/仅保存在此浏览器/)).toBeTruthy();
    await user.click(within(detailDialog).getByRole("button", { name: "关闭" }));
    const moodDrawer = screen.getByRole("dialog", { name: "心境与呼吸辅助" });
    await user.click(within(moodDrawer).getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("37");
  });

  it("does not claim a five-minute breathing exercise is complete before its timer finishes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) =>
        new URL(request.url).pathname.includes("/schedule/items")
          ? json({ items: [] })
          : json(snapshot),
      ),
    );
    mount();
    await screen.findByRole("meter");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "心境与呼吸" }));
    await user.click(await screen.findByRole("button", { name: "启动 5m 极简呼吸" }));
    const dialog = screen.getByRole("dialog", { name: "5分钟极简节律重置" });
    expect(
      (within(dialog).getByRole("button", { name: "完成呼吸并记入恢复" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(within(dialog).getByRole("button", { name: "开始 5 分钟练习" })).toBeTruthy();
    expect(localStorage.getItem("shixu:mood-journal:user-1")).toBeNull();
  });

  it("renders only the server score, real UTC chart points and an honest baseline state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) =>
        new URL(request.url).pathname.includes("/schedule/items")
          ? json({ items: [] })
          : json(snapshot),
      ),
    );
    mount();
    await screen.findByRole("heading", { name: "今日精力节律曲线" });
    expect(screen.getAllByText("节律基线估算").length).toBeGreaterThan(0);
    expect(screen.getByRole("meter", { name: "个人精力电量" }).getAttribute("aria-valuenow")).toBe("37");
    const chart = screen.getByRole("img", { name: "24 小时精力预测曲线" });
    expect(chart.querySelectorAll("circle[data-hour]").length).toBe(snapshot.hourlyCurve.length);
    expect(chart.querySelector("circle[data-hour]")?.getAttribute("data-hour")).toBe(
      snapshot.hourlyCurve[0].hourStartAt,
    );
    expect(screen.getByText("尚未建立个人 HRV 基线")).toBeTruthy();
    expect(screen.getByText(/由 Android 端采集同步/)).toBeTruthy();
    expect(screen.queryByText("穿戴实时同步中")).toBeNull();
    expect(screen.getByText("暂无深度专注保护窗口")).toBeTruthy();
  });

  it.each([
    ["well_rested", "充分休息"],
    ["sleep_deprived", "睡眠不足"],
    ["high_stress", "连续高压"],
  ] as const)(
    "requires explicit confirmation before seeding the %s replay",
    async (scenario, label) => {
      const requests: Request[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (request: Request) => {
          requests.push(request);
          if (new URL(request.url).pathname.includes("/schedule/items")) return json({ items: [] });
          return request.method === "POST"
            ? json({
                day: snapshot.localDay,
                scenario,
                seededCount: 12,
                latestEnergy: { ...snapshot, dataFreshness: "replay_demo" },
              } satisfies ApiComponents["ReplaySeedResponse"])
            : json(snapshot);
        }),
      );
      mount();
      await screen.findByRole("heading", { name: "今日精力节律曲线" });
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "测试回放" }));
      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("radio", { name: new RegExp(label) }));
      expect(requests.filter(request => request.method === "POST").length).toBe(0);
      expect(
        (within(dialog).getByRole("button", { name: "确认载入回放" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      await user.click(within(dialog).getByRole("checkbox", { name: /我了解/ }));
      await user.click(within(dialog).getByRole("button", { name: "确认载入回放" }));
      await waitFor(() => expect(requests.filter(request => request.method === "POST").length).toBe(1));
      const request = requests.find(request => request.method === "POST")!;
      expect(new URL(request.url).pathname).toBe("/api/v1/biometrics/replay-seed");
      expect(JSON.parse(await request.clone().text())).toMatchObject({ scenario });
      await waitFor(() => expect(screen.getAllByText("回放测试源").length).toBeGreaterThan(0));
    },
  );

  it("shows server failures and retries instead of rendering invented samples", async () => {
    let available = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        if (new URL(request.url).pathname.includes("/schedule/items")) return json({ items: [] });
        return available
          ? json(snapshot)
          : json(
              {
                type: "https://shixu.app/errors/SERVICE_UNAVAILABLE",
                code: "SERVICE_UNAVAILABLE",
                title: "Unavailable",
                status: 503,
                detail: "精力数据暂不可用",
              },
              503,
            );
      }),
    );
    mount();
    expect((await screen.findByRole("alert")).textContent).toContain("精力数据暂不可用");
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.queryByRole("img", { name: "24 小时精力预测曲线" })).toBeNull();
    expect((screen.getByRole("button", { name: "关怀建议" }) as HTMLButtonElement).disabled).toBe(true);
    available = true;
    await userEvent.setup().click(screen.getByRole("button", { name: "重新加载" }));
    await screen.findByRole("meter", { name: "个人精力电量" });
  });

  it("keeps a failed replay visible in the confirmation dialog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        if (new URL(request.url).pathname.includes("/schedule/items")) return json({ items: [] });
        return request.method === "POST"
          ? json(
              {
                type: "https://shixu.app/errors/SERVICE_UNAVAILABLE",
                code: "SERVICE_UNAVAILABLE",
                title: "Unavailable",
                status: 503,
                detail: "回放写入失败，请稍后重试",
              },
              503,
            )
          : json(snapshot);
      }),
    );
    mount();
    await screen.findByRole("meter");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "测试回放" }));
    await user.click(screen.getByRole("checkbox", { name: /我了解/ }));
    await user.click(screen.getByRole("button", { name: "确认载入回放" }));
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain("回放写入失败"),
    );
  });

  it("steps dates to fetch historical energy and renders the aligned schedule load mini-track", async () => {
    const today = localDate(new Date(), "Asia/Shanghai");
    const prevDay = shiftDay(today, -1);
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        const url = new URL(request.url);
        urls.push(`${url.pathname}${url.search}`);
        if (url.pathname.includes("/schedule/items")) {
          return json({
            items: [
              {
                id: "s1",
                userId: "user-1",
                title: "系统重构评审",
                notes: "",
                startAt: "2026-11-19T01:30:00Z",
                endAt: "2026-11-19T02:30:00Z",
                category: "deep_work",
                cognitiveLoad: "high",
                flexibility: "flexible",
                status: "planned",
                durationMinutes: 60,
                reminderMinutes: 10,
                createdAt: "2026-11-19T00:00:00Z",
                updatedAt: "2026-11-19T00:00:00Z",
              },
            ],
          });
        }
        return json(snapshot);
      }),
    );
    mount();
    await screen.findByText("系统重构评审");
    await userEvent.setup().click(screen.getByRole("button", { name: "前一天精力" }));
    await waitFor(() =>
      expect(urls.some(u => u.includes(`/api/v1/energy/today?day=${prevDay}`))).toBe(true),
    );
  });
});
