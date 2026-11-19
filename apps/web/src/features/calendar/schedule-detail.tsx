import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CalendarDays, CheckCheck, Clock3, Edit3, LockKeyhole, Trash2 } from "@/components/ui/reference-icons";
import { apiClient, type ApiComponents } from "@/api/client";
import { assertSuccess, unwrap } from "@/api/unwrap";
import { useAuthStore } from "@/stores/auth-store";
import { localDate, localTime, displayDay } from "@/lib/datetime";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { ErrorState, InlineError, LoadingState, Notice } from "@/components/ui/states";
import { categoryLabels, loadLabels, useInvalidateSchedule } from "./queries";
type Item=ApiComponents["ScheduleItemDTO"];
export function ScheduleDetail({open=true,id,item,loading=false,error,retry,onClose,onEdit}:{open?:boolean;id:string;item?:Item;loading?:boolean;error?:unknown;retry?:()=>void;onClose:()=>void;onEdit:(item:Item)=>void}){
 const timezone=useAuthStore(s=>s.user?.timezone??"Asia/Shanghai"),invalidate=useInvalidateSchedule(),[confirmDelete,setConfirmDelete]=useState(false);
 const remove=useMutation({mutationFn:async()=>assertSuccess(await apiClient.DELETE("/api/v1/schedule/items/{id}",{params:{path:{id}}})),onSuccess:async()=>{await invalidate();onClose();}});
 const complete=useMutation({mutationFn:async()=>unwrap(await apiClient.PATCH("/api/v1/schedule/items/{id}",{params:{path:{id}},body:{status:item?.status==="completed"?"planned":"completed"}})),onSuccess:async()=>{await invalidate();onClose();}}),pending=remove.isPending||complete.isPending;
 return <Drawer open={open} onOpenChange={open=>{if(!open&&!pending)onClose();}} title="日程详情" className="calendar-drawer" footer={item&&<div className="calendar-drawer-actions"><Button variant="secondary" disabled={pending} onClick={()=>onEdit(item)}><Edit3 size={16}/>编辑日程</Button><Button variant={confirmDelete?"danger":"ghost"} disabled={pending||!!item.meetingProposalId} pending={remove.isPending} onClick={()=>confirmDelete?remove.mutate():setConfirmDelete(true)}><Trash2 size={14}/>{confirmDelete?"确认删除":"删除日程"}</Button></div>}>
  {!item?(loading?<LoadingState label="正在读取日程详情"/>:<ErrorState error={error??new Error("当前日期范围未找到此日程，请返回选择对应日期后重试。日程可能已被删除。")} retry={retry}/>):<div className="calendar-drawer-stack schedule-detail"><div><h3>{item.title}</h3><div className="schedule-detail-tags"><span>{categoryLabels[item.category]}</span><span>{loadLabels[item.cognitiveLoad]}</span><span>{item.status==="completed"?"已完成":"已安排"}</span></div></div><section className="calendar-field-group"><h4><CalendarDays size={18}/>{displayDay(localDate(item.startAt,timezone))}</h4><div className="schedule-detail-time"><div><small>开始时刻</small><strong>{localTime(item.startAt,timezone)}</strong></div><div><small>预估时长</small><strong>{item.durationMinutes}<small> 分钟</small></strong></div></div><p className="calendar-field-note">结束于 {localDate(item.endAt,timezone)!==localDate(item.startAt,timezone)?`${localDate(item.endAt,timezone)} `:""}{localTime(item.endAt,timezone)} · {timezone}</p></section>
  {item.notes&&<section className="calendar-field-group"><h4>备注</h4><p className="schedule-detail-notes">{item.notes}</p></section>}
  <section className="calendar-field-group schedule-detail-properties"><div><span><Clock3 size={16}/>提前提醒</span><strong>{item.reminderMinutes?`提前 ${item.reminderMinutes} 分钟`:"不提醒"}</strong></div><div><span>重复周期</span><strong>独立日程</strong></div>{item.deadlineAt&&<div><span>截止时间</span><strong>{displayDay(localDate(item.deadlineAt,timezone),{month:"numeric",day:"numeric"})} {localTime(item.deadlineAt,timezone)}</strong></div>}</section>
  <section className="calendar-field-group schedule-detail-properties"><div><span>排期灵活性微调</span><strong>{item.flexibility==="flexible"?"允许调整":"保持原定时间"}</strong></div><div><span><LockKeyhole size={16}/>硬约束防挤压锁定</span><strong>{item.flexibility==="hard_locked"?"已开启":item.flexibility==="focus_shield"?"深度专注保护":"未开启"}</strong></div><p className="calendar-field-note">{item.flexibility==="flexible"?"服务端生成重排方案后，仍需由你明确确认。":"此时段受到保护，不会被救援静默移动。"}</p></section>
  <Button variant="outline" disabled={pending} pending={complete.isPending} onClick={()=>complete.mutate()}><CheckCheck size={15}/>{item.status==="completed"?"重新打开":"标记完成"}</Button>{item.meetingProposalId&&<Notice>团队会议请前往团队页取消或拒绝，避免单独删除成员的日程。</Notice>}{confirmDelete&&<Notice>删除后，此日程会从时间地图移除。再次点击“确认删除”执行。</Notice>}<InlineError error={remove.error??complete.error}/></div>}
 </Drawer>;
}
