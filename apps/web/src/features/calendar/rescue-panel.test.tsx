import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiComponents } from "@/api/client";
import { useAuthStore } from "@/stores/auth-store";
import { RescuePanel } from "./rescue-panel";

const day = "2026-11-20";
const options: ApiComponents["RescueOptionsResponse"] = {
  day, baselineVersion: "baseline-v1", options: (["protect_deadline", "protect_recovery", "minimize_changes"] as const).map(strategy => ({
    strategy, optionHash: `${strategy}-hash`, feasible: true, movedCount: 0, deferredCount: 0, recoveryMinutes: 15, overdueRiskCount: 0,
    summary: "服务端给出的可执行方案", diffItems: [],
  })),
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const caches: QueryClient[] = [];
function mount() {
  useAuthStore.getState().setSession("access", { id: "self", displayName: "测试", email: "self@example.com", timezone: "Asia/Shanghai", themeMode: "light", createdAt: "2026-11-19T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z" });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } }); caches.push(cache);
  render(<QueryClientProvider client={cache}><RescuePanel day={day} forceOpen onClose={() => {}} /></QueryClientProvider>);
}
beforeEach(()=>{vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-19T02:00:00Z"));});
afterEach(() => { cleanup();vi.useRealTimers(); caches.splice(0).forEach(cache => cache.clear()); vi.unstubAllGlobals(); useAuthStore.getState().clearSession(); });

it("uses the reference drawer and prevents a deadline in the past from reaching the rescue engine",async()=>{
 const previews:unknown[]=[];vi.stubGlobal("fetch",vi.fn(async(request:Request)=>{if(request.url.endsWith("/options")){previews.push(await request.json());return json(options);}return json({snapshots:[]});}));
 mount();expect(screen.getByRole("dialog",{name:"日程救援决策台"}).getAttribute("data-surface")).toBe("drawer");
 const user=userEvent.setup();await user.type(screen.getByLabelText("紧急任务"),"过期插单");
 const deadline=screen.getByLabelText("最晚完成时间");await user.clear(deadline);await user.type(deadline,"2000-01-01T10:00");await user.click(screen.getByRole("button",{name:"生成三套方案"}));
 expect(await screen.findByText(/截止时间必须晚于现在/)).toBeTruthy();expect(previews).toHaveLength(0);
});

it("previews fatigue recovery without inventing an urgent task and only applies after confirmation", async () => {
  const previews: unknown[] = [], applies: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
    if (request.url.endsWith("/options")) { previews.push(await request.json()); return json(options); }
    if (request.url.endsWith("/apply")) { applies.push(await request.json()); return json({ snapshotId: "snapshot" }); }
    return json({ snapshots: [] });
  }));
  mount(); const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("救援原因"), "wearable_fatigue");
  expect(screen.queryByLabelText("紧急任务")).toBeNull();
  await user.click(screen.getByRole("button", { name: "生成三套方案" }));
  await screen.findByRole("button", { name: "确认应用当前方案" });
  expect(previews).toEqual([{ day, triggerReason: "wearable_fatigue" }]); expect(applies).toEqual([]);
  await user.click(screen.getByRole("button", { name: "确认应用当前方案" }));
  await waitFor(() => expect(applies).toEqual([{ day, triggerReason: "wearable_fatigue", strategy: "protect_deadline", baselineVersion: "baseline-v1", expectedOptionHash: "protect_deadline-hash" }]));
});

it("invalidates the preview when the user changes the task after calculation", async () => {
  vi.stubGlobal("fetch", vi.fn(async (request: Request) => request.url.endsWith("/options") ? json(options) : json({ snapshots: [] })));
  mount(); const user = userEvent.setup();
  await user.type(screen.getByLabelText("紧急任务"), "旧任务");
  await user.click(screen.getByRole("button", { name: "生成三套方案" }));
  await screen.findByRole("button", { name: "确认应用当前方案" });
  await user.type(screen.getByLabelText("紧急任务"), "已改变");
  expect(screen.queryByRole("button", { name: "确认应用当前方案" })).toBeNull();
});

it("retains one idempotency key when retrying the same rescue after a temporary failure", async () => {
  const keys: (string | null)[] = [];
  vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
    if (request.url.endsWith("/options")) return json(options);
    if (request.url.endsWith("/apply")) {
      keys.push(request.headers.get("Idempotency-Key"));
      return keys.length === 1 ? json({ type: "https://shixu.app/errors/SERVICE_UNAVAILABLE", code: "SERVICE_UNAVAILABLE", title: "Unavailable", status: 503, detail: "临时故障，请重试" }, 503) : json({ snapshotId: "snapshot" });
    }
    return json({ snapshots: [] });
  }));
  mount(); const user = userEvent.setup(); await user.type(screen.getByLabelText("紧急任务"), "重试任务");
  await user.click(screen.getByRole("button", { name: "生成三套方案" })); await user.click(await screen.findByRole("button", { name: "确认应用当前方案" }));
  await screen.findByText(/临时故障，请重试/); await user.click(screen.getByRole("button", { name: "确认应用当前方案" }));
  await waitFor(() => expect(keys).toHaveLength(2)); expect(keys[0]).toBeTruthy(); expect(keys[1]).toBe(keys[0]);
});

it("uses a secure v4 UUID fallback on HTTP and retains it when retrying",async()=>{
 const secureRandom=globalThis.crypto.getRandomValues.bind(globalThis.crypto),keys:(string|null)[]=[];vi.stubGlobal("crypto",{getRandomValues:secureRandom});
 vi.stubGlobal("fetch",vi.fn(async(request:Request)=>{if(request.url.endsWith("/options"))return json(options);if(request.url.endsWith("/apply")){keys.push(request.headers.get("Idempotency-Key"));return keys.length===1?json({type:"https://shixu.app/errors/SERVICE_UNAVAILABLE",code:"SERVICE_UNAVAILABLE",title:"Unavailable",status:503,detail:"临时故障，请重试"},503):json({snapshotId:"snapshot"});}return json({snapshots:[]});}));
 mount();const user=userEvent.setup();await user.selectOptions(screen.getByLabelText("救援原因"),"wearable_fatigue");await user.click(screen.getByRole("button",{name:"生成三套方案"}));await user.click(await screen.findByRole("button",{name:"确认应用当前方案"}));
 await waitFor(()=>expect(keys).toHaveLength(1));expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 await screen.findByText(/临时故障，请重试/);await user.click(screen.getByRole("button",{name:"确认应用当前方案"}));await waitFor(()=>expect(keys).toHaveLength(2));expect(keys[1]).toBe(keys[0]);
});

it("discards a delayed preview after the user changes its input", async () => {
  let resolvePreview!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (request: Request) => request.url.endsWith("/options")
    ? new Promise<Response>(resolve => { resolvePreview = resolve; })
    : json({ snapshots: [] })));
  mount(); const user = userEvent.setup();
  await user.type(screen.getByLabelText("紧急任务"), "原始任务");
  await user.click(screen.getByRole("button", { name: "生成三套方案" }));
  await user.selectOptions(screen.getByLabelText("救援原因"), "team_meeting_overload");
  await act(async () => { resolvePreview(json(options)); });
  expect(screen.queryByRole("button", { name: "确认应用当前方案" })).toBeNull();
  expect(screen.queryByLabelText("紧急任务")).toBeNull();
});
