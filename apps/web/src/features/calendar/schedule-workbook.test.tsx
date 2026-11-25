import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScheduleImport } from "./schedule-import";
import { schoolTimetableExport } from "./__fixtures__/school-timetable";

// Exercise the original bundled reader/writer against real XLSX and BIFF8 bytes.
const xlsx=runInNewContext(`${readFileSync("public/vendor/xlsx.full.min.js","utf8")}\nXLSX;`) as {
 utils:{book_new:()=>unknown;aoa_to_sheet:(rows:unknown[][])=>Record<string,unknown>;book_append_sheet:(book:unknown,sheet:unknown,name:string)=>void};
 write:(book:unknown,options:Record<string,unknown>)=>ArrayBuffer;
};
let cache:QueryClient;
beforeEach(()=>{vi.stubGlobal("XLSX",xlsx);});
afterEach(()=>{cleanup();cache?.clear();vi.unstubAllGlobals();});
function mount(){cache=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={cache}><ScheduleImport onClose={()=>{}}/></QueryClientProvider>);}
function workbookFile(kind="xlsx",large?:"rows"|"columns",date1904=false){
 const book=xlsx.utils.book_new(),sheet=xlsx.utils.aoa_to_sheet([["标题","日期","开始时间","结束时间"],["Excel 日期序列",46346,0.375,0.4375]]);
 if(date1904){(book as {Workbook:unknown}).Workbook={WBProps:{date1904:true}};sheet.B2={t:"n",v:44884,z:"yyyy-mm-dd"};}
 if(large)sheet["!ref"]=large==="rows"?"A1:D5002":"A1:BM2";
 xlsx.utils.book_append_sheet(book,sheet,"日程明细");
 if(!large)xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet([["标题","日期","开始时间","时长"],["第二工作表", "2026-11-21","14:00",45]]),"第二学期");
 return new File([xlsx.write(book,{bookType:kind==="xls"?"biff8":"xlsx",type:"array"})],`schedule.${kind}`);
}
it.each(["xlsx","xls"])("reads real %s bytes, normalizes Excel serial date/time and clears selection when switching worksheets",async(kind)=>{
 mount();const user=userEvent.setup();await user.upload(screen.getByLabelText("导入文件"),workbookFile(kind));
 await waitFor(()=>expect(screen.getByRole("status").textContent).not.toContain("正在"));expect(screen.queryByRole("alert")?.textContent).toBeUndefined();
 expect(await screen.findByText("Excel 日期序列")).toBeTruthy();
 expect(screen.getByText(/2026-11-20 09:00 — 2026-11-20 10:30/)).toBeTruthy();
 expect((screen.getByRole("button",{name:/确认导入/}) as HTMLButtonElement).disabled).toBe(false);
 await user.click(screen.getByRole("checkbox",{name:"选择Excel 日期序列"}));
 await user.selectOptions(screen.getByLabelText("工作表"),"第二学期");
 expect(await screen.findByText("第二工作表")).toBeTruthy();expect(screen.queryByText("Excel 日期序列")).toBeNull();
 expect((screen.getByRole("checkbox",{name:"选择第二工作表"}) as HTMLInputElement).checked).toBe(true);
});
it.each(["rows","columns"] as const)("rejects oversized workbook %s before building an event preview",async(large)=>{
 mount();const user=userEvent.setup();await user.upload(screen.getByLabelText("导入文件"),workbookFile("xlsx",large));
 expect((await screen.findByRole("alert")).textContent).toContain("5000 行、64 列");expect(screen.queryByText("Excel 日期序列")).toBeNull();
});
it("normalizes the workbook's 1904 date system without applying the browser timezone twice",async()=>{
 mount();const user=userEvent.setup();await user.upload(screen.getByLabelText("导入文件"),workbookFile("xlsx",undefined,true));
 const title=await screen.findByText("Excel 日期序列");expect(title.parentElement?.textContent).toContain("2026-11-20 09:00 — 2026-11-20 10:30");
});

it("skips a cover worksheet and recognizes numeric dates after a preamble in a mislabeled Excel file",async()=>{
 const book=xlsx.utils.book_new();
 xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet([["导入说明"],["请查看日程明细工作表"]]),"说明");
 xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet([["十一月工作安排"],["标题","日期","开始时间","结束时间"],["自动找到的日程",46346,0.375,0.4375]]),"日程");
 mount();fireEvent.change(screen.getByLabelText("导入文件"),{target:{files:[new File([xlsx.write(book,{bookType:"xlsx",type:"array"})],"课表.els")]}});
 expect(await screen.findByText("自动找到的日程")).toBeTruthy();
 expect(screen.getByText(/2026-11-20 09:00 — 2026-11-20 10:30/)).toBeTruthy();
 expect((screen.getByLabelText("工作表") as HTMLSelectElement).value).toBe("日程");
});

it("ignores an unusable cover worksheet and still offers the following valid schedule",async()=>{
 const book=xlsx.utils.book_new(),cover=xlsx.utils.aoa_to_sheet([["说明"],["查看日程明细"]]);cover["!ref"]="A1:D5002";
 xlsx.utils.book_append_sheet(book,cover,"封面");
 xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet([["标题","日期","开始时间"],["有效日程","2026-11-24","09:00"]]),"日程");
 mount();fireEvent.change(screen.getByLabelText("导入文件"),{target:{files:[new File([xlsx.write(book,{bookType:"xlsx",type:"array"})],"export.xlsx")]}});
 expect(await screen.findByText("有效日程")).toBeTruthy();
 expect((screen.getByLabelText("工作表") as HTMLSelectElement).value).toBe("日程");
});

it.each(["xlml","html"])("reads a real %s export saved as XLS with Chinese headers",async(kind)=>{
 const book=xlsx.utils.book_new();
 xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet([["标题","日期","开始时间","结束时间"],["学校导出的安排","2026-11-24","09:00","10:00"]]),"日程");
 mount();fireEvent.change(screen.getByLabelText("导入文件"),{target:{files:[new File([xlsx.write(book,{bookType:kind,type:"array"})],"export.xls")]}});
 expect(await screen.findByText("学校导出的安排")).toBeTruthy();
 expect(screen.getByText(/2026-11-24 09:00 — 2026-11-24 10:00/)).toBeTruthy();
});

it("recognizes a merged school timetable automatically and previews as soon as section times are supplied",async()=>{
 const book=xlsx.utils.book_new(),sheet=xlsx.utils.aoa_to_sheet([["学期第一周周一","2026-11-23"],["","节次","星 期 一","","星 期 二",""],["上午","第1-2节","自动识别大学数学\n张老师\n1-2周\nA101","","","" ]]);
 sheet["!merges"]=[{s:{r:1,c:2},e:{r:1,c:3}},{s:{r:1,c:4},e:{r:1,c:5}}];
 xlsx.utils.book_append_sheet(book,sheet,"Sheet1");mount();const user=userEvent.setup();
 await user.upload(screen.getByLabelText("导入文件"),new File([xlsx.write(book,{bookType:"xlsx",type:"array"})],"school.xlsx"));
 await user.type(await screen.findByLabelText("第 1-2 节开始时间"),"08:00");
 await user.type(screen.getByLabelText("第 1-2 节结束时间"),"09:35");
 expect(await screen.findAllByText("自动识别大学数学")).toHaveLength(2);
 expect(screen.queryByRole("button",{name:"生成日程预览"})).toBeNull();
 expect(screen.queryByRole("combobox",{name:"日程名称"})).toBeNull();
 expect(screen.getByText(/2026-11-23 08:00 — 2026-11-23 09:35/)).toBeTruthy();
});

it("normalizes an Excel serial semester anchor and preserves course metadata before the teaching weeks",async()=>{
 const book=xlsx.utils.book_new(),sheet=xlsx.utils.aoa_to_sheet([["学期第一周周一",46349],["","节次","星期一","","星期二"],["上午","第1-2节","高等数学\n张老师\nA101\n1-2周","",""]]);
 sheet.B1={t:"n",v:46349,z:"yyyy-m-d"};sheet["!merges"]=[{s:{r:1,c:2},e:{r:1,c:3}}];xlsx.utils.book_append_sheet(book,sheet,"课程表");
 mount();const user=userEvent.setup();await user.upload(screen.getByLabelText("导入文件"),new File([xlsx.write(book,{bookType:"xlsx",type:"array"})],"semester.xlsx"));
 expect((await screen.findByLabelText("学期第一周周一") as HTMLInputElement).value).toBe("2026-11-23");
 await user.type(screen.getByLabelText("第 1-2 节开始时间"),"08:00");await user.type(screen.getByLabelText("第 1-2 节结束时间"),"09:35");
 const previews=await screen.findAllByText("高等数学");expect(previews).toHaveLength(2);expect(previews[0].parentElement?.textContent).toContain("教师：张老师");expect(previews[0].parentElement?.textContent).toContain("地点：A101");
 expect(screen.getByText(/2026-11-23 08:00 — 2026-11-23 09:35/)).toBeTruthy();
});

it("reads unformatted Excel serial metadata and section times before the course header",async()=>{
 const book=xlsx.utils.book_new(),sheet=xlsx.utils.aoa_to_sheet([["学期第一周周一",46349],["节次","开始时间","结束时间"],["1",1/3,0.375],["2",8.5/24,9.5/24],["节次","星期一","星期二"],["1-2","一键生成课程\n1-2周\nA101",""]]);
 xlsx.utils.book_append_sheet(book,sheet,"课表");mount();const user=userEvent.setup();await user.upload(screen.getByLabelText("导入文件"),new File([xlsx.write(book,{bookType:"xlsx",type:"array"})],"automatic.xlsx"));
 expect(await screen.findAllByText("一键生成课程")).toHaveLength(2);
 expect(screen.getByText(/2026-11-23 08:00 — 2026-11-23 09:30/)).toBeTruthy();
 expect((screen.getByLabelText("第 1-2 节开始时间") as HTMLInputElement).value).toBe("08:00");
});

it("previews a real BIFF8 transposed school export with its own calendar and bell schedule",async()=>{
 const book=xlsx.utils.book_new(),sheet=xlsx.utils.aoa_to_sheet(schoolTimetableExport());
 sheet["!merges"]=[{s:{r:0,c:0},e:{r:0,c:25}},{s:{r:1,c:0},e:{r:1,c:25}}];
 for(let r=2;r<=9;r++)for(const c of [1,5,9,13,17,21]){
  (sheet["!merges"] as unknown[]).push({s:{r,c},e:{r,c:c+3}});
 }
 xlsx.utils.book_append_sheet(book,sheet,"Sheet1");mount();
 fireEvent.change(screen.getByLabelText("导入文件"),{target:{files:[new File([xlsx.write(book,{bookType:"biff8",type:"array"})],"school-timetable.xls")]}});
 await waitFor(()=>expect((screen.getByRole("button",{name:/确认导入/}) as HTMLButtonElement).disabled).toBe(false));
 expect(screen.queryByRole("alert")).toBeNull();
 expect(screen.getByRole("button",{name:/确认导入/}).textContent).toContain("108 条");
 expect(screen.getByRole("heading",{name:"已识别课表 · 日程已自动生成"})).toBeTruthy();
 expect((screen.getByLabelText("学期第一周周一") as HTMLInputElement).value).toBe("2026-09-07");
 expect((screen.getByLabelText("第 3-4 节开始时间") as HTMLInputElement).value).toBe("10:00");
 expect(screen.getByText(/2026-09-07 10:00 — 2026-09-07 11:40/)).toBeTruthy();
});
it("loads the Excel parser only for an Excel selection and ignores a late load after changing files",async()=>{
 vi.stubGlobal("XLSX",undefined);mount();const user=userEvent.setup();
 expect(document.querySelector('script[src="/vendor/xlsx.full.min.js"]')).toBeNull();
 await user.upload(screen.getByLabelText("导入文件"),workbookFile());
 const script=await waitFor(()=>{const found=document.querySelector('script[src="/vendor/xlsx.full.min.js"]');expect(found).not.toBeNull();return found!;});
 fireEvent.change(screen.getByLabelText("导入文件"),{target:{files:[new File(["标题,日期,开始时间\n新文件结果,2026-11-20,15:00"],"new.csv")]}});
 expect(await screen.findByText("新文件结果")).toBeTruthy();
 vi.stubGlobal("XLSX",xlsx);fireEvent.load(script);
 await new Promise(resolve=>setTimeout(resolve,30));expect(screen.queryByText("Excel 日期序列")).toBeNull();expect(screen.getByText("新文件结果")).toBeTruthy();
 script.remove();
});
it("does not publish a late workbook load after the import surface unmounts",async()=>{
 vi.stubGlobal("XLSX",undefined);const view=mount(),user=userEvent.setup();await user.upload(screen.getByLabelText("导入文件"),workbookFile());
 const script=await waitFor(()=>{const found=document.querySelector('script[src="/vendor/xlsx.full.min.js"]');expect(found).not.toBeNull();return found!;});
 view.unmount();vi.stubGlobal("XLSX",xlsx);fireEvent.load(script);await new Promise(resolve=>setTimeout(resolve,30));
 expect(screen.queryByText("Excel 日期序列")).toBeNull();script.remove();
});
