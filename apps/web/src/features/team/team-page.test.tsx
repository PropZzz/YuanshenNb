import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { useAuthStore } from "@/stores/auth-store";
import type { ApiComponents } from "@/api/client";
vi.mock("@/api/use-realtime",()=>({useRealtime:()=>({state:"connected",alert:null,dismissAlert:()=>{}})}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();useAuthStore.getState().clearSession();});
const profile={id:"self",displayName:"本账号",email:"self@example.com",timezone:"Asia/Shanghai",themeMode:"light" as const,createdAt:"2026-11-19T00:00:00Z",updatedAt:"2026-11-19T00:00:00Z"};
const workspace={id:"team-1",name:"真实协作组",description:"",ownerId:"self",inviteCode:"JOINME",memberCount:1,myRole:"owner",myPrivacyLevel:"busy_only",createdAt:profile.createdAt,updatedAt:profile.updatedAt};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
function login(){useAuthStore.getState().setSession("access",profile);window.history.replaceState({},"","/team");}
it("creates a real workspace from the empty team state",async()=>{
 login();const bodies:unknown[]=[];let created=false;
 vi.stubGlobal("fetch",vi.fn(async(request:Request)=>{const path=new URL(request.url).pathname;if(path==="/api/v1/workspaces"&&request.method==="POST"){bodies.push(await request.json());created=true;return json(workspace,201);}if(path==="/api/v1/workspaces")return json({workspaces:created?[workspace]:[]});if(path.endsWith("/members"))return json({workspaceId:"team-1",members:[]});if(path.endsWith("/availability"))return json({workspaceId:"team-1",members:[]});if(path.endsWith("/meetings"))return json({meetings:[]});return json({detail:"offline"},503);}));
 render(<App/>);const user=userEvent.setup();await user.click(await screen.findByRole("button",{name:"创建工作区"},{timeout:5_000}));expect(screen.getByRole("dialog").getAttribute("data-surface")).toBe("drawer");await user.type(screen.getByLabelText("工作区名称"),"真实协作组");await user.click(screen.getByRole("button",{name:"确认创建工作区"}));await waitFor(()=>expect(bodies[0]).toMatchObject({name:"真实协作组",privacyLevel:"busy_only"}));
});
it("previews a server recommendation and creates the meeting only after explicit confirmation",async()=>{
 login();const confirms:unknown[]=[];
 vi.stubGlobal("fetch",vi.fn(async(request:Request)=>{const path=new URL(request.url).pathname;if(path.endsWith("/recommend"))return json({recommendations:[{rank:1,startAt:"2026-11-20T02:00:00Z",endAt:"2026-11-20T03:00:00Z",score:81,summary:"经过保护窗口检查",breakdown:{energyMatchScore:80,focusShieldScore:100,compactnessScore:90,earlinessScore:75,optionalAttendanceRatio:1},affectedMembers:[],explanationTags:[]}],blockingDiagnostics:[]});if(path.endsWith("/confirm")){confirms.push(await request.json());return json({createdScheduleCount:1,proposal:{id:"meeting"}},201);}if(path==="/api/v1/workspaces")return json({workspaces:[workspace]});if(path.endsWith("/members"))return json({workspaceId:"team-1",members:[{workspaceId:"team-1",userId:"self",displayName:"本账号",timezone:"Asia/Shanghai",role:"owner",privacyLevel:"busy_only",joinedAt:profile.createdAt}]});if(path.endsWith("/availability"))return json({workspaceId:"team-1",members:[]});if(path.endsWith("/meetings"))return json({meetings:[]});return json({detail:"offline"},503);}));
 render(<App/>);const user=userEvent.setup();await user.click(await screen.findByRole("button",{name:"发起智能排会"}));await user.type(screen.getByLabelText("会议主题"),"真实方案讨论");await user.click(screen.getByRole("button",{name:"计算黄金窗口"}));await user.click(await screen.findByRole("button",{name:"预览并确认"}));expect(confirms).toEqual([]);expect(screen.getByRole("dialog",{name:"确认这个会议窗口？"})).toBeTruthy();await user.click(screen.getByRole("button",{name:"确认创建会议"}));await waitFor(()=>expect(confirms[0]).toMatchObject({title:"真实方案讨论",participantIds:["self"],startAt:"2026-11-20T02:00:00Z"}));
 await waitFor(()=>expect(screen.queryByRole("dialog",{name:"确认这个会议窗口？"})).toBeNull());
 await waitFor(()=>expect(screen.queryByRole("dialog",{name:"寻找黄金协作窗口"})).toBeNull());
 await user.click(screen.getByRole("button",{name:"发起智能排会"}));
 expect(screen.queryByRole("dialog",{name:"确认这个会议窗口？"})).toBeNull();
});

const member = {workspaceId:"team-1",userId:"self",displayName:"本账号",timezone:"Asia/Shanghai",role:"owner",privacyLevel:"busy_only",joinedAt:profile.createdAt};
function stubTeam(availabilityMembers: ApiComponents["MemberAvailabilityView"][], recommendations?: ApiComponents["RecommendMeetingResponse"]) {
 vi.stubGlobal("fetch",vi.fn(async(request:Request)=>{
  const path=new URL(request.url).pathname;
  if(path.endsWith("/recommend"))return json(recommendations);
  if(path==="/api/v1/workspaces")return json({workspaces:[workspace]});
  if(path.endsWith("/members"))return json({workspaceId:"team-1",members:[member]});
  if(path.endsWith("/availability"))return json({workspaceId:"team-1",members:availabilityMembers});
  if(path.endsWith("/meetings"))return json({meetings:[]});
  return json({detail:"offline"},503);
 }));
}

it("opens the existing invitation capability in a drawer using the actual workspace code", async () => {
 login(); stubTeam([]); render(<App/>); const user=userEvent.setup();
 await user.click(await screen.findByRole("button",{name:"邀请成员"}));
 const drawer=screen.getByRole("dialog",{name:"邀请成员"});
 expect(drawer.getAttribute("data-surface")).toBe("drawer");
 expect(within(drawer).getByText("JOINME")).toBeTruthy();
 expect(within(drawer).getByRole("button",{name:"复制邀请码"})).toBeTruthy();
 expect(within(drawer).queryByRole("button",{name:"重置邀请码"})).toBeNull();
});

it("compares all three server windows on the golden card without creating a meeting",async()=>{
 login();const response:ApiComponents["RecommendMeetingResponse"]={recommendations:[1,2,3].map((rank)=>({rank,startAt:`2026-11-20T0${rank+1}:00:00Z`,endAt:`2026-11-20T0${rank+2}:00:00Z`,score:90-rank,summary:`服务端推荐说明 ${rank}`,breakdown:{energyMatchScore:80,focusShieldScore:100,compactnessScore:90,earlinessScore:75,optionalAttendanceRatio:1},affectedMembers:[],explanationTags:[]})),blockingDiagnostics:[]};
 stubTeam([],response);render(<App/>);const user=userEvent.setup();
 await user.click(await screen.findByRole("button",{name:"发起智能排会"}));await user.type(screen.getByLabelText("会议主题"),"比较三个窗口");await user.click(screen.getByRole("button",{name:"计算黄金窗口"}));
 await screen.findAllByRole("button",{name:"预览并确认"});await user.click(screen.getByRole("button",{name:"关闭"}));
 const card=screen.getByRole("region",{name:"黄金协作窗口"});
 await user.click(within(card).getByRole("button",{name:"查看第 2 推荐窗口"}));
 expect(within(card).getByText("11:00 — 12:00")).toBeTruthy();expect(within(card).getByText("服务端推荐说明 2")).toBeTruthy();expect(within(card).getByText("综合匹配 88/100")).toBeTruthy();
 expect(within(card).getByRole("button",{name:"查看第 2 推荐窗口"}).getAttribute("aria-pressed")).toBe("true");
 await user.click(within(card).getByRole("button",{name:"查看第 3 推荐窗口"}));expect(within(card).getByText("服务端推荐说明 3")).toBeTruthy();
 const requests=vi.mocked(fetch).mock.calls.map(([request])=>new URL((request as Request).url).pathname);expect(requests.some(path=>path.endsWith("/confirm"))).toBe(false);
});

it("places shared intervals on a timezone-projected timeline, clipping midnight and stacking overlaps",async()=>{
 login();stubTeam([{userId:"self",displayName:"本账号",timezone:"Asia/Shanghai",privacyLevel:"full_title",workStartMinute:540,workEndMinute:1110,slots:[
  {startAt:"2026-11-19T15:30:00Z",endAt:"2026-11-19T17:00:00Z",kind:"soft_busy",title:"跨日安排"},
  {startAt:"2026-11-20T01:00:00Z",endAt:"2026-11-20T02:00:00Z",kind:"busy",title:"日间评审"},
  {startAt:"2026-11-20T01:30:00Z",endAt:"2026-11-20T02:30:00Z",kind:"focus_shield",title:"交叠保护"},
  {startAt:"2026-11-19T14:00:00Z",endAt:"2026-11-19T16:00:00Z",kind:"busy",title:"零点前结束"},
 ]}]);render(<App/>);await screen.findByLabelText("团队状态日期");fireEvent.change(screen.getByLabelText("团队状态日期"),{target:{value:"2026-11-20"}});
 const table=await screen.findByRole("table",{name:"成员共享日程时间轴"});
 const overnight=within(table).getByRole("group",{name:/跨日安排/}),review=within(table).getByRole("group",{name:/日间评审/}),shield=within(table).getByRole("group",{name:/交叠保护/});
 expect(overnight.style.left).toBe("0%");expect(parseFloat(overnight.style.width)).toBeCloseTo(100/24);
 expect(parseFloat(review.style.left)).toBeCloseTo(37.5);expect(review.style.top).not.toBe(shield.style.top);expect(within(table).queryByText("零点前结束")).toBeNull();
});

it("keeps unauthorized titles out of the shared timeline and does not infer availability from missing slots",async()=>{
 login();stubTeam([{userId:"self",displayName:"本账号",timezone:"Asia/Shanghai",privacyLevel:"busy_only",workStartMinute:540,workEndMinute:1110,slots:[{startAt:"2026-11-20T01:00:00Z",endAt:"2026-11-20T02:00:00Z",kind:"busy",title:"不应展示的私有标题"}]},{userId:"other",displayName:"仅共享状态的成员",timezone:"Asia/Shanghai",privacyLevel:"busy_only",workStartMinute:540,workEndMinute:1110,slots:[]}]);
 render(<App/>);await screen.findByLabelText("团队状态日期");fireEvent.change(screen.getByLabelText("团队状态日期"),{target:{value:"2026-11-20"}});
 const table=await screen.findByRole("table",{name:"成员共享日程时间轴"});expect(within(table).queryByText("不应展示的私有标题")).toBeNull();expect(within(table).getByRole("group",{name:/忙碌/})).toBeTruthy();
 expect(within(table).getByText("没有共享占用记录")).toBeTruthy();expect(within(table).queryByText("全天空闲")).toBeNull();
});

it("preserves physical durations and the repeated hour on a 25-hour daylight-saving day",async()=>{
 login();useAuthStore.getState().setSession("access",{...profile,timezone:"America/New_York"});
 stubTeam([{userId:"self",displayName:"本账号",timezone:"America/New_York",privacyLevel:"full_title",workStartMinute:0,workEndMinute:1440,slots:[{startAt:"2026-11-01T05:00:00Z",endAt:"2026-11-01T07:00:00Z",kind:"busy",title:"跨越重复时刻"}]}]);
 render(<App/>);await screen.findByLabelText("团队状态日期");fireEvent.change(screen.getByLabelText("团队状态日期"),{target:{value:"2026-11-01"}});
 const table=await screen.findByRole("table",{name:"成员共享日程时间轴"}),slot=within(table).getByRole("group",{name:/跨越重复时刻/});
 expect(parseFloat(slot.style.left)).toBeCloseTo(4);expect(parseFloat(slot.style.width)).toBeCloseTo(8);expect(within(table).getAllByText("01:00")).toHaveLength(2);expect(within(table).getByText(/25 小时/)).toBeTruthy();
});
