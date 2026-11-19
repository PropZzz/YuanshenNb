import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const output=path.resolve("../../.appdata/qa/full-fidelity");
async function account(page:Page,request:APIRequestContext,project:string){
 const email=`fidelity-${project}-${Date.now()}@example.com`,password="Full-Fidelity-2026!";
 const response=await request.post("/api/v1/auth/register",{data:{email,password,displayName:"全界面验收",timezone:"Asia/Shanghai"}});expect(response.ok()).toBe(true);
 const session=await response.json();await page.goto("/login");await page.getByLabel("邮箱地址").fill(email);await page.getByLabel("密码",{exact:true}).fill(password);await page.getByRole("button",{name:"登录并进入工作台"}).click();await expect(page).toHaveURL(/\/focus$/);return session;
}
test("covers all 21 reference entries with real authenticated data and intact shared styles",async({page,request},info)=>{
 test.setTimeout(240_000);await mkdir(output,{recursive:true});const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 await page.goto("/login");await expect(page.getByRole("button",{name:"以游客身份继续"})).toBeDisabled();await page.screenshot({path:path.join(output,`${info.project.name}-login.png`)});
 const session=await account(page,request,info.project.name),day=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const created=await request.post("/api/v1/schedule/items",{headers:{Authorization:`Bearer ${session.accessToken}`},data:{title:"全界面验收·真实日程",notes:"用于详情、编辑与专注界面的可验证记录",category:"deep_work",cognitiveLoad:"medium",flexibility:"flexible",startAt:new Date(`${day}T09:00:00+08:00`).toISOString(),endAt:new Date(`${day}T10:00:00+08:00`).toISOString(),reminderMinutes:10}});expect(created.ok()).toBe(true);const item=(await created.json()).item;
 const cases=[
  ["focus","/focus",false],["schedule","/schedule",false],["micro","/micro",false],["team","/team",false],["profile","/profile",false],["goals","/goals",false],["review","/review",false],["diagnostics","/diagnostics",false],["bluetooth","/bluetooth",false],["emotion-energy","/emotion-energy",false],
  ["integrations","/integrations",true],["settings-drawer","/settings-drawer",true],["create-schedule","/create-schedule",true],["urgent-task","/urgent-task",true],["calendar-options","/calendar-options",true],["calendar-import","/calendar-import",true],["microtask-entry","/microtask-entry",true],["schedule-detail",`/schedule-detail?id=${item.id}&day=${day}`,true],["microtask-detail","/microtask-detail?id=missing",true],["rescue-comparison","/rescue-comparison",true],
 ] as const;
 const report:unknown[]=[];
 for(const [name,url,drawer] of cases){
  await page.goto(url);await expect(page.locator(".workbench-content")).toBeVisible();
  await expect(page.locator(".workbench-content .state-panel[role=status]")).toHaveCount(0);await page.evaluate(()=>document.fonts.ready);
  if(drawer){const panel=page.getByRole("dialog").last();await expect(panel).toHaveAttribute("data-surface","drawer");await expect(panel).toHaveAttribute("data-motion-state","open");const rect=await panel.boundingBox();expect(rect!.x).toBeGreaterThanOrEqual(-1);expect(rect!.x+rect!.width).toBeLessThanOrEqual(info.project.use.viewport!.width+1);if(info.project.name==="mobile"&&name!=="calendar-import")expect(rect!.height).toBeLessThanOrEqual(info.project.use.viewport!.height*.92+1);}
  else await expect(page.getByRole("main").getByRole("heading").first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const styles=await page.evaluate(()=>{const main=document.querySelector(".workbench-main")!,brand=document.querySelector(".sidebar-brand img")!,button=document.querySelector(".button")!;return{canvas:getComputedStyle(main).backgroundColor,brandHeight:getComputedStyle(brand).height,buttonPadding:getComputedStyle(button).padding};});expect(styles.canvas).toBe("rgb(247, 247, 251)");expect(styles.brandHeight).toBe("32px");
  await page.screenshot({path:path.join(output,`${info.project.name}-${name}.png`),fullPage:!drawer});report.push({name,url:page.url(),...styles});
 }
 expect(errors).toEqual([]);await writeFile(path.join(output,`${info.project.name}-route-matrix.json`),JSON.stringify(report,null,2));
});

test("matches drawer motion, focus, time selection, theme cancellation and original keyboard entries",async({page,request},info)=>{
 await mkdir(output,{recursive:true});await account(page,request,`${info.project.name}-motion`);
 const settings=page.getByRole("button",{name:"设置",exact:true});
 const openingTiming=page.evaluate(()=>new Promise<EffectTiming|null>(resolve=>{const observer=new MutationObserver(()=>{const el=document.querySelector('[role="dialog"][data-surface="drawer"]');if(!el)return;const timings=el.getAnimations().map(animation=>animation.effect?.getTiming()).filter(Boolean);if(timings.length){observer.disconnect();resolve(timings[0]!);}});observer.observe(document.body,{childList:true,subtree:true,attributes:true});}));
 await settings.click();let drawer=page.getByRole("dialog",{name:"系统偏好与设置"});
 const firstTiming=await openingTiming;expect(firstTiming?.easing==="cubic-bezier(0.22, 1, 0.36, 1)"&&Number(firstTiming.duration)<=300).toBe(true);
 await expect(drawer).toHaveAttribute("data-motion-state","open");if(info.project.name==="desktop")expect((await drawer.boundingBox())!.width).toBe(420);
 await drawer.getByRole("button",{name:"深色模式",exact:true}).click();await expect(page.locator("html")).toHaveClass(/dark/);await page.keyboard.press("Escape");await expect(drawer).toHaveCount(0);await expect(page.locator("html")).not.toHaveClass(/dark/);await expect(settings).toBeFocused();
 await settings.click();drawer=page.getByRole("dialog",{name:"系统偏好与设置"});await expect(drawer).toHaveAttribute("data-motion-state","open");
 const closingSeen=page.evaluate(()=>new Promise<boolean>(resolve=>{const el=document.querySelector('[role="dialog"][data-surface="drawer"]');if(!el){resolve(false);return;}const observer=new MutationObserver(()=>{if(el.getAttribute("data-motion-state")==="closing"){observer.disconnect();resolve(true);}});observer.observe(el,{attributes:true,attributeFilter:["data-motion-state"]});}));
 await drawer.getByRole("button",{name:"关闭",exact:true}).click();expect(await closingSeen).toBe(true);await expect(drawer).toHaveCount(0);
 await page.goto("/calendar");
 await page.getByRole("button",{name:"月视图"}).click();await expect(page.getByRole("region",{name:"月视图日程网格"})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:path.join(output,`${info.project.name}-calendar-month.png`),fullPage:true});
 await page.getByRole("button",{name:"甘特视图"}).click();await expect(page.getByRole("region",{name:"甘特时间轴"})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:path.join(output,`${info.project.name}-calendar-gantt.png`),fullPage:true});
 const create=page.locator(".calendar-controller-actions").getByRole("button",{name:"新增日程",exact:true});await create.click();drawer=page.getByRole("dialog",{name:"新增日程"});await expect(drawer).toHaveAttribute("data-motion-state","open");
 await drawer.getByRole("button",{name:"选择开始时间",exact:true}).click();let picker=page.getByRole("dialog",{name:"选择开始时间",exact:true});await picker.getByRole("option",{name:"14 时",exact:true}).click();await picker.getByRole("option",{name:"35 分",exact:true}).click();await picker.getByRole("button",{name:"确认时间"}).click();await expect(drawer.getByLabel("开始时间",{exact:true})).toHaveValue(/T14:35$/);
 await drawer.getByRole("button",{name:"选择开始时间日期",exact:true}).click();picker=page.getByRole("dialog",{name:"选择日期"});await expect(picker).toBeVisible();await page.keyboard.press("Escape");await expect(picker).toHaveCount(0);await expect(drawer.getByRole("button",{name:"选择开始时间日期",exact:true})).toBeFocused();
 await drawer.getByRole("button",{name:"关闭",exact:true}).click();await expect(drawer).toHaveCount(0);await expect(create).toBeFocused();
 await page.keyboard.press("Control+Shift+K");await expect(page.getByRole("dialog",{name:"快速捕捉多行清单"})).toBeVisible();await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);await page.keyboard.press("Alt+s");await expect(page.getByRole("dialog",{name:"日程救援决策台"})).toBeVisible();await page.keyboard.press("Escape");
 await page.emulateMedia({reducedMotion:"reduce"});await page.goto("/settings-drawer");drawer=page.getByRole("dialog",{name:"系统偏好与设置"});await expect(drawer).toHaveAttribute("data-motion-state","open");expect(await drawer.evaluate(element=>element.getAnimations().filter(animation=>Number(animation.effect?.getTiming().duration)>1).length)).toBe(0);
});
