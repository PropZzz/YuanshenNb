import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const day = '2026-11-23';
const output = path.resolve('../../.appdata/qa/schedule-detail');
test.use({ actionTimeout: 15_000 });

async function account(page: Page, request: APIRequestContext) {
  const email = `detail-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = 'Calendar-detail-2026!';
  const response = await request.post('/api/v1/auth/register', { data: { email, password, displayName: '日程详情验收', timezone: 'Asia/Shanghai' } });
  expect(response.ok()).toBe(true);
  const session = await response.json();
  await page.goto('/login');
  await page.getByLabel('邮箱地址').fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录并进入工作台' }).click();
  await expect(page).toHaveURL(/\/focus$/);
  return { Authorization: `Bearer ${session.accessToken}` };
}
async function records(request: APIRequestContext, headers: Record<string, string>) {
  const response = await request.get('/api/v1/schedule/items', { headers, params: { from: '2026-11-22T16:00:00Z', to: '2026-11-25T16:00:00Z' } });
  expect(response.ok()).toBe(true); return (await response.json()).items;
}
async function noOverflow(page: Page) {
  const dialog = page.getByRole('dialog', { name: '日程详情', exact: true });
  expect(await dialog.locator('.dialog-body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await dialog.locator('.dialog-footer').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(dialog.getByRole('button', { name: '编辑日程', exact: true })).toBeInViewport();
  for (const selector of ['.schedule-detail-date-tile>span', '.schedule-detail-action-row .button-secondary']) {
    const element = dialog.locator(selector);
    if (selector.includes('button')) await element.hover();
    const contrast = await element.evaluate(el => {
      const style = getComputedStyle(el), canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1; const context = canvas.getContext('2d')!;
      const luminance = (color: string) => {
        context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
        const rgb = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(channel => {
          const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
        });
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const foreground = luminance(style.color), background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
    });
    expect(contrast, selector + ' text contrast').toBeGreaterThanOrEqual(4.5);
  }
}

test('renders real saved details and persists complete, reopen, edit and confirmed deletion', async ({ page, request }, info) => {
  test.setTimeout(150_000);
  const headers = await account(page, request), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/goals');
  await page.getByRole('button', { name: '新建目标', exact: true }).click();
  await page.getByLabel('目标名称', { exact: true }).fill('完成版本架构评审');
  await page.getByRole('button', { name: '保存目标到本机', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(`/calendar?day=${day}&view=week&new=1&time=09%3A00`);
  let editor = page.getByRole('dialog', { name: '新增日程', exact: true });
  await editor.getByLabel('日程标题', { exact: true }).fill('Web 版本架构与交互方案评审');
  await editor.getByLabel('备注（可选）', { exact: true }).fill('确认日历交互与接口边界，梳理发布前待办。\n评审结论记入版本文档；与会人员会后补充各自的行动项。');
  await editor.getByRole('button', { name: '方案评审', exact: true }).click();
  await editor.getByRole('combobox', { name: '关联目标', exact: true }).selectOption({ label: '完成版本架构评审' });
  await editor.getByRole('radio', { name: /硬约束防挤压锁定/ }).check();
  await editor.getByRole('button', { name: '高认知负荷', exact: true }).click();
  await editor.getByLabel('截止时间（可选）', { exact: true }).fill('2026-11-23T18:00');
  await editor.getByRole('button', { name: '保存日程', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const saved = (await records(request, headers))[0]; expect(saved.presentation.attributeTag).toBe('review');
  const detailUrl = `/calendar?day=${day}&view=week&detail=${saved.id}`;
  await page.goto(detailUrl);
  let dialog = page.getByRole('dialog', { name: '日程详情', exact: true });
  await expect(dialog).toHaveAttribute('data-motion-state', 'open');
  await expect(dialog.getByRole('heading', { name: saved.title, exact: true })).toBeVisible();
  await expect(dialog.getByText('方案评审', { exact: true })).toBeVisible();
  await expect(dialog.getByText('完成版本架构评审', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('region', { name: '排期保护', exact: true })).toContainText('硬约束防挤压锁定');
  await expect(dialog.getByText('当前未接入系统通知。', { exact: false })).toBeVisible();
  expect(await dialog.getByRole('heading', { name: saved.title, exact: true }).evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(23);
  await noOverflow(page);
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, info.project.name + '-detail.png') });
  await dialog.getByText('记录信息', { exact: true }).click();
  await dialog.locator('.schedule-detail-record').scrollIntoViewIfNeeded();
  await expect(dialog.getByText(saved.id, { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(output, info.project.name + '-record.png') });
  await dialog.getByRole('button', { name: '标记完成', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await records(request, headers))[0].status).toBe('completed');
  await page.goto(detailUrl); dialog = page.getByRole('dialog', { name: '日程详情', exact: true });
  await expect(dialog.getByText('已完成', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '重新打开', exact: true }).click();
  await expect(dialog).toHaveCount(0); expect((await records(request, headers))[0].status).toBe('planned');
  await page.goto(detailUrl); await page.getByRole('button', { name: '编辑日程', exact: true }).click();
  editor = page.getByRole('dialog', { name: '编辑日程', exact: true });
  await expect(editor.getByLabel('日程标题', { exact: true })).toHaveValue(saved.title);
  await editor.getByLabel('日程标题', { exact: true }).fill(saved.title + '（已确认）');
  await editor.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(editor).toHaveCount(0); expect((await records(request, headers))[0].title).toContain('已确认');
  await page.goto(detailUrl); dialog = page.getByRole('dialog', { name: '日程详情', exact: true });
  await dialog.getByRole('button', { name: '删除日程', exact: true }).click();
  await dialog.getByRole('button', { name: '保留日程', exact: true }).click();
  expect(await records(request, headers)).toHaveLength(1);
  await dialog.getByRole('button', { name: '删除日程', exact: true }).click();
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog).toHaveCount(0); expect(await records(request, headers)).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('handles cross-day, missing, long and dark details and recovers from a failed status write', async ({ page, request }, info) => {
  test.setTimeout(120_000); const headers = await account(page, request);
  const response = await request.post('/api/v1/schedule/items', { headers, data: {
    title: '跨日接口验证与发布前最后一轮交互细节核对 / ' + 'LongTitle'.repeat(8),
    notes: '排期说明\n' + '边界记录'.repeat(60), category: 'deep_work', cognitiveLoad: 'medium', flexibility: 'focus_shield',
    startAt: '2026-11-23T15:30:00Z', endAt: '2026-11-23T16:30:00Z', reminderMinutes: 1440, deadlineAt: '2026-11-23T16:00:00Z', presentation: { attributeTag: 'coding' },
  } }); expect(response.ok()).toBe(true); const { item } = await response.json();
  await request.patch(`/api/v1/schedule/items/${item.id}`, { headers, data: { status: 'in_progress' } });
  const url = `/calendar?day=${day}&view=week&detail=${item.id}`; await page.goto(url);
  const dialog = page.getByRole('dialog', { name: '日程详情', exact: true });
  await expect(dialog.getByText('进行中', { exact: true })).toBeVisible();
  await expect(dialog.getByText('11月24日星期二', { exact: true })).toBeVisible();
  await expect(dialog.locator('time[datetime="2026-11-22T15:30:00.000Z"]')).toHaveText('2026年11月22日 23:30');
  await expect(dialog.getByText('安排结束晚于截止时间')).toBeVisible();
  await expect(dialog.getByText('未关联目标', { exact: true })).toBeVisible();
  await page.route(`**/api/v1/schedule/items/${item.id}`, async route => {
    if (route.request().method() === 'PATCH') await route.fulfill({ status: 503, json: { type: 'about:blank', title: 'Unavailable', code: 'SERVICE_UNAVAILABLE', status: 503, detail: '验收注入：暂时无法保存，请重试' } });
    else await route.continue();
  });
  await dialog.getByRole('button', { name: '标记完成', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('暂时无法保存');
  await expect(dialog.getByRole('button', { name: '标记完成', exact: true })).toBeEnabled();
  expect((await records(request, headers))[0].status).toBe('in_progress');
  await page.unroute(`**/api/v1/schedule/items/${item.id}`);
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await noOverflow(page); await mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, info.project.name + '-dark-long.png') });
  await dialog.getByRole('button', { name: '标记完成', exact: true }).click();
  await expect(dialog).toHaveCount(0); expect((await records(request, headers))[0].status).toBe('completed');
});
