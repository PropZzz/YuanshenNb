import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ApiComponents } from "@/api/client";
import { CalendarPage } from "./calendar-page";
import { ScheduleDetail } from "./schedule-detail";

const item: ApiComponents["ScheduleItemDTO"] = { id:"item",userId:"self",title:"日程详情回归",notes:"课前阅读",startAt:"2026-11-20T01:00:00Z",endAt:"2026-11-20T02:00:00Z",category:"deep_work",cognitiveLoad:"high",flexibility:"hard_locked",status:"planned",durationMinutes:60,reminderMinutes:10,createdAt:"2026-11-19T00:00:00Z",updatedAt:"2026-11-19T00:00:00Z" };
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
let cache:QueryClient;
let writes:{url:string;body:unknown}[];
beforeEach(()=>{localStorage.clear();writes=[];vi.stubGlobal("fetch",vi.fn(async(request:Request)=>{
 if(request.method==="POST"){writes.push({url:request.url,body:await request.json()});return json({item,baselineVersion:"v",baselineLocalDay:"2026-11-20"});}
 if(request.url.includes("/schedule/items/"))return json({item});
 if(request.url.includes("/schedule/items"))return json({items:[item],baselineVersion:"v"});
 if(request.url.includes("rescue/history"))return json({snapshots:[]});
 return json({score:80,dataFreshness:"baseline_only",localDay:"2026-11-20",hourlyCurve:[],focusShields:[]});
}));});
afterEach(()=>{cleanup();cache?.clear();vi.unstubAllGlobals();localStorage.clear();});
function mount(query=""){const search=new URLSearchParams(query);if(!search.has("day"))search.set("day","2026-11-20");query="?"+search;cache=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[`/calendar${query}`]}><CalendarPage/></MemoryRouter></QueryClientProvider>);}

it("opens a read-only schedule detail before entering edit mode",async()=>{
 mount();const user=userEvent.setup();await user.click(await screen.findByRole("button",{name:/日程详情回归 09:00至10:00/}));
 expect(await screen.findByRole("dialog",{name:"日程详情"})).toBeTruthy();
 expect(screen.queryByLabelText("日程标题")).toBeNull();expect(within(screen.getByRole("dialog",{name:"日程详情"})).getByText("课前阅读")).toBeTruthy();
 await user.click(screen.getByRole("button",{name:"编辑日程"}));expect(await screen.findByLabelText("日程标题")).toBeTruthy();
});

it("shows a saved course classroom as a dedicated detail field while keeping its other notes",()=>{
 cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const course:ApiComponents['ScheduleItemDTO']={...item,presentation:{attributeTag:'study'},notes:'教师：王老师\n地点：B座507\n课前阅读'};
 render(<QueryClientProvider client={cache}><ScheduleDetail id={course.id} item={course} onClose={vi.fn()} onEdit={vi.fn()}/></QueryClientProvider>);
 const dialog=screen.getByRole('dialog',{name:'日程详情'});
 expect(within(dialog).getByText('上课地点').closest('div')?.textContent).toContain('B座507');
 expect(within(dialog).getByText('B座507',{exact:true})).toBeTruthy();
 expect(dialog.querySelector('.schedule-detail-notes')?.textContent).toContain('课前阅读');
 expect(dialog.querySelector('.schedule-detail-notes')?.textContent).not.toContain('地点：');
});

it("opens a usable editor when a deep link contains an invalid initial time",async()=>{
 mount("?new=1&day=2026-11-20&time=99:99");
 const start=await screen.findByLabelText("开始时间") as HTMLInputElement;
 expect(start.value).toBe("2026-11-20T09:00");
 expect((screen.getByLabelText("结束时间") as HTMLInputElement).value).toBe("2026-11-20T10:00");
});

it("preserves the new-schedule draft after visiting and cancelling import",async()=>{
 mount("?new=1&day=2026-11-20");const user=userEvent.setup();
 await user.type(await screen.findByLabelText("日程标题"),"导入前保留的草稿");
 await user.type(screen.getByLabelText("备注（可选）"),"未保存的课程说明");
 fireEvent.change(screen.getByLabelText("时长（分钟）"),{target:{value:"75"}});
 await user.type(screen.getByLabelText("截止时间（可选）"),"2026-11-20T18:00");
 await user.click(screen.getByRole("checkbox",{name:"我确认允许与已有日程重叠"}));
 await user.click(screen.getByRole("button",{name:/导入课表或已有日程/}));
 await waitFor(()=>expect(screen.queryByRole("dialog",{name:"新增日程"})).toBeNull());
 await user.click(screen.getByRole("button",{name:"取消"}));
 expect((await screen.findByLabelText("日程标题") as HTMLTextAreaElement).value).toBe("导入前保留的草稿");
 expect((screen.getByLabelText("备注（可选）") as HTMLTextAreaElement).value).toBe("未保存的课程说明");
 expect((screen.getByLabelText("开始时间") as HTMLInputElement).value).toBe("2026-11-20T09:00");
 expect((screen.getByLabelText("结束时间") as HTMLInputElement).value).toBe("2026-11-20T10:15");
 expect((screen.getByLabelText("时长（分钟）") as HTMLInputElement).value).toBe("75");
 expect((screen.getByLabelText("截止时间（可选）") as HTMLInputElement).value).toBe("2026-11-20T18:00");
 expect((screen.getByRole("checkbox",{name:"我确认允许与已有日程重叠"}) as HTMLInputElement).checked).toBe(true);
});

it("persists local calendar options and changes the rendered time-map scale",async()=>{
 const {container}=mount();const user=userEvent.setup();await user.click(await screen.findByRole("button",{name:"筛选"}));await user.click(screen.getByRole("button",{name:"更多显示选项"}));
 await user.click(screen.getByRole("button",{name:"紧凑"}));await user.click(screen.getByRole("switch",{name:"显示当前时间线"}));
 expect(JSON.parse(localStorage.getItem("ruanchuang-calendar-options")??"{}")).toMatchObject({hourHeight:44,nowLine:false});
 await user.click(screen.getByRole("button",{name:"完成"}));await waitFor(()=>expect(container.querySelector(".time-map-body")?.getAttribute("data-hour-height")).toBe("44"));
});

it("previews imported CSV rows and writes selected rows only after explicit confirmation",async()=>{
 mount("?import=1");const user=userEvent.setup();
 expect((await screen.findByRole("dialog",{name:"导入日程"})).getAttribute("data-drawer-edge")).toBe("right");
 const file=new File(["标题,日期,开始时间,结束时间\n导入课程A,2026-11-20,09:00,10:00\n导入课程B,2026-11-20,11:00,12:00"],"courses.csv",{type:"text/csv"});
 await user.upload(await screen.findByLabelText("导入文件"),file);
 expect(await screen.findByText("导入课程A")).toBeTruthy();expect(writes).toHaveLength(0);
 await user.click(screen.getByRole("checkbox",{name:/选择导入课程B/}));
 await user.click(screen.getByRole("button",{name:/确认导入/}));await waitFor(()=>expect(writes).toHaveLength(1));
 expect(writes[0].body).toMatchObject({title:"导入课程A",startAt:"2026-11-20T01:00:00.000Z",endAt:"2026-11-20T02:00:00.000Z"});
 expect(await screen.findByText(/已成功导入 1 条/)).toBeTruthy();
});

it("offers a simple drop zone and automatically previews a semicolon export without any settings",async()=>{
 mount("?import=1");await screen.findByRole("dialog",{name:"导入日程"});
 expect(screen.queryByRole("combobox",{name:"文件格式"})).toBeNull();
 fireEvent.drop(screen.getByRole("button",{name:/选择或拖入文件/}),{dataTransfer:{files:[new File(["本月日程导出\n主题;日期;开始时间;结束时间\n自动识别会议;2026-11-24;09:00;10:00"],"schedule.txt")],types:["Files"]}});
 expect(await screen.findByText("自动识别会议")).toBeTruthy();expect(writes).toHaveLength(0);
 expect(screen.queryByRole("combobox",{name:"文本编码"})).toBeNull();
 expect((screen.getByRole("button",{name:/确认导入/}) as HTMLButtonElement).disabled).toBe(false);
});

it("uses explicit course dates and times without asking for a semester or section timetable",async()=>{
 mount("?import=1");const user=userEvent.setup();
 await user.upload(await screen.findByLabelText("导入文件"),new File(["课程名称,日期,开始时间,结束时间,星期,周次,节次\n已标明时间的课程,2026-11-24,09:00,10:00,2,1,1-2"],"courses.csv"));
 expect(await screen.findByText("已标明时间的课程")).toBeTruthy();
 expect(screen.queryByLabelText("学期第一周周一")).toBeNull();expect(writes).toHaveLength(0);
});

it("keeps partial import failures visible and never retries already saved rows",async()=>{
 let attempts=0;vi.stubGlobal("fetch",vi.fn(async(request:Request)=>{
  if(request.method==="POST"){attempts++;return attempts===2?json({type:"https://shixu.app/errors/SCHEDULE_CONFLICT",code:"SCHEDULE_CONFLICT",title:"Conflict",detail:"这条日程存在冲突",status:409},409):json({item});}
  if(request.url.includes("/schedule/items"))return json({items:[]});if(request.url.includes("rescue/history"))return json({snapshots:[]});return json({score:80,dataFreshness:"baseline_only",hourlyCurve:[],focusShields:[]});
 }));
 mount("?import=1");const user=userEvent.setup();await user.upload(await screen.findByLabelText("导入文件"),new File(["标题,日期,开始时间,结束时间\n成功课程,2026-11-20,09:00,10:00\n冲突课程,2026-11-20,11:00,12:00"],"courses.csv",{type:"text/csv"}));
 await user.click(await screen.findByRole("button",{name:/确认导入/}));expect(await screen.findByText(/1 条导入失败/)).toBeTruthy();expect(screen.getByText(/这段时间与已有日程冲突/)).toBeTruthy();
 await user.click(screen.getByRole("button",{name:/重试失败/}));await waitFor(()=>expect(attempts).toBe(3));
});

it("does not offer blind retries when a network interruption leaves an import result unknown",async()=>{
 let attempts=0;vi.stubGlobal("fetch",vi.fn(async(request:Request)=>{if(request.method==="POST"){attempts++;throw new TypeError("connection lost after sending");}if(request.url.includes("/schedule/items"))return json({items:[]});if(request.url.includes("rescue/history"))return json({snapshots:[]});return json({score:80,dataFreshness:"baseline_only",hourlyCurve:[],focusShields:[]});}));
 mount("?import=1");const user=userEvent.setup();await user.upload(await screen.findByLabelText("导入文件"),new File(["标题,日期,开始时间,结束时间\n结果未知课程,2026-11-20,09:00,10:00"],"courses.csv",{type:"text/csv"}));await user.click(await screen.findByRole("button",{name:/确认导入/}));
 expect(await screen.findByText(/结果未确认，请先刷新日历核对/)).toBeTruthy();expect((screen.getByRole("button",{name:/确认导入/}) as HTMLButtonElement).disabled).toBe(true);expect(attempts).toBe(1);
 await user.click(screen.getByText("识别不准确？调整识别"));
 expect((screen.getByRole("button",{name:"更新预览"}) as HTMLButtonElement).disabled).toBe(true);
 expect((screen.getByLabelText("日程名称") as HTMLSelectElement).disabled).toBe(true);
});

it("previews UTC and TZID ICS entries without expanding unsupported recurrence rules",async()=>{
 mount("?import=1");const user=userEvent.setup();const file=new File(["BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:UTC 课程\r\nDTSTART:20261120T010000Z\r\nDTEND:20261120T020000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:每周课程\r\nDTSTART;TZID=Asia/Shanghai:20261120T110000\r\nDTEND;TZID=Asia/Shanghai:20261120T120000\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\nEND:VCALENDAR"],"schedule.ics",{type:"text/calendar"});
 await user.upload(await screen.findByLabelText("导入文件"),file);expect(await screen.findByText("UTC 课程")).toBeTruthy();expect(screen.getByText(/2026-11-20 09:00/)).toBeTruthy();expect(screen.getByText(/包含重复规则，请先在来源日历中展开/)).toBeTruthy();expect((screen.getByRole("checkbox",{name:"选择每周课程"}) as HTMLInputElement).disabled).toBe(true);expect(writes).toHaveLength(0);
});

it("previews original JSON schedule envelopes and preserves imported metadata before explicit save",async()=>{
 mount("?import=1");const user=userEvent.setup();
 await user.upload(await screen.findByLabelText("导入文件"),new File([JSON.stringify({events:[{title:"JSON 课程",day:"2026-11-20",time:{hour:14,minute:0},durationMinutes:45,tag:"上课学习",teacher:"王老师",location:"教学楼201",notes:"章节阅读"}]})],"schedule.json",{type:"application/json"}));
 expect(await screen.findByText("JSON 课程")).toBeTruthy();expect(screen.getByText(/教学楼201/)).toBeTruthy();expect(writes).toHaveLength(0);
 await user.click(screen.getByRole("button",{name:/确认导入/}));await waitFor(()=>expect(writes).toHaveLength(1));
 expect(writes[0].body).toMatchObject({title:"JSON 课程",startAt:"2026-11-20T06:00:00.000Z",endAt:"2026-11-20T06:45:00.000Z"});
 expect(String((writes[0].body as {notes:string}).notes)).toContain("王老师");
});

it("expands a course table using the chosen semester Monday and explicit section times",async()=>{
 mount("?import=1");const user=userEvent.setup();
 await user.upload(await screen.findByLabelText("导入文件"),new File(["课程名称\t星期\t周次\t节次\t教师\t教室\n课程节次回归\t2\t1-3[单周]\t1-2\t李老师\tA201"],"course.tsv",{type:"text/tab-separated-values"}));
 fireEvent.change(await screen.findByLabelText("学期第一周周一"),{target:{value:"2026-11-16"}});
 await user.type(screen.getByLabelText("第 1-2 节开始时间"),"08:00");await user.type(screen.getByLabelText("第 1-2 节结束时间"),"09:35");
 await waitFor(()=>expect(screen.getByRole("button",{name:/确认导入/})).toHaveProperty("disabled",false));
 expect(await screen.findAllByText("课程节次回归")).toHaveLength(2);expect(screen.getByText(/2026-11-17 08:00/)).toBeTruthy();expect(screen.getByText(/2026-12-01 08:00/)).toBeTruthy();expect(writes).toHaveLength(0);
 await user.click(screen.getByRole("button",{name:/确认导入/}));await waitFor(()=>expect(writes).toHaveLength(2));
});

it("applies every original display filter locally to the time map",async()=>{
 vi.stubGlobal("fetch",vi.fn(async(request:Request)=>request.url.includes('/schedule/items')?json({items:[{...item,presentation:{goalId:"goal-1",goalTitle:"真实目标"}}]}):request.url.includes('rescue/history')?json({snapshots:[]}):json({score:80,dataFreshness:'baseline_only',localDay:'2026-11-20',hourlyCurve:[],focusShields:[]})));
 const {container}=mount();const user=userEvent.setup();await screen.findByRole("button",{name:/日程详情回归 09:00至10:00/});
 await user.click(screen.getByRole("button",{name:"筛选"}));
 for(const [label,selector,key] of [["时间标尺",".map-hours","timeRuler"],["属性标签",".event-category","attributeTags"],["完成状态",".event-status","completionStatus"],["缓冲与提醒",".event-reminder","buffersAndReminders"],["战略目标关联",".event-goal-link","strategyLinks"]]){
  expect(container.querySelector(selector)).not.toBeNull();await user.click(screen.getByRole("checkbox",{name:label}));expect(container.querySelector(selector)).toBeNull();
  expect(JSON.parse(localStorage.getItem("ruanchuang-calendar-options")??"{}")[key]).toBe(false);
 }
 expect(writes).toHaveLength(0);
});

 it("requires fresh semester and section times after selecting a different course file",async()=>{
 mount("?import=1");const user=userEvent.setup(),course="课程名称\t星期\t周次\t节次\n新课表课程\t1\t1\t1-2";
 await user.upload(await screen.findByLabelText("导入文件"),new File([course],"first.tsv"));
 fireEvent.change(await screen.findByLabelText("学期第一周周一"),{target:{value:"2026-11-16"}});await user.type(screen.getByLabelText("第 1-2 节开始时间"),"08:00");await user.type(screen.getByLabelText("第 1-2 节结束时间"),"09:35");
 await user.upload(screen.getByLabelText("导入文件"),new File([course],"second.tsv"));
 await waitFor(()=>expect((screen.getByLabelText("学期第一周周一") as HTMLInputElement).value).toBe("2026-11-16"));
 expect((screen.getByLabelText("第 1-2 节开始时间") as HTMLInputElement).value).toBe("");expect((screen.getByLabelText("第 1-2 节结束时间") as HTMLInputElement).value).toBe("");
});

it("renders month and gantt views from real schedule items and opens detail on click",async()=>{
 mount("?day=2026-11-20");const user=userEvent.setup();
 await screen.findByRole("button",{name:/日程详情回归 09:00至10:00/});
 await user.click(screen.getByRole("button",{name:"月视图"}));
 expect(await screen.findByRole("region",{name:"月视图日程网格"})).toBeTruthy();
 expect(screen.getByRole("button",{name:/日程详情回归 09:00至10:00/})).toBeTruthy();
 await user.click(screen.getByRole("button",{name:"甘特视图"}));
 expect(await screen.findByRole("region",{name:"甘特时间轴"})).toBeTruthy();
 await user.click(screen.getByRole("button",{name:"按日"}));
 expect(screen.getByText("11/20 · 每格 1 小时")).toBeTruthy();
 await user.click(screen.getByRole("button",{name:"查看 日程详情回归"}));
 expect(await screen.findByRole("dialog",{name:"日程详情"})).toBeTruthy();
 expect(writes).toHaveLength(0);
});

it("prefills new schedule draft from URL query without saving automatically",async()=>{
 mount("?new=1&day=2026-11-20&title=微任务冲刺&duration=45");
 expect(((await screen.findByLabelText("日程标题")) as HTMLTextAreaElement).value).toBe("微任务冲刺");
 expect((screen.getByLabelText("时长（分钟）") as HTMLInputElement).value).toBe("45");
 expect(writes).toHaveLength(0);
});
