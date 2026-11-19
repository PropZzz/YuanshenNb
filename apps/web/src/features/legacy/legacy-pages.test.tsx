import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { BluetoothPage, DiagnosticsPage, GoalsPage, IntegrationsPage, MicrotasksPage, ReviewPage } from "./legacy-pages";
import { exportLocalData, localWorkspaceKey, makeLocalTask } from "./local-data";

const clients: QueryClient[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function mount(page: React.ReactNode, path = "/microtasks") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{page}</MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  localStorage.clear();
  useAuthStore.getState().setSession("access", { id: "local-user", displayName: "测试用户", email: "local@example.com", timezone: "Asia/Shanghai", themeMode: "light", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" });
  vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/health")) return json({ ok: true, dbStatus: "up", serverTime: "2026-11-19T06:00:00Z", version: "2.4-real" });
    if (path.endsWith("/energy/today")) return json({ score: 37, tier: "strained", dataFreshness: "baseline_only", localDay: "2026-11-19", timezone: "Asia/Shanghai", computedAt: "2026-11-19T06:00:00Z", diagnostics: { baselineReadyDays: 0 }, drivers: { summary: "节律基线" }, hourlyCurve: [], focusShields: [] });
    if (path.endsWith("/rescue/history")) return json({ snapshots: [] });
    return json({ items: [], baselineVersion: "real-version", baselineLocalDay: "2026-11-19" });
  }));
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); useAuthStore.getState().clearSession(); });

describe("local records on ordinary HTTP origins", () => {
  it("creates a task with random bytes when randomUUID is unavailable", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(0x31));
    vi.stubGlobal("crypto", { getRandomValues });
    const task = makeLocalTask({ title: "HTTP 本机任务", duration: 15, priority: "P1", load: "medium" });
    expect(task.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });
  it("creates goal and milestone IDs without randomUUID", async () => {
    let nextByte = 0;
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(++nextByte) });
    mount(<GoalsPage />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "新建目标" }));
    const drawer = screen.getByRole("dialog");
    await user.type(within(drawer).getByLabelText("目标名称"), "HTTP 本机目标");
    await user.type(within(drawer).getByLabelText("里程碑清单（每行一项）"), "手动里程碑");
    await user.click(within(drawer).getByRole("button", { name: "保存目标到本机" }));
    const saved = JSON.parse(localStorage.getItem(localWorkspaceKey("local-user"))!);
    expect(saved.goals[0].id).toBeTruthy(); expect(saved.goals[0].steps[0].id).toBeTruthy();
    expect(saved.goals[0].id).not.toBe(saved.goals[0].steps[0].id);
  });
  it("renders quick capture and saves its preview without randomUUID", async () => {
    vi.stubGlobal("crypto", {});
    mount(<MicrotasksPage />, "/microtasks?panel=capture");
    const user = userEvent.setup(), drawer = screen.getByRole("dialog");
    await user.type(within(drawer).getByLabelText("多行快速捕捉"), "HTTP 捕捉一\nHTTP 捕捉二");
    await user.click(within(drawer).getByRole("button", { name: "预览清单" }));
    await user.click(within(drawer).getByRole("button", { name: "确认保存到本机" }));
    const tasks = JSON.parse(localStorage.getItem(localWorkspaceKey("local-user"))!).tasks;
    expect(tasks).toHaveLength(2); expect(new Set(tasks.map((task: { id: string }) => task.id)).size).toBe(2);
  });
});

describe("restored microtask workspace", () => {
  it("starts without sample records and persists a user task, detail edit and completion only on this device", async () => {
    mount(<MicrotasksPage />); const user = userEvent.setup();
    expect(screen.getByText("还没有微任务")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "新建微任务" }));
    const drawer = screen.getByRole("dialog");
    await user.type(within(drawer).getByLabelText("任务标题"), "核对真实接口");
    fireEvent.change(within(drawer).getByLabelText("预估时长（分钟）"), { target: { value: "10" } });
    await user.click(within(drawer).getByRole("button", { name: "保存到本机" }));
    await user.click(screen.getByRole("button", { name: "查看微任务：核对真实接口" }));
    expect(within(screen.getByRole("dialog")).getByText("10 分钟")).toBeTruthy();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "编辑" }));
    await user.type(within(screen.getByRole("dialog")).getByLabelText("任务描述"), "确认错误状态");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "保存修改" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "标记完成" }));
    expect(JSON.parse(localStorage.getItem(localWorkspaceKey("local-user"))!).tasks[0]).toMatchObject({ title: "核对真实接口", description: "确认错误状态", duration: 10, completed: true });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.every(([request]) => (request as Request).method === "GET")).toBe(true);
  });

  it("opens the breakdown entry from a route and saves only manually entered steps", async () => {
    vi.stubGlobal("crypto", {});
    mount(<MicrotasksPage />, "/microtask-entry"); const user = userEvent.setup(), drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText(/自动拆解尚未接入/)).toBeTruthy();
    await user.type(within(drawer).getByLabelText("原始任务或清单"), "完成接口核验");
    await user.type(within(drawer).getByLabelText("步骤 1 标题"), "核验失败返回");
    await user.click(within(drawer).getByRole("button", { name: "添加额外拆解步骤" }));
    await user.type(within(drawer).getByLabelText("步骤 2 标题"), "核验成功返回");
    await user.click(within(drawer).getByRole("button", { name: "确认拆解并存入沙盒" }));
    expect(JSON.parse(localStorage.getItem(localWorkspaceKey("local-user"))!).tasks.map((task: { title: string }) => task.title)).toEqual(["核验失败返回", "核验成功返回"]);
  });
  it("opens the multiline quick capture drawer and previews each line before storing user records", async () => {
    mount(<MicrotasksPage />, "/microtasks?panel=capture"); const user = userEvent.setup(), drawer = screen.getByRole("dialog");
    await user.type(within(drawer).getByLabelText("多行快速捕捉"), "确认接口\n完成回归");
    expect(localStorage.getItem(localWorkspaceKey("local-user"))).toBeNull();
    await user.click(within(drawer).getByRole("button", { name: "预览清单" }));
    expect(within(drawer).getByDisplayValue("确认接口")).toBeTruthy();
    await user.click(within(drawer).getByRole("button", { name: "确认保存到本机" }));
    expect(JSON.parse(localStorage.getItem(localWorkspaceKey("local-user"))!).tasks).toHaveLength(2);
  });
  it("does not show save success when browser persistence fails", async () => {
    mount(<MicrotasksPage />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "新建微任务" }));
    await user.type(within(screen.getByRole("dialog")).getByLabelText("任务标题"), "不应假保存");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("存储空间不足"); });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "保存到本机" }));
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain("存储空间不足");
    expect(screen.queryByText("微任务已保存 · 仅本机")).toBeNull();
  });
});

describe("local goals and data", () => {
  it("saves user-defined goals without an invented algorithm or sample milestones", async () => {
    mount(<GoalsPage />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "新建目标" }));
    const drawer = screen.getByRole("dialog");
    await user.type(within(drawer).getByLabelText("目标名称"), "交付原版界面");
    await user.type(within(drawer).getByLabelText("里程碑清单（每行一项）"), "恢复页面\n验证交互");
    await user.click(within(drawer).getByRole("button", { name: "保存目标到本机" }));
    const saved = JSON.parse(localStorage.getItem(localWorkspaceKey("local-user"))!);
    expect(saved.goals[0]).toMatchObject({ title: "交付原版界面", steps: [{ title: "恢复页面", completed: false }, { title: "验证交互", completed: false }] });
    expect(screen.getByRole("heading", { name: "交付原版界面" })).toBeTruthy();
  });
  it("retains completion of an unchanged milestone when another preceding milestone is removed", async () => {
    mount(<GoalsPage />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "新建目标" }));
    let drawer = screen.getByRole("dialog"); await user.type(within(drawer).getByLabelText("目标名称"), "里程碑调整");
    await user.type(within(drawer).getByLabelText("里程碑清单（每行一项）"), "准备数据\n核验数据");
    await user.click(within(drawer).getByRole("button", { name: "保存目标到本机" }));
    await user.click(screen.getAllByRole("checkbox")[1]); await user.click(screen.getByRole("button", { name: "目标详情" }));
    drawer = screen.getByRole("dialog"); await user.clear(within(drawer).getByLabelText("里程碑清单（每行一项）"));
    await user.type(within(drawer).getByLabelText("里程碑清单（每行一项）"), "核验数据");
    await user.click(within(drawer).getByRole("button", { name: "保存目标到本机" }));
    expect(JSON.parse(localStorage.getItem(localWorkspaceKey("local-user"))!).goals[0].steps[0]).toMatchObject({ title: "核验数据", completed: true });
  });
  it("exports only current user's input data, excludes credentials, and keeps accounts isolated", () => {
    localStorage.setItem(localWorkspaceKey("other"), JSON.stringify({ version: 1, tasks: [{ id: "private", title: "他人数据" }], goals: [], drafts: {} }));
    const data = JSON.parse(exportLocalData("local-user"));
    expect(data.tasks).toEqual([]); expect(data.goals).toEqual([]);
    expect(JSON.stringify(data)).not.toContain("access"); expect(JSON.stringify(data)).not.toContain("他人数据");
  });
});

describe("service and reserved capabilities", () => {
  it("shows health returned by the real endpoint and records refresh failures truthfully", async () => {
    mount(<DiagnosticsPage />);
    await screen.findByText("2.4-real");
    expect(screen.getByText(/^\d{2}:\d{2}:\d{2}\.\d{3}$/)).toBeTruthy();
    expect(screen.queryByText("FIPS 140-2 READY")).toBeNull();
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([request]) => new URL((request as Request).url).pathname === "/api/v1/health")).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => json({ type: "https://shixu.app/errors/SERVICE_UNAVAILABLE", title: "Unavailable", status: 503, code: "SERVICE_UNAVAILABLE", detail: "真实健康探测失败" }, 503)));
    await userEvent.setup().click(screen.getByRole("button", { name: "刷新探测" }));
    await waitFor(() => expect(screen.getAllByText(/真实健康探测失败/).length).toBeGreaterThan(0));
  });
  it("keeps MCP input as a local draft and never claims parsing or import succeeded", async () => {
    mount(<IntegrationsPage />); const user = userEvent.setup();
    await user.type(screen.getByLabelText("导入日历或协同消息"), "用户粘贴的会议原文");
    await user.click(screen.getByRole("button", { name: "保存本机草稿" }));
    expect(JSON.parse(localStorage.getItem(localWorkspaceKey("local-user"))!).drafts.integration).toBe("用户粘贴的会议原文");
    expect(screen.getByRole("button", { name: "智能解析（未接入）" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("置信度 99.4%")).toBeNull();
  });
  it("clears unsaved private input when the active account changes", async () => {
    mount(<IntegrationsPage />); await userEvent.setup().type(screen.getByLabelText("导入日历或协同消息"), "上一账户的未保存正文");
    act(() => { const state = useAuthStore.getState(); state.setSession("new-access", { ...state.user!, id: "another-user" }); });
    expect((screen.getByLabelText("导入日历或协同消息") as HTMLTextAreaElement).value).toBe("");
  });
  it("displays unsupported Bluetooth instead of generated peripherals or measurements", () => {
    mount(<BluetoothPage />);
    expect(screen.getByText(/当前浏览器不支持 Web Bluetooth/)).toBeTruthy();
    expect(screen.queryByText("Polar H10 心率带")).toBeNull();
    expect(screen.getByRole("button", { name: "选择并连接设备" }).hasAttribute("disabled")).toBe(true);
  });
  it("requests an actual Bluetooth chooser on an explicit click and connects the selected GATT device", async () => {
    const device = Object.assign(new EventTarget(), { id: "selected-device", name: "用户授权的心率设备", gatt: { connected: false, connect: vi.fn(), disconnect: vi.fn(), getPrimaryServices: vi.fn(async () => []) } });
    device.gatt.connect.mockImplementation(async () => { device.gatt.connected = true; return device.gatt; });
    const requestDevice = vi.fn(async () => device);
    vi.stubGlobal("isSecureContext", true); vi.stubGlobal("navigator", { bluetooth: { requestDevice }, userAgent: "Test browser" });
    mount(<BluetoothPage />); expect(requestDevice).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "选择并连接设备" }));
    await screen.findByText("用户授权的心率设备");
    expect(requestDevice).toHaveBeenCalledWith(expect.objectContaining({ filters: [{ services: ["heart_rate"] }] }));
    expect(device.gatt.connect).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("72 BPM")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "断开设备" }));
    expect(device.gatt.disconnect).toHaveBeenCalledTimes(1);
  });
  it("does not start a GATT connection if the chooser returns after leaving the page", async () => {
    const device = Object.assign(new EventTarget(), { id: "late-device", gatt: { connect: vi.fn(), disconnect: vi.fn() } });
    let choose!: (value: typeof device) => void;
    const requestDevice = vi.fn(() => new Promise<typeof device>(resolve => { choose = resolve; }));
    vi.stubGlobal("isSecureContext", true); vi.stubGlobal("navigator", { bluetooth: { requestDevice } });
    const view = mount(<BluetoothPage />);
    await userEvent.setup().click(screen.getByRole("button", { name: "选择并连接设备" }));
    view.unmount(); await act(async () => { choose(device); });
    expect(device.gatt.connect).not.toHaveBeenCalled();
  });
  it("disconnects a GATT connection that finishes after leaving the page", async () => {
    const server = { connected: false, connect: vi.fn(), disconnect: vi.fn(), getPrimaryServices: vi.fn(async () => []) };
    let finish!: (value: typeof server) => void;
    server.connect.mockImplementation(() => new Promise<typeof server>(resolve => { finish = resolve; }));
    const device = Object.assign(new EventTarget(), { id: "late-connection", gatt: server });
    vi.stubGlobal("isSecureContext", true); vi.stubGlobal("navigator", { bluetooth: { requestDevice: vi.fn(async () => device) } });
    const view = mount(<BluetoothPage />);
    await userEvent.setup().click(screen.getByRole("button", { name: "选择并连接设备" }));
    expect(server.connect).toHaveBeenCalledTimes(1);
    view.unmount(); await act(async () => { server.connected = true; finish(server); });
    expect(server.disconnect).toHaveBeenCalledTimes(1);
    expect(server.getPrimaryServices).not.toHaveBeenCalled();
  });
  it("removes a pending notification listener when leaving the Bluetooth page", async () => {
    let finish!: () => void;
    const characteristic = Object.assign(new EventTarget(), { uuid: "heart-rate", properties: { notify: true }, startNotifications: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })), stopNotifications: vi.fn(async () => {}) });
    const remove = vi.spyOn(characteristic, "removeEventListener");
    const server = { connected: true, connect: vi.fn(), disconnect: vi.fn(), getPrimaryServices: vi.fn(async () => [{ uuid: "heart-service", isPrimary: true, getCharacteristics: async () => [characteristic] }]) };
    server.connect.mockResolvedValue(server);
    const device = Object.assign(new EventTarget(), { id: "pending-notification", gatt: server });
    vi.stubGlobal("isSecureContext", true); vi.stubGlobal("navigator", { bluetooth: { requestDevice: vi.fn(async () => device) } });
    const view = mount(<BluetoothPage />);
    await userEvent.setup().click(screen.getByRole("button", { name: "选择并连接设备" }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "订阅通知流" }));
    view.unmount();
    expect(remove).toHaveBeenCalledWith("characteristicvaluechanged", expect.any(Function));
    await act(async () => { finish(); });
    expect(characteristic.stopNotifications).toHaveBeenCalled();
  });
  it("keeps the audit layout and explains unavailable measures with no sample history", async () => {
    mount(<ReviewPage />); await screen.findByRole("heading", { name: "日程救援历史日志" });
    expect(await screen.findByText("暂无救援记录")).toBeTruthy();
    expect(screen.getAllByText(/当前周期没有日程/).length).toBeGreaterThan(0);
    expect(screen.queryByText("86.4%")).toBeNull();
  });
  it("supports batch delete confirmation for local microtasks without calling network writes", async () => {
    localStorage.setItem(localWorkspaceKey("local-user"), JSON.stringify({
      version: 1,
      tasks: [makeLocalTask({ title: "待删微任务", duration: 10, priority: "P2", load: "low" })],
      goals: [],
      drafts: {},
    }));
    mount(<MicrotasksPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "选择微任务：待删微任务" }));
    await user.click(screen.getByRole("button", { name: "批量删除" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(screen.queryByText("待删微任务")).toBeNull();
    expect(JSON.parse(localStorage.getItem(localWorkspaceKey("local-user"))!).tasks).toHaveLength(0);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.every(([request]) => (request as Request).method === "GET")).toBe(true);
  });
});
