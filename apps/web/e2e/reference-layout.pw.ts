import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve("../../.appdata/qa/online-restored");

test("preserves measured online layouts with real empty-account state", async ({ page, request }, info) => {
  const email = `reference-${info.project.name}-${Date.now()}@example.com`;
  const password = "Reference-Layout-2026!";
  const registration = await request.post("/api/v1/auth/register", {
    data: { email, password, displayName: "界面验收账号", timezone: "Asia/Shanghai" },
  });
  expect(registration.ok()).toBe(true);
  await mkdir(output, { recursive: true });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "账户通行证" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const auth = await page.locator(".auth-panel").boundingBox();
  expect(auth).not.toBeNull();
  expect(auth!.width).toBeCloseTo(info.project.name === "desktop" ? 440 : 358, 0);
  if (info.project.name === "mobile") expect(auth!.y).toBeCloseTo(16, 0);
  await page.screenshot({ path: path.join(output, `${info.project.name}-login.png`) });

  await page.getByLabel("邮箱地址").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录并进入工作台" }).click();
  await expect(page).toHaveURL(/\/focus$/);
  await expect(page.getByRole("heading", { name: "今天没有更多日程" })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  const control = await page.locator(".focus-control").boundingBox();
  if (info.project.name === "desktop") {
    const metric = await page.locator(".focus-page .metric-card").first().boundingBox();
    expect(metric!.height).toBeCloseTo(84, 0);
    expect(metric!.x).toBeCloseTo(292, 0);
    expect(metric!.y).toBeCloseTo(96, 0);
    expect(control!.x).toBeCloseTo(292, 0);
    expect(control!.y).toBeCloseTo(204, 0);
    expect(control!.width).toBeCloseTo(736, 0);
    expect(control!.height).toBeCloseTo(256, 0);
  } else {
    await expect(page.getByRole("region", { name: "今日节律" })).toBeVisible();
    const selected = page.locator(".mobile-navigation a.active");
    expect(await selected.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(22, 61, 61)");
  }
  await page.screenshot({ path: path.join(output, `${info.project.name}-focus.png`) });

  await page.goto("/calendar");
  await expect(page.locator(".time-map")).toBeVisible();
  if (info.project.name === "mobile") {
    const strip = page.getByRole("navigation", { name: "本周日期" });
    await expect(strip).toBeVisible();
    const date = strip.getByRole("button", { pressed: false }).first();
    const chosen = await date.locator("time").getAttribute("datetime");
    await date.click();
    await expect(page.getByLabel("跳转日期")).toHaveValue(chosen!);
    const rescue = await page.locator(".rescue-summary").boundingBox();
    const map = await page.locator(".time-map").boundingBox();
    expect(rescue!.y + rescue!.height).toBeLessThanOrEqual(map!.y);
  }
  await page.screenshot({ path: path.join(output, `${info.project.name}-calendar.png`) });

  await page.goto("/settings");
  await expect(page.getByLabel("显示名称")).toBeVisible();
  await expect(page.locator(".settings-privacy-principle")).toHaveCount(0);
  const account = await page.locator(".settings-account-card").boundingBox();
  const content = await page.locator(".workbench-content").evaluate(element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  });
  expect(account!.width).toBeCloseTo(content, 0);
  await page.screenshot({ path: path.join(output, `${info.project.name}-settings.png`) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await writeFile(path.join(output, `${info.project.name}-layout.json`), JSON.stringify({ auth, control, account, overflow }, null, 2));
});
