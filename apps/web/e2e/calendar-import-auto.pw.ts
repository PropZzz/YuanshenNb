import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { schoolTimetableExport } from "../src/features/calendar/__fixtures__/school-timetable";

const output = path.resolve("../../.appdata/qa/import-auto");

async function openImport(page: Page, request: APIRequestContext) {
  const email = `import-auto-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = "Import-preview-2026!";
  const response = await request.post("/api/v1/auth/register", { data: { email, password, displayName: "导入功能验收", timezone: "Asia/Shanghai" } });
  expect(response.ok()).toBe(true);
  const session = await response.json();
  await page.goto("/login");
  await page.getByLabel("邮箱地址").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录并进入工作台" }).click();
  await expect(page).toHaveURL(/\/focus$/);
  await page.goto("/calendar?day=2026-11-24&import=1");
  await expect(page.getByRole("dialog", { name: "导入日程" })).toHaveAttribute("data-motion-state", "open");
  return session.accessToken as string;
}

test("automatically previews a dropped export and saves only the selected row after confirmation", async ({ page, request }, info) => {
  const token = await openImport(page, request);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let writes = 0;
  page.on("request", req => { if (req.method() === "POST" && new URL(req.url()).pathname === "/api/v1/schedule/items") writes++; });
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, info.project.name + "-empty.png") });
  const dataTransfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['sep=;\n十一月工作安排\n主题;开始日期;开始时间;结束时间\n"实验;讨论";2026年11月24日;09:00;10:00\n项目复盘;2026/11/24;14:00;15:00'], "日程导出.txt", { type: "text/plain" }));
    return data;
  });
  await page.getByRole("button", { name: "选择或拖入文件" }).dispatchEvent("drop", { dataTransfer });
  await dataTransfer.dispose();
  await expect(page.getByText("实验;讨论", { exact: true })).toBeVisible();
  await expect(page.getByText("项目复盘", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByText(/分号分隔/)).toBeVisible();
  await expect(page.getByText(/已跳过 1 行说明/)).toBeVisible();
  expect(writes).toBe(0);
  const dialog = page.getByRole("dialog", { name: "导入日程" });
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(output, info.project.name + "-preview.png") });
  await page.getByRole("checkbox", { name: "选择项目复盘", exact: true }).uncheck();
  await page.getByRole("button", { name: /确认导入/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "已成功导入 1 条" })).toBeVisible();
  expect(writes).toBe(1);
  const saved = await request.get("/api/v1/schedule/items", { headers: { Authorization: `Bearer ${token}` }, params: { from: "2026-11-23T16:00:00Z", to: "2026-11-24T16:00:00Z" } });
  const items = (await saved.json()).items;
  expect(items).toEqual([expect.objectContaining({ title: "实验;讨论" })]);
  expect(new Date(items[0].startAt).toISOString()).toBe("2026-11-24T01:00:00.000Z");
  expect(errors).toEqual([]);
});

test("detects GBK and Excel with a cover sheet while retaining manual corrections", async ({ page, request }, info) => {
  await openImport(page, request);
  const input = page.getByLabel("导入文件", { exact: true });
  await input.setInputFiles({ name: "中文日程.csv", mimeType: "text/csv", buffer: Buffer.from("b1eacce22cc8d5c6da2cbfaacabccab1bce40ad6d0cec4bbe1d2e92c323032362d31312d32342c30393a3030", "hex") });
  await expect(page.getByText("中文会议", { exact: true })).toBeVisible();
  await expect(page.locator(".calendar-import-recognized")).toContainText("GBK / GB18030");
  await page.getByText("识别不准确？调整识别", { exact: true }).click();
  await expect(page.getByRole("combobox", { name: "文本编码", exact: true })).toBeVisible();
  await page.getByText("识别不准确？调整识别", { exact: true }).click();
  await page.addScriptTag({ url: "/vendor/xlsx.full.min.js" });
  const base64 = await page.evaluate(() => {
    const xlsx = (window as unknown as { XLSX: { utils: { book_new: () => unknown; aoa_to_sheet: (rows: (string | number)[][]) => unknown; book_append_sheet: (book: unknown, sheet: unknown, name: string) => void }; write: (book: unknown, options: unknown) => string } }).XLSX;
    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([["说明"], ["请查看第二页的日程"]]), "封面");
    xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([["十一月日程"], ["标题", "日期", "开始时间", "结束时间"], ["Excel 自动识别", 46346, 0.375, 0.4375]]), "日程明细");
    return xlsx.write(book, { type: "base64", bookType: "xlsx" });
  });
  await input.setInputFiles({ name: "日程.els", mimeType: "application/octet-stream", buffer: Buffer.from(base64, "base64") });
  await expect(page.getByText("Excel 自动识别", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "工作表", exact: true })).toHaveValue("日程明细");
  await expect(page.getByText("2026-11-20 09:00 — 2026-11-20 10:30", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "文件格式", exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(output, info.project.name + "-excel.png") });
});

test("recognizes a school timetable and generates every teaching date after entering only its class times",async({page,request},info)=>{
 const token=await openImport(page,request);let writes=0;
 page.on("request",req=>{if(req.method()==="POST"&&new URL(req.url()).pathname==="/api/v1/schedule/items")writes++;});
 await page.addScriptTag({url:"/vendor/xlsx.full.min.js"});
 const base64=await page.evaluate(()=>{
  const xlsx=(window as unknown as {XLSX:{utils:{book_new:()=>unknown;aoa_to_sheet:(rows:string[][])=>Record<string,unknown>;book_append_sheet:(book:unknown,sheet:unknown,name:string)=>void};write:(book:unknown,options:unknown)=>string}}).XLSX;
  const book=xlsx.utils.book_new(),sheet=xlsx.utils.aoa_to_sheet([["学期第一周周一","2026-11-23"],["","节次","星 期 一","","星 期 二",""] ,["上午","第01、02节","高等数学\n张老师\n第1-2周\n教室：A101","","",""]]);
  sheet["!merges"]=[{s:{r:1,c:2},e:{r:1,c:3}},{s:{r:1,c:4},e:{r:1,c:5}}];
  xlsx.utils.book_append_sheet(book,sheet,"Sheet1");return xlsx.write(book,{type:"base64",bookType:"xlsx"});
 });
 await page.getByLabel("导入文件",{exact:true}).setInputFiles({name:"教务系统课表.xls",mimeType:"application/vnd.ms-excel",buffer:Buffer.from(base64,"base64")});
 await expect(page.getByRole("combobox",{name:"日程名称",exact:true})).toHaveCount(0);
 await expect(page.getByText(/日期来自课表/)).toBeVisible();
 await page.getByLabel("第 1-2 节开始时间",{exact:true}).fill("08:00");
 await page.getByLabel("第 1-2 节结束时间",{exact:true}).fill("09:35");
 await expect(page.getByText("高等数学",{exact:true})).toHaveCount(2);
 await expect(page.getByRole("button",{name:"生成日程预览",exact:true})).toHaveCount(0);
 await expect(page.getByRole("button",{name:/确认导入/})).toBeEnabled();
 expect(writes).toBe(0);
 await page.screenshot({path:path.join(output,info.project.name+"-course-automatic.png")});
 await page.getByRole("button",{name:/确认导入/}).click();
 await expect(page.getByRole("status").filter({hasText:"已成功导入 2 条"})).toBeVisible();
 expect(writes).toBe(2);
 const response=await request.get("/api/v1/schedule/items",{headers:{Authorization:`Bearer ${token}`},params:{from:"2026-11-22T16:00:00Z",to:"2026-12-06T16:00:00Z"}});
 const saved=(await response.json()).items;expect(saved).toHaveLength(2);
 expect(saved.every((item:{title:string;notes:string})=>item.title==="高等数学"&&item.notes.includes("A101"))).toBe(true);
});

test("previews a transposed school export using its embedded calendar and lesson times without manual setup",async({page,request},info)=>{
 await openImport(page,request);let writes=0;
 page.on("request",req=>{if(req.method()==="POST"&&new URL(req.url()).pathname==="/api/v1/schedule/items")writes++;});
 if(process.env.E2E_TRANSPOSED_COURSE_FILE){
  await page.getByLabel("导入文件",{exact:true}).setInputFiles(process.env.E2E_TRANSPOSED_COURSE_FILE);
 }else{
  await page.addScriptTag({url:"/vendor/xlsx.full.min.js"});
  const base64=await page.evaluate(rows=>{
   const xlsx=(window as unknown as {XLSX:{utils:{book_new:()=>unknown;aoa_to_sheet:(rows:string[][])=>Record<string,unknown>;book_append_sheet:(book:unknown,sheet:unknown,name:string)=>void};write:(book:unknown,options:unknown)=>string}}).XLSX;
   const book=xlsx.utils.book_new(),sheet=xlsx.utils.aoa_to_sheet(rows);
   sheet["!merges"]=[{s:{r:0,c:0},e:{r:0,c:25}},{s:{r:1,c:0},e:{r:1,c:25}}];
   for(let r=2;r<=9;r++)for(const c of [1,5,9,13,17,21]){
    (sheet["!merges"] as unknown[]).push({s:{r,c},e:{r,c:c+3}});
   }
   xlsx.utils.book_append_sheet(book,sheet,"Sheet1");return xlsx.write(book,{type:"base64",bookType:"biff8"});
  },schoolTimetableExport());
  await page.getByLabel("导入文件",{exact:true}).setInputFiles({name:"学校横向课表.xls",mimeType:"application/vnd.ms-excel",buffer:Buffer.from(base64,"base64")});
 }
 const dialog=page.getByRole("dialog",{name:"导入日程",exact:true});
 await expect(dialog.getByRole("button",{name:"确认导入（108 条）",exact:true})).toBeEnabled();
 await expect(dialog.getByRole("alert")).toHaveCount(0);
 await expect(dialog.getByRole("heading",{name:"已识别课表 · 日程已自动生成",exact:true})).toBeVisible();
 await expect(dialog.getByText(/日期来自课表/)).toBeVisible();
 await expect(dialog.getByLabel("学期第一周周一",{exact:true})).toHaveValue("2026-09-07");
 await expect(dialog.getByLabel("第 3-4 节开始时间",{exact:true})).toHaveValue("10:00");
 await expect(dialog.getByLabel("第 3-4 节结束时间",{exact:true})).toHaveValue("11:40");
 await expect(dialog.getByText("2026-09-07 10:00 — 2026-09-07 11:40",{exact:true})).toBeVisible();
 await expect(dialog.getByRole("combobox")).toHaveCount(0);
 expect(writes).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:path.join(output,`${info.project.name}-course-transposed${process.env.E2E_TRANSPOSED_COURSE_FILE?"-actual":""}.png`)});
});
