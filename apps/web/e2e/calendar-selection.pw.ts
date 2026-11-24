import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// Deliberate API fixtures isolate browser selection behavior; no production data or writes.
const profile={id:'calendar-qa',email:'calendar-qa@example.com',displayName:'日历交互验收',timezone:'Asia/Shanghai',themeMode:'light',createdAt:'2026-11-23T00:00:00Z',updatedAt:'2026-11-23T00:00:00Z'};
const items=Array.from({length:5},(_,index)=>({id:'calendar-item-'+index,userId:profile.id,title:'课程与专注安排 '+(index+1),notes:'日历选择浏览器测试记录',category:index%2?'routine':'deep_work',cognitiveLoad:'medium',flexibility:'flexible',status:'planned',durationMinutes:45,reminderMinutes:10,startAt:'2027-01-31T0'+(index+1)+':00:00Z',endAt:'2027-01-31T0'+(index+1)+':45:00Z',createdAt:profile.createdAt,updatedAt:profile.updatedAt}));
const output=path.resolve('../../.appdata/qa/calendar-selection');
async function prepare(page:Page){
 const writes:string[]=[];
 await page.route('**/api/v1/**',async route=>{
  const request=route.request(),url=new URL(request.url());let body:unknown={};
  if(request.method()!=='GET'&&!url.pathname.includes('/auth/'))writes.push(url.pathname);
  if(url.pathname.endsWith('/auth/refresh'))body={accessToken:'selection-browser-fixture',user:profile};
  else if(url.pathname.endsWith('/auth/ws-ticket')){await route.fulfill({status:503,json:{detail:'浏览器布局夹具不建立实时连接'}});return;}
  else if(url.pathname.endsWith('/health'))body={ok:true,dbStatus:'up'};
  else if(url.pathname.endsWith('/schedule/items'))body={items:items.filter(item=>Date.parse(item.startAt)<Date.parse(url.searchParams.get('to')!)&&Date.parse(item.endAt)>Date.parse(url.searchParams.get('from')!))};
  else if(url.pathname.endsWith('/rescue/history'))body={snapshots:[]};
  else if(url.pathname.endsWith('/energy/today'))body={localDay:url.searchParams.get('day'),score:70,dataFreshness:'baseline_only',hourlyCurve:[],focusShields:[]};
  await route.fulfill({json:body});
 });
 return writes;
}

test('calendar selection persists through month boundaries, reloads and browser history',async({page},info)=>{
 const writes=await prepare(page),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/calendar?day=2027-01-31&view=month');
 await expect(page.getByRole('region',{name:'月视图日程网格'})).toBeVisible();
 await page.getByRole('button',{name:'下一月',exact:true}).click();
 await expect(page.getByLabel('跳转日期',{exact:true})).toHaveValue('2027-02-28');
 await page.reload();await expect(page.getByRole('region',{name:'月视图日程网格'})).toBeVisible();
 await expect(page.getByLabel('跳转日期',{exact:true})).toHaveValue('2027-02-28');
 await page.getByRole('button',{name:'选择跳转日期',exact:true}).click();
 let picker=page.getByRole('dialog',{name:'选择日期',exact:true});
 await picker.getByLabel('年份').selectOption('2028');
 await picker.getByRole('button',{name:'2028-02-29',exact:true}).click();
 await expect(page.getByLabel('跳转日期',{exact:true})).toHaveValue('2027-02-28');
 await picker.getByRole('button',{name:'确认日期'}).click();
 await expect(page.getByLabel('跳转日期',{exact:true})).toHaveValue('2028-02-29');
 await page.getByRole('button',{name:'选择跳转日期',exact:true}).click();
 picker=page.getByRole('dialog',{name:'选择日期',exact:true});
 await expect(picker.getByRole('button',{name:'2028-02-29',exact:true})).toBeFocused();
 await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
 await expect(picker.getByLabel('月份')).toHaveValue('3');
 await picker.getByRole('button',{name:'取消',exact:true}).click();
 await expect(page.getByLabel('跳转日期',{exact:true})).toHaveValue('2028-02-29');
 await expect(page.getByRole('button',{name:'选择跳转日期',exact:true})).toBeFocused();
 await page.goBack();await expect(page.getByLabel('跳转日期',{exact:true})).toHaveValue('2027-02-28');
 await page.goForward();await expect(page.getByLabel('跳转日期',{exact:true})).toHaveValue('2028-02-29');
 await mkdir(output,{recursive:true});await page.getByRole('button',{name:'选择跳转日期',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'选择日期',exact:true})).toHaveCSS('opacity','1');
 await page.screenshot({animations:'disabled',path:path.join(output,info.project.name+'-date-picker.png')});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});

test('month overflow opens the full day and keyboard time selection creates only a draft',async({page},info)=>{
 const writes=await prepare(page);await page.goto('/calendar?day=2027-01-31&view=month');
 const agenda=page.getByRole('region',{name:'所选日期日程'});
 await expect(agenda.getByRole('button',{name:/查看 课程与专注安排/})).toHaveCount(5);
 await mkdir(output,{recursive:true});await page.screenshot({animations:'disabled',path:path.join(output,info.project.name+'-month.png'),fullPage:true});
 await page.getByRole('button',{name:'查看 2027-01-31 的全部 5 项日程',exact:true}).click();
 await expect(page.getByRole('button',{name:'日视图',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'周视图',exact:true}).click();
 const column=page.getByRole('button',{name:'2027-01-30 新增日程',exact:true});
 await column.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
 const editor=page.getByRole('dialog',{name:'新增日程',exact:true});
 await expect(editor).toHaveAttribute('data-motion-state','open');
 await expect(editor.getByLabel('开始时间',{exact:true})).toHaveValue('2027-01-31T09:30');
 await expect(editor.getByLabel('结束时间',{exact:true})).toHaveValue('2027-01-31T10:30');
 await page.screenshot({animations:'disabled',path:path.join(output,info.project.name+'-selected-draft.png')});
 await editor.getByRole('button',{name:'关闭',exact:true}).click();await expect(editor).toHaveCount(0);
 await expect(page.getByRole('button',{name:'2027-01-31 新增日程',exact:true})).toBeFocused();
 await expect(page).not.toHaveURL(/time=/);expect(writes).toEqual([]);
});
test('selected calendar days use a calm fill without a left red strip', async ({ page }, info) => {
 const writes = await prepare(page), errors: string[] = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.route('**/api/v1/energy/today?**', route => {
  const day = new URL(route.request().url()).searchParams.get('day');
  return route.fulfill({ json: { localDay: day, score: 24, tier: 'depleted', dataFreshness: 'baseline_only', focusShields: [], hourlyCurve: [{ hourStartAt: `${day}T01:00:00Z`, score: 24, tier: 'depleted' }] } });
 });
 await page.goto('/calendar?day=2027-01-31&view=week');
 await expect(page.locator('.map-energy-band')).toHaveCount(0);
 await expect(page.locator('.map-date.selected')).toContainText('精力 24');
 await expect(page.locator('.map-day[data-selected="true"]')).toHaveAttribute('data-day', '2027-01-31');
 const wash = page.locator('.map-energy-wash .energy-wash-depleted');
 await expect(wash).toHaveCount(1);
 expect((await wash.boundingBox())!.width).toBeGreaterThan(90);
 await expect(page.getByRole('group', { name: '日历视图', exact: true })).toBeVisible();
 await page.getByRole('button', { name: '筛选', exact: true }).click();
 const energyToggle = page.getByRole('checkbox', { name: '精力预测底色', exact: true });
 await energyToggle.uncheck(); await expect(page.locator('.map-energy-wash')).toHaveCount(0);
 await energyToggle.check(); await expect(wash).toHaveCount(1);
 await page.getByRole('button', { name: '筛选', exact: true }).click();
 await page.getByRole('button', { name: '月视图', exact: true }).click();
 await expect(page.getByRole('region', { name: '月视图日程网格' })).toBeVisible();
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await page.emulateMedia({ reducedMotion: 'reduce' });
 const output = path.resolve('../../.appdata/qa/calendar-rebuild'); await mkdir(output, { recursive: true });
 for (const view of ['月视图', info.project.name === 'desktop' ? '周视图' : '日视图']) {
  await page.getByRole('button', { name: view, exact: true }).click();
  for (const theme of ['light', 'dark']) {
   await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
   await page.screenshot({ animations: 'disabled', path: path.join(output, `${info.project.name}-${view === '月视图' ? 'month' : 'time'}-${theme}.png`) });
  }
 }
 expect(writes).toEqual([]); expect(errors).toEqual([]);
});

test('keeps the date panel usable in narrow and short mobile windows',async({page},info)=>{
 test.skip(info.project.name!=='mobile','Mobile window boundary coverage');
 await prepare(page);await page.setViewportSize({width:280,height:640});
 await page.goto('/calendar?day=2027-01-31&view=month');
 await page.getByRole('button',{name:'选择跳转日期',exact:true}).click();
 const picker=page.getByRole('dialog',{name:'选择日期',exact:true});
 await expect(picker).toHaveCSS('opacity','1');
 let rect=(await picker.boundingBox())!;expect(rect.x).toBeGreaterThanOrEqual(11);expect(rect.x+rect.width).toBeLessThanOrEqual(269);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:480,height:320});
 await expect.poll(async()=>{const bounds=(await picker.boundingBox())!;return bounds.y+bounds.height;}).toBeLessThanOrEqual(309);
 await picker.getByRole('button',{name:'确认日期',exact:true}).scrollIntoViewIfNeeded();
 await expect(picker.getByRole('button',{name:'确认日期',exact:true})).toBeInViewport();
 await page.keyboard.press('Escape');await expect(picker).toHaveCount(0);
});

test('mouse hover uses an edge time hint while click and drag still create the correct draft',async({page},info)=>{
 test.skip(info.project.name!=='desktop','Mouse hover does not apply to touch-only navigation');
 const writes=await prepare(page),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width:1172,height:966});
 await page.goto('/calendar?day=2027-01-31&view=week');
 const column=page.getByRole('button',{name:'2027-01-29 新增日程',exact:true});
 await expect(column).toBeVisible();
 await page.locator('.time-map-scroll').evaluate(element=>element.scrollTop=0);
 let bounds=(await column.boundingBox())!;
 await page.mouse.move(bounds.x+bounds.width*.6,bounds.y+93,{steps:12});
 const hint=page.locator('[data-pointer-time-hint]');
 await expect(hint).toHaveText('09:30');
 await expect(page.locator('[data-slot-preview]')).toHaveCount(0);
 expect((await hint.boundingBox())!.width).toBeLessThanOrEqual(58);
 await expect(hint).toHaveCSS('pointer-events','none');
 await page.mouse.move(bounds.x+bounds.width*.6,bounds.y+125,{steps:16});
 await expect(hint).toHaveText('10:00');
 await expect(page.locator('[data-slot-preview]')).toHaveCount(0);
 await mkdir(output,{recursive:true});
 await page.screenshot({path:path.join(output,'desktop-hover-time-light.png'),animations:'disabled'});
 await page.evaluate(()=>document.documentElement.classList.add('dark'));
 await page.screenshot({path:path.join(output,'desktop-hover-time-dark.png'),animations:'disabled'});
 await page.evaluate(()=>document.documentElement.classList.remove('dark'));
 await page.mouse.move(400,180);
 await expect(hint).toHaveCount(0);
 bounds=(await column.boundingBox())!;
 await page.mouse.click(bounds.x+bounds.width*.6,bounds.y+93);
 let editor=page.getByRole('dialog',{name:'新增日程',exact:true});
 await expect(editor.getByLabel('开始时间',{exact:true})).toHaveValue('2027-01-29T09:30');
 await page.keyboard.press('Escape');await expect(editor).toHaveCount(0);
 await page.locator('.time-map-scroll').evaluate(element=>element.scrollTop=0);
 bounds=(await column.boundingBox())!;
 await page.mouse.move(bounds.x+bounds.width*.6,bounds.y+93);
 await expect(hint).toHaveText('09:30');
 await expect(page.locator('[data-slot-preview]')).toHaveCount(0);
 await page.mouse.down();
 await expect(column).toHaveCSS('transform','none');
 expect((await column.boundingBox())!.y).toBeCloseTo(bounds.y,2);
 await page.mouse.move(bounds.x+bounds.width*.6,bounds.y+153,{steps:10});
 await expect(page.locator('.map-drag-create-preview')).toBeVisible();
 await expect(hint).toHaveCount(0);
 await page.mouse.up();
 editor=page.getByRole('dialog',{name:'新增日程',exact:true});
 await expect(editor.getByLabel('开始时间',{exact:true})).toHaveValue('2027-01-29T09:30');
 await expect(editor.getByLabel('结束时间',{exact:true})).toHaveValue('2027-01-29T10:30');
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});
