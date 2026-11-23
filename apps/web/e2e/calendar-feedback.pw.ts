import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const day='2026-11-23',output=path.resolve('../../.appdata/qa/calendar-feedback');
test.use({actionTimeout:15_000});
async function account(page:Page,request:APIRequestContext){
 const email=`calendar-feedback-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,password='Calendar-feedback-2026!';
 const response=await request.post('/api/v1/auth/register',{data:{email,password,displayName:'日历功能验收',timezone:'Asia/Shanghai'}});expect(response.ok()).toBe(true);
 const session=await response.json();await page.goto('/login');await page.getByLabel('邮箱地址').fill(email);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录并进入工作台'}).click();await expect(page).toHaveURL(/\/focus$/);return session;
}
async function items(request:APIRequestContext,token:string){const response=await request.get('/api/v1/schedule/items',{headers:{Authorization:`Bearer ${token}`},params:{from:'2026-11-22T16:00:00Z',to:'2026-12-07T16:00:00Z'}});expect(response.ok()).toBe(true);return (await response.json()).items;}

test('persists selected attributes, distinct event colors, goals and exclusive constraints across all views',async({page,request},info)=>{
 test.setTimeout(150_000);const session=await account(page,request),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/goals');await page.getByRole('button',{name:'新建目标',exact:true}).click();
 await page.getByLabel('目标名称',{exact:true}).fill('完成学期计划');await page.getByRole('button',{name:'保存目标到本机',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.goto(`/calendar?day=${day}&view=week&new=1`);
 let editor=page.getByRole('dialog',{name:'新增日程',exact:true});await expect(editor).toHaveAttribute('data-motion-state','open');
 await editor.getByLabel('日程标题',{exact:true}).fill('课程属性验收');
 await editor.getByRole('button',{name:'上课学习',exact:true}).click();await editor.getByRole('combobox',{name:'关联目标',exact:true}).selectOption({label:'完成学期计划'});
 await editor.getByRole('radio',{name:/硬约束防挤压锁定/}).check();await expect(editor.getByRole('radio',{name:/排期灵活性微调/})).not.toBeChecked();
 const title=editor.getByLabel('日程标题',{exact:true});expect(await title.evaluate(el=>Number.parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThanOrEqual(12);
 await editor.getByRole('button',{name:'保存日程',exact:true}).click();await expect(editor).toHaveCount(0);
 const first=(await items(request,session.accessToken)).find((item:{title:string})=>item.title==='课程属性验收');
 expect(first.presentation).toMatchObject({attributeTag:'study',goalTitle:'完成学期计划'});expect(first.flexibility).toBe('hard_locked');
 const second=await request.post('/api/v1/schedule/items',{headers:{Authorization:`Bearer ${session.accessToken}`},data:{title:'考试属性验收',category:'deep_work',cognitiveLoad:'high',flexibility:'focus_shield',startAt:day+'T03:00:00Z',endAt:day+'T04:00:00Z',reminderMinutes:30,presentation:{attributeTag:'exam'}}});expect(second.ok()).toBe(true);
 await page.reload();await expect(page.locator('.map-event[data-attribute="study"]')).toBeVisible();
 const studyColor=await page.locator('.map-event[data-attribute="study"]').evaluate(el=>getComputedStyle(el).backgroundColor);
 const examColor=await page.locator('.map-event[data-attribute="exam"]').evaluate(el=>getComputedStyle(el).backgroundColor);expect(studyColor).not.toBe(examColor);
 for(const view of ['月视图','甘特视图','日视图','周视图']){
  await page.getByRole('button',{name:view,exact:true}).click();
  const event=page.locator('.calendar-map-column [data-attribute="study"]').first();await expect(event).toBeVisible();
  expect(await event.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(studyColor);
  for(const [label,selector] of [['属性标签','.event-category'],['完成状态','.event-status'],['缓冲与提醒','.event-reminder'],['战略目标关联','.event-goal-link']]){
   const map=page.locator('.calendar-map-column');expect(await map.locator(selector).count()).toBeGreaterThan(0);
   await page.getByRole('checkbox',{name:label,exact:true}).uncheck();await expect(map.locator(selector)).toHaveCount(0);
   await page.getByRole('checkbox',{name:label,exact:true}).check();
  }
 }
 await page.getByRole('checkbox',{name:'时间标尺',exact:true}).uncheck();await expect(page.locator('.map-hours')).toHaveCount(0);await page.getByRole('checkbox',{name:'时间标尺',exact:true}).check();
 await expect(page.locator('.map-energy-band')).toHaveCount(1);await page.getByRole('checkbox',{name:'精力预测色带',exact:true}).uncheck();await expect(page.locator('.map-energy-band')).toHaveCount(0);
 await page.reload();await expect(page.getByRole('checkbox',{name:'精力预测色带',exact:true})).not.toBeChecked();await page.getByRole('checkbox',{name:'精力预测色带',exact:true}).check();
 await expect(page.getByRole('region',{name:'日历真实数据概览'}).getByText('今日 2 项日程',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'日历真实数据概览'})).toContainText('节律估算');
 await mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,info.project.name+'-calendar.png')});
 await page.locator('.map-event[data-attribute="study"]').click();await page.getByRole('button',{name:'编辑日程',exact:true}).click();
 editor=page.getByRole('dialog',{name:'编辑日程',exact:true});await expect(editor).toHaveAttribute('data-motion-state','open');
 await expect(editor.getByRole('button',{name:'上课学习',exact:true})).toHaveAttribute('aria-pressed','true');await expect(editor.getByRole('radio',{name:/硬约束防挤压锁定/})).toBeChecked();await expect(editor.getByRole('combobox',{name:'关联目标',exact:true})).toHaveValue(first.presentation.goalId);
 await page.screenshot({path:path.join(output,info.project.name+'-editor.png')});await editor.getByRole('radio',{name:/硬约束防挤压锁定/}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,info.project.name+'-constraints.png')});expect(errors).toEqual([]);
});

test('actually imports CSV, ICS, JSON and an Excel course file only after confirmation',async({page,request})=>{
 test.setTimeout(150_000);const session=await account(page,request);let writes=0;
 page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v1/schedule/items')writes++;});
 const upload=async(name:string,mimeType:string,buffer:Buffer)=>{await page.goto(`/calendar?day=${day}&view=week&import=1`);await page.getByLabel('导入文件',{exact:true}).setInputFiles({name,mimeType,buffer});};
 await upload('real.csv','text/csv',Buffer.from('标题,日期,开始时间,结束时间,属性标签\nCSV真实导入,2026-11-23,09:00,10:00,上课学习\nCSV第二条,2026-11-23,10:00,10:30,随笔调研'));
 await expect(page.getByText('CSV真实导入',{exact:true})).toBeVisible();expect(writes).toBe(0);await page.getByRole('button',{name:/确认导入/}).click();await expect(page.getByRole('status').filter({hasText:/已成功导入 2 条/})).toBeVisible();
 expect((await items(request,session.accessToken)).find((item:{title:string})=>item.title==='CSV真实导入').presentation.attributeTag).toBe('study');
 await upload('real.ics','text/calendar',Buffer.from('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:ICS真实导入\r\nDTSTART:20261123T030000Z\r\nDTEND:20261123T040000Z\r\nCATEGORIES:工作会议\r\nEND:VEVENT\r\nEND:VCALENDAR'));
 await expect(page.getByText('ICS真实导入',{exact:true})).toBeVisible();expect(writes).toBe(2);await page.getByRole('button',{name:/确认导入/}).click();await expect(page.getByRole('status').filter({hasText:/已成功导入 1 条/})).toBeVisible();
 await upload('real.json','application/json',Buffer.from(JSON.stringify({events:[{title:'JSON真实导入',date:'2026-11-23',start:'13:00',end:'14:00',tag:'架构编码'}]})));
 await expect(page.getByText('JSON真实导入',{exact:true})).toBeVisible();expect(writes).toBe(3);await page.getByRole('button',{name:/确认导入/}).click();await expect(page.getByRole('status').filter({hasText:/已成功导入 1 条/})).toBeVisible();
 await page.goto(`/calendar?day=${day}&import=1`);await page.addScriptTag({url:'/vendor/xlsx.full.min.js'});
 const base64=await page.evaluate(()=>{
  const XLSX=(window as unknown as {XLSX:{utils:{book_new:()=>unknown;aoa_to_sheet:(rows:string[][])=>unknown;book_append_sheet:(book:unknown,sheet:unknown,name:string)=>void};write:(book:unknown,options:unknown)=>string}}).XLSX;
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['课程名称','星期','周次','节次','教师','教室'],['Excel真实课表','2','1-2','3-4','老师','A201']]),'课程表');return XLSX.write(book,{type:'base64',bookType:'xlsx'});
 });
 await page.getByLabel('导入文件',{exact:true}).setInputFiles({name:'real.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(base64,'base64')});
 await page.getByLabel('学期第一周周一',{exact:true}).fill(day);await page.getByLabel('第 3-4 节开始时间',{exact:true}).fill('14:00');await page.getByLabel('第 3-4 节结束时间',{exact:true}).fill('15:30');await page.getByRole('button',{name:'生成日程预览',exact:true}).click();
 await expect(page.getByText('Excel真实课表',{exact:true})).toHaveCount(2);expect(writes).toBe(4);await page.getByRole('button',{name:/确认导入/}).click();await expect(page.getByRole('status').filter({hasText:/已成功导入 2 条/})).toBeVisible();
 const saved=await items(request,session.accessToken);expect(saved).toHaveLength(6);expect(writes).toBe(6);expect(saved.filter((item:{title:string})=>item.title==='Excel真实课表').every((item:{presentation?:{attributeTag:string}})=>item.presentation?.attributeTag==='study')).toBe(true);
});

test('date field uses one frame and failed summary reads never show fake zeroes',async({page,request})=>{
 await account(page,request);
 await page.route('**/api/v1/schedule/items?**',route=>route.fulfill({status:503,json:{detail:'Injected read failure for verification'}}));
 await page.route('**/api/v1/energy/today?**',route=>route.fulfill({status:503,json:{detail:'Injected read failure for verification'}}));
 await page.goto(`/calendar?day=${day}&view=week`);
 const overview=page.getByRole('region',{name:'日历真实数据概览'});await expect(overview).toContainText('日程读取失败');await expect(overview).toContainText('精力读取失败');await expect(overview).not.toContainText('0 项日程');await expect(overview).not.toContainText('0 段');
 const date=page.getByLabel('跳转日期',{exact:true});await date.focus();
 expect(await date.evaluate(el=>{const style=getComputedStyle(el);return style.borderTopWidth==='0px'&&style.outlineStyle==='none'&&style.boxShadow==='none';})).toBe(true);
});
