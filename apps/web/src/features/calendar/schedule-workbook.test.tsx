import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScheduleImport } from "./schedule-import";

// Exercise the original bundled reader/writer against real XLSX and BIFF8 bytes.
const xlsx=runInNewContext(`${readFileSync("../../.appdata/reference/main/web/stitch/assets/vendor/xlsx.full.min.js","utf8")}\nXLSX;`) as {
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
 xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet([["标题","日期","开始时间","时长"],["第二工作表", "2026-11-21","14:00",45]]),"第二学期");
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
