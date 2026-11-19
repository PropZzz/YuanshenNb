import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const ZOOM_WIDTHS = [1440, 1152, 960, 823, 781, 780, 640, 480, 390, 320, 280] as const;

async function registerAndLogin(page: Page, request: APIRequestContext, tag: string) {
  const email = `zoom-${tag}-${Date.now()}@example.com`;
  const password = "Zoom-Overflow-2026!";
  const response = await request.post("/api/v1/auth/register", {
    data: { email, password, displayName: "缩放验收账号", timezone: "Asia/Shanghai" },
  });
  expect(response.ok()).toBe(true);
  const session = await response.json();

  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const created = await request.post("/api/v1/schedule/items", {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    data: {
      title: "自适应缩放与容器边界联调会议",
      notes: "验证高倍率浏览器缩放及超窄视口下的零溢出渲染",
      category: "deep_work",
      cognitiveLoad: "medium",
      flexibility: "flexible",
      startAt: new Date(`${day}T09:00:00+08:00`).toISOString(),
      endAt: new Date(`${day}T11:00:00+08:00`).toISOString(),
      reminderMinutes: 10,
    },
  });
  expect(created.ok()).toBe(true);

  await page.goto("/login");
  await page.getByLabel("邮箱地址").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录并进入工作台" }).click();
  await expect(page).toHaveURL(/\/focus$/);
}

async function assertZeroOverflow(page: Page, contextLabel: string) {
  const report = await page.evaluate(() => {
    const vw = window.innerWidth;
    const docScrollW = document.documentElement.scrollWidth;
    const violations: string[] = [];

    for (const el of document.querySelectorAll("body *")) {
      if (el instanceof SVGElement && el.tagName.toLowerCase() !== "svg") continue;
      const clsStr = typeof el.className === "string" ? el.className : "";
      if (clsStr.includes("sr-only")) continue;

      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      let insideScrollContainer = false;
      let parent = el.parentElement;
      while (parent) {
        const pStyle = getComputedStyle(parent);
        if ((pStyle.overflowX === "auto" || pStyle.overflowX === "scroll") && parent.scrollWidth > parent.clientWidth) {
          insideScrollContainer = true;
          break;
        }
        parent = parent.parentElement;
      }

      const tag = el.tagName.toLowerCase();
      const cls = clsStr.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
      const label = tag + (cls ? `.${cls}` : "");

      if (!insideScrollContainer && rect.right > vw + 2) {
        violations.push(`viewport-right:${label}(${Math.round(rect.right)}>${vw})`);
      }
      if (!insideScrollContainer && rect.left < -2) {
        violations.push(`viewport-left:${label}(${Math.round(rect.left)}<0)`);
      }
      if (
        tag !== "svg" &&
        style.overflowX !== "auto" &&
        style.overflowX !== "scroll" &&
        !clsStr.includes("event-title") &&
        !clsStr.includes("event-time") &&
        el.clientWidth > 0 &&
        el.scrollWidth > el.clientWidth + 3
      ) {
        violations.push(`elem-scrollX:${label}(${el.scrollWidth}>${el.clientWidth})`);
      }
      if (
        tag !== "svg" &&
        (style.overflowY === "hidden" || style.overflow === "hidden") &&
        !clsStr.includes("truncate") &&
        !clsStr.includes("map-event") &&
        !clsStr.includes("cal-event-compact") &&
        el.clientHeight > 0 &&
        el.scrollHeight > el.clientHeight + 3
      ) {
        violations.push(`elem-clippedY:${label}(${el.scrollHeight}>${el.clientHeight})`);
      }
    }

    return {
      vw,
      docScrollW,
      violations: violations.slice(0, 8),
    };
  });

  expect(report.docScrollW, `${contextLabel} document scrollWidth`).toBeLessThanOrEqual(report.vw + 1);
  expect(report.violations, `${contextLabel} element violations`).toEqual([]);
}

test("enforces zero overflow across zoomed viewports and font scaling on all workbench routes", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "Viewport sweep covers both desktop and mobile widths once.");
  test.setTimeout(240_000);

  for (const width of [1440, 960, 781, 390, 280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/login");
    await page.evaluate(() => document.fonts.ready);
    await assertZeroOverflow(page, `/login@${width}`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await registerAndLogin(page, request, "sweep");

  const routes = [
    "/focus",
    "/calendar",
    "/team",
    "/energy",
    "/settings",
    "/profile",
    "/microtasks",
    "/goals",
    "/review",
    "/integrations",
    "/diagnostics",
    "/bluetooth",
    "/settings-drawer",
    "/create-schedule",
    "/urgent-task",
  ];

  for (const route of routes) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route);
    await expect(page.locator(".workbench-content")).toBeVisible();
    await expect(page.locator(".workbench-content .state-panel[role=status]")).toHaveCount(0);
    const drawer = page.locator('[role="dialog"][data-surface="drawer"]');
    if ((await drawer.count()) > 0) {
      await expect(drawer.last()).toHaveAttribute("data-motion-state", "open");
    }
    await page.evaluate(() => document.fonts.ready);

    for (const width of ZOOM_WIDTHS) {
      await page.setViewportSize({ width, height: 844 });
      if ((await drawer.count()) > 0) {
        await expect(drawer.last()).toHaveAttribute("data-motion-state", "open");
      }
      await assertZeroOverflow(page, `${route}@${width}`);
    }
  }

  for (const viewLabel of ["月视图", "甘特视图"]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/calendar");
    await page.getByRole("button", { name: viewLabel }).click();
    for (const width of [1152, 960, 781, 390, 280]) {
      await page.setViewportSize({ width, height: 844 });
      await assertZeroOverflow(page, `/calendar-${viewLabel}@${width}`);
    }
  }

  for (const width of [1440, 960, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/focus", "/calendar", "/team", "/energy", "/settings", "/profile", "/microtasks", "/review"]) {
      await page.goto(route);
      await expect(page.locator(".workbench-content")).toBeVisible();
      await expect(page.locator(".workbench-content .state-panel[role=status]")).toHaveCount(0);
      await page.evaluate(async () => {
        await document.fonts.ready;
        document.documentElement.style.fontSize = "200%";
      });
      await assertZeroOverflow(page, `${route}[font200%]@${width}`);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
      });
    }
  }
});
