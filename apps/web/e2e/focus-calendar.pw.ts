import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const profile = { id: "focus-calendar-qa", email: "focus-calendar@example.com", displayName: "专注日历联动验收", timezone: "Asia/Shanghai", themeMode: "light", createdAt: "2026-11-24T00:00:00Z", updatedAt: "2026-11-24T00:00:00Z" };
function item(id: string, title: string, startAt: string, endAt: string) {
  return { id, title, userId: profile.id, notes: "浏览器验收中的日历事项", category: "deep_work", cognitiveLoad: "high", flexibility: "flexible", status: "planned", startAt, endAt, durationMinutes: (Date.parse(endAt) - Date.parse(startAt)) / 60_000, reminderMinutes: 0, createdAt: profile.createdAt, updatedAt: profile.updatedAt };
}
async function prepare(page: Page, items: ReturnType<typeof item>[], now = "2026-11-24T02:30:00Z") {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install({ time: new Date(now) });
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), url = new URL(request.url()); let body: unknown = {};
    if (url.pathname.endsWith("/auth/refresh")) body = { accessToken: "focus-calendar-fixture", user: profile };
    else if (url.pathname.endsWith("/auth/ws-ticket")) { await route.fulfill({ status: 503, json: { detail: "浏览器测试不建立实时连接" } }); return; }
    else if (url.pathname.endsWith("/health")) body = { ok: true, dbStatus: "up" };
    else if (url.pathname.endsWith("/schedule/items")) {
      const from = Date.parse(url.searchParams.get("from")!), to = Date.parse(url.searchParams.get("to")!);
      body = { items: items.filter(candidate => Date.parse(candidate.startAt) < to && Date.parse(candidate.endAt) > from && candidate.status !== "cancelled"), baselineVersion: "v", baselineLocalDay: "2026-11-24" };
    } else if (request.method() === "PATCH" && url.pathname.includes("/schedule/items/")) {
      const target = items.find(candidate => candidate.id === url.pathname.split("/").at(-1))!;
      Object.assign(target, request.postDataJSON());
      target.durationMinutes = (Date.parse(target.endAt) - Date.parse(target.startAt)) / 60_000;
      body = { item: target, baselineVersion: "v", baselineLocalDay: "2026-11-24" };
    } else if (url.pathname.endsWith("/rescue/history")) body = { snapshots: [] };
    else if (url.pathname.endsWith("/workspaces")) body = { workspaces: [] };
    else if (url.pathname.endsWith("/energy/today")) body = { localDay: url.searchParams.get("day"), timezone: profile.timezone, score: 65, tier: "steady", dataFreshness: "baseline_only", drivers: { summary: "浏览器测试节律基线" }, diagnostics: { baselineReadyDays: 0 }, hourlyCurve: [], focusShields: [] };
    await route.fulfill({ json: body });
  });
  return errors;
}

test("focus follows the current calendar item, its detail link and calendar completion", async ({ page }, info) => {
  const items = [item("past", "已经过期的日历事项", "2026-11-24T00:00:00Z", "2026-11-24T01:00:00Z"), item("current", "当前真实日历事项", "2026-11-24T02:00:00Z", "2026-11-24T03:00:00Z"), item("next", "最近的下一项事项", "2026-11-24T04:00:00Z", "2026-11-24T04:30:00Z")];
  const errors = await prepare(page, items);
  await page.goto("/focus");
  await expect(page.getByRole("heading", { name: items[1].title, exact: true })).toBeVisible();
  await expect(page.getByLabel("日历关联状态")).toContainText("正在进行");
  await page.getByRole("button", { name: "任务倒计时", exact: true }).click();
  await expect(page.getByRole("timer")).toHaveText("60:00");
  await page.getByRole("link", { name: "在智能日历中查看当前事项" }).click();
  const detail = page.getByRole("dialog", { name: "日程详情", exact: true });
  await expect(detail.getByRole("heading", { name: items[1].title, exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "标记完成", exact: true }).click();
  await expect(detail).toHaveCount(0);
  await page.locator('nav a[href="/focus"]:visible').click();
  await expect(page.getByRole("heading", { name: items[2].title, exact: true })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveText("30:00");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const output = path.resolve("../../.appdata/qa/focus-calendar"); await mkdir(output, { recursive: true });
  await page.screenshot({ animations: "disabled", fullPage: true, path: path.join(output, `${info.project.name}-calendar-linked.png`) });
  expect(errors).toEqual([]);
});

test("focus finds a future item when today is empty and keeps its date after reload", async ({ page }) => {
  const future = item("future", "后天最近的真实事项", "2026-11-26T01:00:00Z", "2026-11-26T01:45:00Z");
  const errors = await prepare(page, [future]); await page.goto("/focus");
  await expect(page.getByRole("heading", { name: future.title })).toBeVisible();
  await expect(page.getByLabel("日历关联状态")).toContainText("下一项");
  await expect(page.getByLabel("当前事项时间")).toContainText("11月26日");
  await page.reload();
  await expect(page.getByRole("heading", { name: future.title })).toBeVisible();
  await expect(page.getByRole("link", { name: "在智能日历中查看当前事项" })).toHaveAttribute("href", /day=2026-11-26/);
  expect(errors).toEqual([]);
});
