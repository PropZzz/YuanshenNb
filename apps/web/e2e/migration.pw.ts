import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const shots=path.resolve("../../.appdata/qa/v2");
const password="Migration-Test-2026!";
async function screenshot(page:Page,name:string,project:string){await mkdir(shots,{recursive:true});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(shots,`${project}-${name}.png`),fullPage:false});await page.screenshot({path:path.join(shots,`${project}-${name}-full.png`),fullPage:true});}
function localDay(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}

test("real registration, schedule, focus, replay, workspace and rescue round trip",async({page},info)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const email=`migration-${info.project.name}-${Date.now()}@example.com`,day=localDay();
  const tomorrow=new Date(`${day}T12:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);const rescueDay=tomorrow.toISOString().slice(0,10);
  await page.goto("/register");
  await page.getByLabel("显示名称").fill("迁移验收账号");await page.getByLabel("邮箱地址").fill(email);await page.getByLabel("密码",{exact:true}).fill(password);await page.getByLabel("确认密码",{exact:true}).fill(password);
  await screenshot(page,"register",info.project.name);
  await page.getByRole("button",{name:"创建账号并开始使用"}).click();await expect(page).toHaveURL(/\/focus$/);
  await expect(page.getByRole("link",{name:/去安排第一段专注/})).toBeVisible();
  await screenshot(page,"focus-empty-light",info.project.name);

  await page.goto("/calendar");await page.locator(".calendar-controller-actions").getByRole("button",{name:"新增日程",exact:true}).click();
  let dialog=page.getByRole("dialog",{name:"新增日程"});await expect(dialog).toBeVisible();
  await dialog.getByLabel("日程标题").fill("迁移验收·专注任务");await dialog.getByLabel("开始时间",{exact:true}).fill(`${day}T09:00`);await dialog.getByLabel("结束时间",{exact:true}).fill(`${day}T10:00`);
  await dialog.getByRole("button",{name:"保存日程"}).click();await expect(dialog).not.toBeVisible();
  await expect(page.locator(".map-event").first()).toBeVisible();
  await screenshot(page,"calendar-light",info.project.name);
  await page.goto("/focus");await page.getByRole("button",{name:"开始专注",exact:true}).click();await expect(page.getByRole("button",{name:"暂停专注"})).toBeEnabled();await page.getByRole("button",{name:"暂停专注"}).click();
  await screenshot(page,"focus-light",info.project.name);
  await page.getByRole("button",{name:"完成当前任务"}).click();await expect(page.getByRole("link",{name:/去安排第一段专注/})).toBeVisible();

  await page.goto("/energy");await expect(page.getByRole("meter",{name:"个人精力电量"})).toBeVisible();await expect(page.locator(".energy-care-strip")).toContainText("节律基线估算");
  await page.getByRole("button",{name:"测试回放",exact:true}).click();dialog=page.getByRole("dialog",{name:"载入回放测试数据"});await dialog.getByRole("checkbox",{name:/我了解/}).check();await dialog.getByRole("button",{name:"确认载入回放"}).click();await expect(dialog).not.toBeVisible();await expect(page.locator(".energy-care-strip")).toContainText("回放");
  await screenshot(page,"energy-light",info.project.name);

  await page.goto("/team");await page.getByRole("button",{name:"创建工作区",exact:true}).click();dialog=page.getByRole("dialog",{name:"创建工作区"});await dialog.getByLabel("工作区名称").fill("迁移验收协作组");await dialog.getByRole("button",{name:"确认创建工作区"}).click();await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button",{name:"发起智能排会"})).toBeEnabled();
  await screenshot(page,"team-light",info.project.name);
  await page.getByRole("button",{name:"发起智能排会"}).click();dialog=page.getByRole("dialog",{name:"寻找黄金协作窗口"});await dialog.getByLabel("会议主题").fill("迁移验收会议");await dialog.getByRole("button",{name:"计算黄金窗口"}).click();
  await expect(dialog.getByRole("button",{name:"预览并确认"}).first()).toBeVisible();await screenshot(page,"meeting-options-light",info.project.name);
  const alternateTime=await dialog.locator(".meeting-candidates article").nth(1).locator("time").innerText();await dialog.getByRole("button",{name:"关闭",exact:true}).click();await expect(dialog).not.toBeVisible();
  const golden=page.getByRole("region",{name:"黄金协作窗口"}),alternate=golden.getByRole("button",{name:"查看第 2 推荐窗口"});await alternate.focus();await page.keyboard.press("Enter");await expect(alternate).toHaveAttribute("aria-pressed","true");await expect(golden.getByRole("heading")).toContainText(alternateTime);await screenshot(page,"team-alternate-window-light",info.project.name);
  await golden.getByRole("button",{name:"发起智能排会"}).click();dialog=page.getByRole("dialog",{name:"寻找黄金协作窗口"});await dialog.getByLabel("会议主题").fill("迁移验收会议");await dialog.getByRole("button",{name:"计算黄金窗口"}).click();await dialog.getByRole("button",{name:"预览并确认"}).first().click();
  const confirm=page.getByRole("dialog",{name:"确认这个会议窗口？"}),confirmedResponse=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith("/meetings/confirm")&&response.ok());await confirm.getByRole("button",{name:"确认创建会议"}).click();await expect(confirm).not.toBeVisible();await expect(page.locator(".meeting-list")).toContainText("迁移验收会议");
  const savedMeeting=(await (await confirmedResponse).json()).proposal,meetingDay=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(savedMeeting.confirmedStartAt));await page.getByLabel("团队状态日期").fill(meetingDay);
  await expect(page.getByRole("table",{name:"成员共享日程时间轴"}).getByRole("group",{name:/忙碌/}).first()).toBeVisible();await page.locator(".team-availability").screenshot({path:path.join(shots,`${info.project.name}-team-timeline-light.png`)});

  await page.goto("/settings");await expect(page.getByLabel("显示名称")).toBeVisible();await page.getByRole("button",{name:"深色",exact:true}).click();await expect(page.locator("html")).toHaveClass(/dark/);
  await screenshot(page,"settings-dark",info.project.name);
  for(const route of ["focus","calendar","team","energy"]){await page.goto(`/${route}`);await expect(page.locator(".workbench-content")).toBeVisible();await expect(page.locator(".state-panel[role=status]")).toHaveCount(0);await screenshot(page,`${route}-dark`,info.project.name);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}

  await page.goto("/calendar");await page.getByLabel("跳转日期").fill(rescueDay);await page.getByRole("button",{name:"计算并比较救援方案"}).click();dialog=page.getByRole("dialog",{name:"日程救援决策台"});await dialog.getByRole("textbox",{name:"紧急任务",exact:true}).fill("迁移验收·紧急任务");await dialog.getByLabel("需要时长").selectOption("30");await dialog.getByLabel("最晚完成时间",{exact:true}).fill(`${rescueDay}T18:00`);await dialog.getByRole("button",{name:"生成三套方案"}).click();
  await expect(dialog.locator(".rescue-option")).toHaveCount(3);await screenshot(page,"rescue-options-dark",info.project.name);await expect(dialog.getByRole("button",{name:"确认应用当前方案"})).toBeEnabled();await dialog.getByRole("button",{name:"确认应用当前方案"}).click();await expect(dialog).not.toBeVisible();
  await page.getByRole("button",{name:"撤销本次调整",exact:true}).first().click();const undo=page.getByRole("dialog",{name:"撤销这次日程调整？"});await undo.getByRole("button",{name:"确认撤销本次调整"}).click();await expect(undo).not.toBeVisible();await expect(page.locator(".rescue-history")).toContainText("已撤销");
  await page.getByRole("button",{name:"计算并比较救援方案"}).click();dialog=page.getByRole("dialog",{name:"日程救援决策台"});
  await dialog.getByLabel("救援原因").selectOption("wearable_fatigue");await expect(dialog.getByRole("textbox",{name:"紧急任务",exact:true})).toHaveCount(0);
  await dialog.getByRole("button",{name:"生成三套方案"}).click();
  await expect(dialog.locator(".rescue-option")).toHaveCount(3);if(info.project.name==="mobile")await dialog.getByRole("navigation",{name:"救援策略"}).getByRole("button",{name:"方案 B",exact:true}).click();await dialog.locator(".rescue-option").filter({has:page.getByRole("heading",{name:"优先保留恢复缓冲"})}).click();
  await screenshot(page,"fatigue-options-dark",info.project.name);
  const fatigueHistory=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/v1/schedule/rescue/history"&&response.ok());
  await dialog.getByRole("button",{name:"确认应用当前方案"}).click();await expect(dialog).not.toBeVisible();
  expect((await (await fatigueHistory).json()).snapshots[0]).toMatchObject({localDay:rescueDay,triggerReason:"wearable_fatigue",strategy:"protect_recovery",status:"applied"});
  await page.getByRole("button",{name:"撤销本次调整",exact:true}).first().click();const fatigueUndo=page.getByRole("dialog",{name:"撤销这次日程调整？"});await fatigueUndo.getByRole("button",{name:"确认撤销本次调整"}).click();await expect(fatigueUndo).not.toBeVisible();
  await page.goto("/settings");await page.getByRole("button",{name:"浅色",exact:true}).click();await expect(page.locator("html")).not.toHaveClass(/dark/);await screenshot(page,"settings-light",info.project.name);
  await page.context().clearCookies();await page.goto("/login");await page.getByLabel("邮箱地址").fill(email);await page.getByLabel("密码",{exact:true}).fill(password);await screenshot(page,"login-light",info.project.name);await page.getByRole("button",{name:"登录并进入工作台"}).click();await expect(page).toHaveURL(/\/focus$/);
  expect(errors).toEqual([]);
});

test("two accounts join, confirm, respond and cancel using the real shared workspace",async({page,request,browser},info)=>{
  const suffix=`${info.project.name}-${Date.now()}`,firstEmail=`owner-${suffix}@example.com`,secondEmail=`member-${suffix}@example.com`;
  const firstResponse=await request.post("/api/v1/auth/register",{data:{email:firstEmail,password,displayName:"验收·发起人",timezone:"Asia/Shanghai"}});expect(firstResponse.ok()).toBe(true);const first=await firstResponse.json();
  const workspaceResponse=await request.post("/api/v1/workspaces",{headers:{Authorization:`Bearer ${first.accessToken}`},data:{name:"双账号联调工作区",privacyLevel:"busy_only"}});expect(workspaceResponse.ok()).toBe(true);const workspace=await workspaceResponse.json();
  await page.goto("/login");await page.getByLabel("邮箱地址").fill(firstEmail);await page.getByLabel("密码",{exact:true}).fill(password);await page.getByRole("button",{name:"登录并进入工作台"}).click();await expect(page).toHaveURL(/\/focus$/);
  const secondContext=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,timezoneId:"Asia/Shanghai",locale:"zh-CN"});
  try{
    const secondPage=await secondContext.newPage();await secondPage.goto("/register");await secondPage.getByLabel("显示名称").fill("验收·参会人");await secondPage.getByLabel("邮箱地址").fill(secondEmail);await secondPage.getByLabel("密码",{exact:true}).fill(password);await secondPage.getByLabel("确认密码",{exact:true}).fill(password);await secondPage.getByRole("button",{name:"创建账号并开始使用"}).click();await expect(secondPage).toHaveURL(/\/focus$/);
    await secondPage.goto("/team");await secondPage.getByRole("button",{name:"加入工作区",exact:true}).click();const join=secondPage.getByRole("dialog",{name:"加入工作区"});await join.getByLabel("工作区邀请码").fill(workspace.inviteCode);await join.getByLabel("我的共享范围").selectOption("energy_tier");await join.getByRole("button",{name:"确认加入工作区"}).click();await expect(join).not.toBeVisible();await expect(secondPage.locator(".team-member-card")).toHaveCount(2);
    await page.goto("/team");await expect(page.locator(".team-member-card")).toHaveCount(2);await page.getByRole("button",{name:"发起智能排会"}).click();const planner=page.getByRole("dialog",{name:"寻找黄金协作窗口"});await planner.getByLabel("会议主题").fill("双账号确认回执测试");await planner.getByRole("button",{name:"计算黄金窗口"}).click();await planner.getByRole("button",{name:"预览并确认"}).first().click();const confirm=page.getByRole("dialog",{name:"确认这个会议窗口？"});await confirm.getByRole("button",{name:"确认创建会议"}).click();await expect(confirm).not.toBeVisible();
    await expect(secondPage.locator(".meeting-list")).toContainText("双账号确认回执测试");await secondPage.getByRole("button",{name:"接受会议",exact:true}).click();await expect(secondPage.locator(".meeting-list .response-accepted")).toContainText(["验收·参会人"]);
    await expect(page.locator(".meeting-list .response-accepted")).toContainText(["验收·参会人"]);await screenshot(page,"team-multiaccount-light",info.project.name);
    await secondPage.getByRole("button",{name:"拒绝会议",exact:true}).click();await expect(secondPage.locator(".meeting-list .response-declined")).toContainText(["验收·参会人"]);
    await page.getByRole("button",{name:"取消会议",exact:true}).click();const cancel=page.getByRole("dialog",{name:"取消这个会议？"});await cancel.getByRole("button",{name:"确认取消会议"}).click();await expect(cancel).not.toBeVisible();await expect(secondPage.locator(".meeting-list")).toContainText("已取消");
  } finally {await secondContext.close();}
});
