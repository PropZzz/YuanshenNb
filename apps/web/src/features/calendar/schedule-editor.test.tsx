import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScheduleEditor } from "./schedule-editor";
import type { ApiComponents } from "@/api/client";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("retains every original category and unassessed-load control with honest disabled states",()=>{
 render(<QueryClientProvider client={new QueryClient()}><ScheduleEditor open onClose={()=>{}} day="2026-11-20"/></QueryClientProvider>);
 for(const name of ["方案评审","跨部门协同","架构编码","随笔调研","日常规程","上课学习","作业自习","考试复习","工作会议","项目推进","运动休息","未评估"]){expect((screen.getByRole("button",{name}) as HTMLButtonElement).disabled).toBe(true);}
 expect(screen.getByText(/原版细分标签尚未提供保存字段/)).toBeTruthy();
});
it("explicitly clears a removed deadline when saving an existing schedule", async () => {
 const item: ApiComponents["ScheduleItemDTO"] = { id:"item",userId:"user",title:"截止期回归",notes:"",startAt:"2026-11-20T01:00:00Z",endAt:"2026-11-20T02:00:00Z",deadlineAt:"2026-11-20T10:00:00Z",category:"deep_work",cognitiveLoad:"high",flexibility:"flexible",status:"planned",durationMinutes:60,reminderMinutes:10,createdAt:"2026-11-19T00:00:00Z",updatedAt:"2026-11-19T00:00:00Z" };
 const bodies: unknown[] = [];
 vi.stubGlobal("fetch",vi.fn(async (request: Request) => { bodies.push(await request.json()); return new Response(JSON.stringify({item,baselineVersion:"v",baselineLocalDay:"2026-11-20"}),{status:200,headers:{"Content-Type":"application/json"}}); }));
 render(<QueryClientProvider client={new QueryClient()}><ScheduleEditor open onClose={()=>{}} day="2026-11-20" item={item}/></QueryClientProvider>);
 const user=userEvent.setup(); await user.clear(screen.getByLabelText("截止时间（可选）")); await user.click(screen.getByRole("button",{name:"保存修改"}));
 await waitFor(()=>expect(bodies[0]).toMatchObject({clearDeadline:true}));
});
