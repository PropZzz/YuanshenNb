import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Check, Clock3, ShieldCheck, Sparkles } from "@/components/ui/reference-icons";
import { apiClient, type ApiComponents } from "@/api/client";
import { unwrap } from "@/api/unwrap";
import { queryKeys } from "@/api/query-keys";
import { localDate, localDateTimeToISO, localInput, localTime, displayDay, shiftDay } from "@/lib/datetime";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { DateTimeField } from "@/components/ui/date-time-field";
import { InlineError, Notice } from "@/components/ui/states";
import { loadLabels } from "@/features/calendar/queries";

type Recommendation=ApiComponents["GoldenWindowRecommendation"];
export function MeetingPlanner({workspaceId,members,open=true,onClose,onRecommended,onConfirmed}:{open?:boolean;workspaceId:string;members:ApiComponents["WorkspaceMemberDTO"][];onClose:()=>void;onRecommended:(result:ApiComponents["RecommendMeetingResponse"])=>void;onConfirmed:()=>void}) {
 const timezone=useAuthStore(s=>s.user?.timezone??"Asia/Shanghai"),cache=useQueryClient(),today=localDate(new Date(),timezone);
 const [request,setRequest]=useState<ApiComponents["RecommendMeetingRequest"]>(),[candidate,setCandidate]=useState<Recommendation>(),[validation,setValidation]=useState<unknown>(null);
 const [roles,setRoles]=useState<Record<string,"required"|"optional"|"excluded">>(()=>Object.fromEntries(members.map(m=>[m.userId,"required"])));
 const recommendations=useMutation({mutationFn:async(body:ApiComponents["RecommendMeetingRequest"])=>unwrap(await apiClient.POST("/api/v1/workspaces/{id}/meetings/recommend",{params:{path:{id:workspaceId}},body})),onSuccess:onRecommended});
 const confirm=useMutation({mutationFn:async()=>{
  if(!request||!candidate)throw new Error("请先选择一个推荐窗口");
  return unwrap(await apiClient.POST("/api/v1/workspaces/{id}/meetings/confirm",{params:{path:{id:workspaceId}},body:{title:request.title,description:request.description,cognitiveLoad:request.cognitiveLoad,participantIds:request.participantIds,optionalIds:request.optionalIds,startAt:candidate.startAt,endAt:candidate.endAt,recommendationMeta:{rank:candidate.rank,score:candidate.score,breakdown:candidate.breakdown,explanationTags:candidate.explanationTags,summary:candidate.summary}}}));
 },onSuccess:async()=>{await Promise.all([cache.invalidateQueries({queryKey:queryKeys.workspaces.meetings(workspaceId)}),cache.invalidateQueries({queryKey:queryKeys.workspaces.availabilityRoot(workspaceId)}),cache.invalidateQueries({queryKey:queryKeys.schedule.itemsRoot}),cache.invalidateQueries({queryKey:queryKeys.energy.todayRoot})]);setCandidate(undefined);onConfirmed();onClose();}});
 function reset(){recommendations.reset();confirm.reset();setCandidate(undefined);setRequest(undefined);setValidation(null);}
 function preview(e:FormEvent<HTMLFormElement>){e.preventDefault();setValidation(null);confirm.reset();const form=new FormData(e.currentTarget);try{
  const participantIds=members.filter(m=>roles[m.userId]==="required").map(m=>m.userId),optionalIds=members.filter(m=>roles[m.userId]==="optional").map(m=>m.userId);
  if(!participantIds.length)throw new Error("请至少选择一名必需参会成员");
  const searchFrom=localDateTimeToISO(String(form.get("from")),timezone),searchTo=localDateTimeToISO(String(form.get("to")),timezone);
  if(Date.parse(searchTo)<=Date.parse(searchFrom))throw new Error("搜索结束时间需要晚于开始时间");
  const body:ApiComponents["RecommendMeetingRequest"]={title:String(form.get("title")).trim(),description:String(form.get("description")??""),durationMinutes:Number(form.get("duration")),cognitiveLoad:form.get("load") as ApiComponents["CognitiveLoad"],participantIds,optionalIds,searchFrom,searchTo,respectFocusShields:form.get("shields")==="on",maxResults:3};setRequest(body);recommendations.mutate(body);
 }catch(error){setValidation(error);}}
 return <><Drawer open={open} onOpenChange={open=>{if(!open&&!confirm.isPending)onClose();}} title="寻找黄金协作窗口" description={`按 ${timezone} 显示。服务端综合成员工作时间、精力档位与专注保护，推荐最多三个窗口。`} width={740} className="team-meeting-drawer"><form onSubmit={preview} onChange={reset} className="form-stack">
  <div className="form-grid"><label className="field">会议主题<input name="title" required maxLength={200} placeholder="这次会议希望达成什么？" autoFocus/></label><label className="field">会议时长<select name="duration" defaultValue={60}>{[15,30,45,60,90,120,180,240].map(n=><option key={n} value={n}>{n} 分钟</option>)}</select></label></div>
  <div className="form-grid"><DateTimeField label="搜索开始时间" name="from" required defaultValue={localInput(new Date(Date.now()+15*60_000).toISOString(),timezone)} onChange={reset}/><DateTimeField label="搜索结束时间" name="to" required defaultValue={`${shiftDay(today,7)}T18:00`} onChange={reset}/></div>
  <div className="form-grid"><label className="field">会议认知负荷<select name="load" defaultValue="medium">{Object.entries(loadLabels).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label><label className="field">会议说明（可选）<input name="description" placeholder="议题、材料或准备事项"/></label></div>
  <fieldset className="meeting-members"><legend>参会成员 <span>至少一位必需成员，可选成员单独标注</span></legend>{members.map(member=><label key={member.userId}><span className="avatar">{member.displayName.slice(0,1)}</span><span><strong>{member.displayName}</strong><small>{member.timezone}</small></span><select aria-label={`${member.displayName}的参会要求`} value={roles[member.userId]??"excluded"} onChange={e=>setRoles(s=>({...s,[member.userId]:e.target.value as "required"|"optional"|"excluded"}))}><option value="required">必需参会</option><option value="optional">可选参会</option><option value="excluded">不参与</option></select></label>)}</fieldset>
  <label className="meeting-shield"><input type="checkbox" name="shields" defaultChecked/><ShieldCheck size={16}/>尊重成员的深度专注保护窗口</label><InlineError error={validation??recommendations.error}/><div className="flex justify-end"><Button type="submit" variant="secondary" pending={recommendations.isPending}><Sparkles size={15}/>计算黄金窗口</Button></div>
 </form>
 {recommendations.data&&<section className="meeting-results"><div className="flex items-center justify-between gap-2"><h3>为「{request?.title}」找到 {recommendations.data.recommendations.length} 个窗口</h3><span className="badge">预览不会创建会议</span></div>{recommendations.data.recommendations.length===0?<div className="meeting-diagnostics"><h4>这个范围内暂时没有合法窗口</h4>{recommendations.data.blockingDiagnostics.map((d,i)=><div key={i}><strong>{d.message}</strong><p>{d.suggestedAction}</p></div>)}<p>可尝试延长搜索日期、缩短会议或调整可选参会成员。</p></div>:<div className="meeting-candidates">{recommendations.data.recommendations.map(option=><article key={option.rank} className={option.rank===1?"best-candidate":""}><div className="flex items-center justify-between gap-2"><span className="badge">Top {option.rank}</span><strong>{option.score}<small> /100</small></strong></div><h4>{displayDay(localDate(option.startAt,timezone),{month:"long",day:"numeric",weekday:"short"})}</h4><time>{localTime(option.startAt,timezone)} — {localTime(option.endAt,timezone)}</time><p>{option.summary}</p><div className="flex flex-wrap gap-1">{option.explanationTags.map(tag=><span className="badge" key={tag.code}>{tag.label}</span>)}</div><Button variant={option.rank===1?"secondary":"outline"} onClick={()=>{confirm.reset();setCandidate(option);}}>预览并确认</Button></article>)}</div>}</section>}
 </Drawer><Dialog open={!!candidate} onOpenChange={open=>{if(!open&&!confirm.isPending)setCandidate(undefined);}} title="确认这个会议窗口？" description="确认后会原子创建参会日程并通知成员；服务端会再次检查冲突。"><div className="meeting-confirm-summary"><CalendarCheck size={26}/><h3>{request?.title}</h3><p>{candidate&&`${displayDay(localDate(candidate.startAt,timezone))} · ${localTime(candidate.startAt,timezone)}–${localTime(candidate.endAt,timezone)}`}</p><small>{timezone} · {request?.durationMinutes} 分钟</small></div><Notice><Check size={14}/>必需 {request?.participantIds.length??0} 人 · 可选 {request?.optionalIds?.length??0} 人。冲突时会阻止创建，请重新计算。</Notice><InlineError error={confirm.error}/><div className="form-actions"><Button variant="outline" disabled={confirm.isPending} onClick={()=>setCandidate(undefined)}>返回比较</Button><Button variant="secondary" pending={confirm.isPending} onClick={()=>confirm.mutate()}><Clock3 size={15}/>确认创建会议</Button></div></Dialog></>;
}
