import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiComponents } from "@/api/client";
import { ScheduleEditor } from "./schedule-editor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("makes each original attribute selectable without keeping disabled placeholder load buttons", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ScheduleEditor open onClose={() => {}} day="2026-11-20" />
    </QueryClientProvider>,
  );
  for (const name of [
    "方案评审",
    "跨部门协同",
    "架构编码",
    "随笔调研",
    "日常规程",
    "上课学习",
    "作业自习",
    "考试复习",
    "工作会议",
    "项目推进",
    "运动休息",
  ]) {
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
  }
  expect(screen.queryByRole("button", { name: "未评估" })).toBeNull();
  expect(screen.queryByRole("button", { name: "每天" })).toBeNull();
});

it("warns gently when scheduling a high-load task in a low-energy window and offers 1-click peak adoption", async () => {
  const energy: ApiComponents["EnergyTodayResponse"] = {
    localDay: "2026-11-20",
    timezone: "Asia/Shanghai",
    computedAt: "2026-11-20T00:00:00Z",
    score: 68,
    tier: "steady",
    dataFreshness: "baseline_only",
    drivers: {
      sleepRecoveryScore: 30,
      autonomicDeltaScore: 0,
      circadianScore: 20,
      cognitiveLoadDrainScore: 0,
      recoveryBufferBonusScore: 0,
      summary: "上午精力高峰，下午偏低",
    },
    hourlyCurve: [
      { hourStartAt: "2026-11-20T01:00:00Z", score: 42, tier: "strained" },
      { hourStartAt: "2026-11-20T03:00:00Z", score: 88, tier: "peak" },
    ],
    focusShields: [
      {
        startAt: "2026-11-20T03:00:00Z",
        endAt: "2026-11-20T05:00:00Z",
        avgScore: 88,
        source: "preferred_window",
      },
    ],
    diagnostics: { baselineReadyDays: 0 },
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ScheduleEditor open onClose={() => {}} day="2026-11-20" initialTime="09:00" energy={energy} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "高认知负荷" }));
  expect(await screen.findByText(/精力低谷提醒/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /采用建议时段/ }));
  expect((screen.getByLabelText("开始时间") as HTMLInputElement).value).toBe("2026-11-20T11:00");
});

it("saves a selected attribute and one mutually exclusive scheduling constraint", async () => {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      bodies.push(await request.json());
      return new Response(JSON.stringify({ item: { id: "saved" } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ScheduleEditor open onClose={() => {}} day="2026-11-20" />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("日程标题"), "复习课程");
  await user.click(screen.getByRole("button", { name: "考试复习" }));
  await user.click(screen.getByRole("radio", { name: /硬约束防挤压锁定/ }));
  expect((screen.getByRole("radio", { name: /排期灵活性微调/ }) as HTMLInputElement).checked).toBe(false);
  await user.click(screen.getByRole("radio", { name: /深度专注保护/ }));
  expect((screen.getByRole("radio", { name: /硬约束防挤压锁定/ }) as HTMLInputElement).checked).toBe(false);
  await user.click(screen.getByRole("button", { name: "保存日程" }));
  await waitFor(() =>
    expect(bodies[0]).toMatchObject({
      presentation: { attributeTag: "exam" },
      category: "deep_work",
      flexibility: "focus_shield",
    }),
  );
});

it("explicitly clears a removed deadline when saving an existing schedule", async () => {
  const item: ApiComponents["ScheduleItemDTO"] = {
    id: "item",
    userId: "user",
    title: "截止期回归",
    notes: "",
    startAt: "2026-11-20T01:00:00Z",
    endAt: "2026-11-20T02:00:00Z",
    deadlineAt: "2026-11-20T10:00:00Z",
    category: "deep_work",
    cognitiveLoad: "high",
    flexibility: "flexible",
    status: "planned",
    durationMinutes: 60,
    reminderMinutes: 10,
    createdAt: "2026-11-19T00:00:00Z",
    updatedAt: "2026-11-19T00:00:00Z",
  };
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      bodies.push(await request.json());
      return new Response(JSON.stringify({ item, baselineVersion: "v", baselineLocalDay: "2026-11-20" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ScheduleEditor open onClose={() => {}} day="2026-11-20" item={item} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText("截止时间（可选）"));
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(bodies[0]).toMatchObject({ clearDeadline: true }));
});
