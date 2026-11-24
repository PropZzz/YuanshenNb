import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// Explicit layout fixtures; these cases never write the user's schedules.
const profile = { id: 'layout-qa', email: 'layout-qa@example.com', displayName: '日程布局验收', timezone: 'Asia/Shanghai', themeMode: 'light', createdAt: '2026-11-23T00:00:00Z', updatedAt: '2026-11-23T00:00:00Z' };
const base = { userId: profile.id, category: 'deep_work', cognitiveLoad: 'medium', flexibility: 'focus_shield', status: 'planned', reminderMinutes: 10, presentation: { attributeTag: 'coding', goalId: 'layout-goal', goalTitle: '完成项目架构' }, createdAt: profile.createdAt, updatedAt: profile.updatedAt };
const items = [
  { ...base, id: 'short', title: '架构设计与需求讨论的完整中文标题', notes: '记录短时讨论结论。\n教室：图书馆北区五楼研讨室501（东侧入口）', startAt: '2026-11-24T01:00:00Z', endAt: '2026-11-24T01:15:00Z', durationMinutes: 15 },
  { ...base, id: 'overlap', title: '并行评审与跨部门协作', notes: '地点：A101', startAt: '2026-11-24T01:00:00Z', endAt: '2026-11-24T02:00:00Z', durationMinutes: 60, presentation: { attributeTag: 'review' }, category: 'meeting' },
  { ...base, id: 'spacious', title: '项目架构设计与接口实现', notes: '整理接口边界，并记录下一步行动。\n地点：B座507', startAt: '2026-11-24T05:00:00Z', endAt: '2026-11-24T07:00:00Z', durationMinutes: 120, status: 'completed' },
  { ...base, id: 'wide', title: '跨日项目推进', notes: '验证长条仍能显示标题。', startAt: '2026-11-25T01:00:00Z', endAt: '2026-11-27T01:00:00Z', durationMinutes: 2880 },
];
const output = path.resolve('../../.appdata/qa/calendar-view-layout');

async function capture(page: Page, project: string, view: string) {
  await page.screenshot({ path: path.join(output, `${project}-${view}.png`), animations: 'disabled', fullPage: true });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ path: path.join(output, `${project}-${view}-dark.png`), animations: 'disabled', fullPage: true });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
}

async function prepare(page: Page) {
  const writes: string[] = [];
  await page.addInitScript(() => localStorage.setItem('ruanchuang-calendar-options', JSON.stringify({ autoScroll: false })));
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()); let body: unknown = {};
    if (request.method() !== 'GET' && !url.pathname.includes('/auth/')) writes.push(url.pathname);
    if (url.pathname.endsWith('/auth/refresh')) body = { accessToken: 'layout-fixture', user: profile };
    else if (url.pathname.endsWith('/auth/ws-ticket')) { await route.fulfill({ status: 503, json: { detail: '布局夹具不连接实时服务' } }); return; }
    else if (url.pathname.endsWith('/health')) body = { ok: true, dbStatus: 'up' };
    else if (url.pathname.endsWith('/schedule/items')) body = { items: items.filter(item => Date.parse(item.startAt) < Date.parse(url.searchParams.get('to')!) && Date.parse(item.endAt) > Date.parse(url.searchParams.get('from')!)) };
    else if (url.pathname.endsWith('/rescue/history')) body = { snapshots: [] };
    else if (url.pathname.endsWith('/energy/today')) body = { localDay: url.searchParams.get('day'), score: 70, dataFreshness: 'baseline_only', hourlyCurve: [], focusShields: [] };
    await route.fulfill({ json: body });
  });
  await mkdir(output, { recursive: true });
  return writes;
}

test('gantt keeps short intervals proportional with bounded readable labels', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1172, height: 966 });
  const writes = await prepare(page);
  await page.goto('/calendar?day=2026-11-24&view=gantt&scale=week');
  await expect(page.locator('.cal-gantt-bar')).toHaveCount(4);
  await capture(page, info.project.name, 'gantt-week');
  const short = page.locator('.cal-gantt-row').filter({ has: page.getByRole('button', { name: items[0].title + ' 09:00至09:15', exact: true }) });
  const bar = short.locator('.cal-gantt-bar'), track = short.locator('.cal-gantt-track');
  const barBox = (await bar.boundingBox())!, trackBox = (await track.boundingBox())!;
  expect(Math.abs(barBox.width - trackBox.width * 15 / (7 * 1440))).toBeLessThan(0.6);
  await expect(bar.locator('span')).toBeHidden();
  const label = short.locator('.cal-gantt-label');
  await expect(label.locator('.event-location')).toHaveText('图书馆北区五楼研讨室501（东侧入口）');
  expect(await label.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await label.click();
  await expect(page.getByRole('dialog', { name: '日程详情', exact: true })).toContainText(items[0].title);
  await expect(page.getByRole('dialog', { name: '日程详情', exact: true }).getByText('图书馆北区五楼研讨室501（东侧入口）',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '日程详情', exact: true })).toHaveCount(0);
  await page.locator('.cal-gantt-scroll').evaluate(element => element.scrollLeft = 0);
  await bar.click();
  await expect(page.getByRole('dialog', { name: '日程详情', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '按日', exact: true }).click();
  await expect(page.locator('.cal-gantt-scroll')).toHaveAttribute('data-gantt-scale', 'day');
  expect(await page.locator('.cal-gantt-scroll').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture(page, info.project.name, 'gantt-day');
  expect(writes).toEqual([]);
});

test('day, week and month cards adapt their typography and density to available space', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1172, height: 966 });
  const writes = await prepare(page);
  await page.goto('/calendar?day=2026-11-24&view=day');
  const spacious = page.getByRole('button', { name: items[2].title + ' 13:00至15:00', exact: true });
  await expect(spacious).toBeVisible();
  await capture(page, info.project.name, 'day');
  const dayTitleSize = await spacious.locator('.event-title').evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  expect(dayTitleSize).toBeGreaterThanOrEqual(info.project.name === 'desktop' ? 15 : 14);
  await expect(spacious.locator('.event-time')).toBeVisible();
  await expect(spacious.locator('.event-detail')).toContainText(items[2].notes.split('\n')[0]);
  await expect(spacious.locator('.event-detail')).not.toContainText('地点：');
  await expect(spacious.locator('.event-location')).toHaveText('B座507');
  await expect(spacious.locator('.event-location')).toBeVisible();
  if (info.project.name === 'desktop') {
    const title = (await spacious.locator('.event-title').boundingBox())!, time = (await spacious.locator('.event-time').boundingBox())!;
    expect(Math.abs(title.y - time.y)).toBeLessThan(5);
    await expect(spacious.locator('.event-status .metadata-text')).toBeVisible();
  }
  const short = page.getByRole('button', { name: items[0].title + ' 09:00至09:15', exact: true });
  await expect(short.locator('.schedule-meta')).toBeHidden();
  await expect(short.locator('.event-title')).toBeVisible();
  await expect(short.locator('.event-location')).toBeHidden();
  await page.getByRole('button', { name: '周视图', exact: true }).click();
  await expect(page.locator('.time-map-inner')).toHaveAttribute('data-view', 'week');
  await expect(spacious.locator('.event-title')).toHaveCSS('font-size', '12px');
  const weekTitleSize = await spacious.locator('.event-title').evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  expect(weekTitleSize).toBeLessThan(dayTitleSize);
  await expect(short.locator('.event-title')).toHaveCSS('white-space', 'nowrap');
  await expect(short.locator('.schedule-meta')).toBeHidden();
  await expect(spacious.locator('.event-location')).toBeVisible();
  const locatedCard=(await spacious.boundingBox())!,locatedRoom=(await spacious.locator('.event-location').boundingBox())!;
  expect(locatedRoom.y+locatedRoom.height).toBeLessThanOrEqual(locatedCard.y+locatedCard.height);
  await page.locator('.time-map-scroll').evaluate(element => element.scrollTop = 500);
  await capture(page, info.project.name, 'week');
  await page.getByRole('button', { name: '月视图', exact: true }).click();
  const month = page.locator('.cal-month-day.cal-selected');
  await expect(month.locator('.cal-event-compact')).toHaveCount(3);
  await expect(month.locator('.cal-event-compact').filter({hasText:items[2].title}).locator('.event-location')).toHaveText('B座507');
  await expect(page.locator('.cal-selected-agenda .event-location').filter({hasText:'B座507'})).toBeVisible();
  expect(await month.evaluate(element => Array.from(element.querySelectorAll('.cal-event-compact')).every(card => card.scrollWidth <= card.clientWidth))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture(page, info.project.name, 'month');
  expect(writes).toEqual([]);
});

test('saved course locations survive reload and remain bounded in compact day and week cards',async({page},info)=>{
 if(info.project.name==='desktop')await page.setViewportSize({width:1172,height:966});
 const writes=await prepare(page);
 await page.goto('/calendar?day=2026-11-24&view=week');
 const card=page.getByRole('button',{name:items[1].title+' 09:00至10:00',exact:true});
 await expect(card.locator('.event-location')).toBeVisible();
 await expect(card.locator('.event-location')).toHaveText('A101');
 await card.scrollIntoViewIfNeeded();
 const room=(await card.locator('.event-location').boundingBox())!,bounds=(await card.boundingBox())!;
 expect(room.y+room.height).toBeLessThanOrEqual(bounds.y+bounds.height);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await capture(page,info.project.name,'course-week');
 await page.reload();
 await expect(card.locator('.event-location')).toHaveText('A101');
 await page.getByRole('button',{name:'日视图',exact:true}).click();
 await expect(page.locator('.time-map-inner')).toHaveAttribute('data-view','day');
 await expect(card.locator('.event-location')).toBeVisible();
 await card.scrollIntoViewIfNeeded();
 const dayRoom=(await card.locator('.event-location').boundingBox())!,dayCard=(await card.boundingBox())!;
 expect(dayRoom.y+dayRoom.height).toBeLessThanOrEqual(dayCard.y+dayCard.height);
 await capture(page,info.project.name,'course-day');
 expect(writes).toEqual([]);
});
