import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const origin = "http://127.0.0.1:5173";
const output = path.resolve(".impeccable/review");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const user = { id: "visual-qa-user", displayName: "时序验收", email: "visual@example.com", timezone: "Asia/Shanghai", themeMode: "light", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-20T00:00:00Z" };
const workspace = { id: "visual-qa-team", name: "节律协作组", description: "", ownerId: user.id, inviteCode: "QA-TEAM", memberCount: 1, myRole: "owner", myPrivacyLevel: "busy_only", createdAt: user.createdAt, updatedAt: user.updatedAt };
const member = { workspaceId: workspace.id, userId: user.id, displayName: user.displayName, timezone: user.timezone, role: "owner", privacyLevel: "busy_only", joinedAt: user.createdAt };
const task = { id: "visual-qa-schedule", userId: user.id, title: "准备季度路线图", notes: "整理核心议题与决策材料", category: "deep_work", cognitiveLoad: "medium", flexibility: "flexible", status: "planned", startAt: new Date(`${day}T09:00:00+08:00`).toISOString(), endAt: new Date(`${day}T10:30:00+08:00`).toISOString(), durationMinutes: 90, reminderMinutes: 10, createdAt: user.createdAt, updatedAt: user.updatedAt };
const energy = { localDay: day, timezone: user.timezone, computedAt: new Date().toISOString(), score: 72, tier: "steady", dataFreshness: "baseline_only", drivers: { sleepRecoveryScore: 30, autonomicDeltaScore: 0, circadianScore: 31, cognitiveLoadDrainScore: -2, recoveryBufferBonusScore: 13, summary: "使用服务端节律基线与今日安排生成估算；尚未连接穿戴样本。" }, diagnostics: { baselineReadyDays: 0 }, focusShields: [], hourlyCurve: [1, 2, 3, 4, 5, 6].map((hour, index) => ({ hourStartAt: new Date(`${day}T${String(hour).padStart(2, "0")}:00:00+08:00`).toISOString(), score: [54, 61, 72, 68, 57, 48][index], tier: ["strained", "steady", "steady", "steady", "steady", "strained"][index] })) };
const energyProfile = { userId: user.id, chronotype: "balanced", workStartMinute: 540, workEndMinute: 1080, minRecoveryBufferMin: 15, preferredFocusWindows: [], updatedAt: user.updatedAt };
const ok = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN", timezoneId: user.timezone, colorScheme: "light" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.route("**/api/v1/**", async route => {
  const request = route.request();
  const url = new URL(request.url());
  const { pathname } = url;
  if (pathname === "/api/v1/auth/refresh") return ok(route, { accessToken: "visual-qa-access", refreshToken: "visual-qa-refresh", expiresInSeconds: 900, user });
  if (pathname === "/api/v1/auth/me") return ok(route, user);
  if (pathname === "/api/v1/health") return ok(route, { health: { version: "2.0.0", dbStatus: "up", serverTime: new Date().toISOString() }, roundTripMs: 12.4 });
  if (pathname === "/api/v1/energy/today") return ok(route, energy);
  if (pathname === "/api/v1/energy/profile") return ok(route, energyProfile);
  if (pathname === "/api/v1/schedule/items") return ok(route, { items: [task], baselineVersion: "qa-baseline", baselineLocalDay: day });
  if (pathname.endsWith("/rescue/history")) return ok(route, { snapshots: [] });
  if (pathname === "/api/v1/workspaces") return ok(route, { workspaces: [workspace] });
  if (pathname.endsWith("/members")) return ok(route, { workspaceId: workspace.id, members: [member] });
  if (pathname.endsWith("/availability")) return ok(route, { workspaceId: workspace.id, members: [{ userId: user.id, displayName: user.displayName, timezone: user.timezone, privacyLevel: "busy_only", workStartMinute: 540, workEndMinute: 1080, slots: [] }] });
  if (pathname.endsWith("/meetings")) return ok(route, { meetings: [] });
  if (pathname.endsWith("/recommend")) return ok(route, { recommendations: [], blockingDiagnostics: [] });
  return ok(route, { type: "about:blank", title: "Visual QA fixture", status: 503, detail: "This read-only visual fixture has no response for this endpoint." }, 503);
});

const routes = [
  ["focus", "/focus"], ["calendar", "/calendar"], ["microtasks", "/microtasks"], ["goals", "/goals"],
  ["team", "/team"], ["review", "/review"], ["diagnostics", "/diagnostics"], ["profile", "/profile"],
  ["energy", "/energy"], ["settings", "/settings"], ["integrations", "/integrations"], ["bluetooth", "/bluetooth"],
];
const reports = [];
for (const [size, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]]) {
  await page.setViewportSize(viewport);
  for (const [name, route] of routes) {
    await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded" });
    await page.locator(".workbench-content").waitFor({ state: "visible" });
    await page.waitForTimeout(650);
    await page.evaluate(() => document.fonts.ready);
    const state = await page.evaluate(() => ({
      title: document.querySelector('[role="dialog"] h1, [role="dialog"] h2')?.textContent?.trim() ?? document.querySelector(".workbench-content h1, .workbench-content h2")?.textContent?.trim() ?? "missing heading",
      dialogTitle: document.querySelector('[role="dialog"] h1, [role="dialog"] h2')?.textContent?.trim() ?? null,
      theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      mainHeight: Math.round(document.querySelector(".workbench-content")?.getBoundingClientRect().height ?? 0),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
    }));
    const overflow = state.documentWidth > state.viewportWidth;
    const filename = `${size}-${name}.png`;
    await page.screenshot({ path: path.join(output, filename), fullPage: true });
    reports.push({ size, route, filename, ...state, overflow });
  }

  const drawers = [
    ["preferences", "/focus?preferences=1", "系统偏好与设置"],
    ["calendar", "/calendar?new=1", "新增日程"],
    ["microtasks", "/microtasks?panel=new", "新建微任务"],
    ["goals", "/goals?panel=new", "新建目标"],
    ["integrations", "/integrations", "跨平台接入与文本解析"],
  ];
  for (const [name, route, title] of drawers) {
    await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("dialog", { name: title }).waitFor({ state: "visible" });
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(output, `${size}-drawer-${name}.png`), fullPage: false });
  }
  await page.goto(`${origin}/team`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /发起智能排会/ }).click();
  await page.getByRole("dialog", { name: "寻找黄金协作窗口" }).waitFor({ state: "visible" });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(output, `${size}-drawer-team-meeting.png`), fullPage: false });

  user.themeMode = "dark";
  for (const [name, route] of routes) {
    await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded" });
    await page.locator(".workbench-content").waitFor({ state: "visible" });
    await page.waitForTimeout(650);
    await page.evaluate(() => document.fonts.ready);
    const state = await page.evaluate(() => ({
      title: document.querySelector('[role="dialog"] h1, [role="dialog"] h2')?.textContent?.trim() ?? document.querySelector(".workbench-content h1, .workbench-content h2")?.textContent?.trim() ?? "missing heading",
      dialogTitle: document.querySelector('[role="dialog"] h1, [role="dialog"] h2')?.textContent?.trim() ?? null,
      theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      mainHeight: Math.round(document.querySelector(".workbench-content")?.getBoundingClientRect().height ?? 0),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
    }));
    const overflow = state.documentWidth > state.viewportWidth;
    const filename = `${size}-dark-${name}.png`;
    await page.screenshot({ path: path.join(output, filename), fullPage: true });
    reports.push({ size, theme: "dark", route, filename, ...state, overflow });
  }

  await page.goto(`${origin}/focus?preferences=1`, { waitUntil: "domcontentloaded" });
  await page.getByRole("dialog", { name: "系统偏好与设置" }).waitFor({ state: "visible" });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(output, `${size}-dark-drawer-preferences.png`), fullPage: false });
  user.themeMode = "light";
}

await writeFile(path.join(output, "visual-qa-report.json"), JSON.stringify({ day, routes: reports, pageErrors: errors }, null, 2));
await browser.close();
console.log(JSON.stringify({ routes: reports.length, overflow: reports.filter(item => item.overflow), pageErrors: errors, output }, null, 2));
