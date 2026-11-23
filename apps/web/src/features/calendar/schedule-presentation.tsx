import type { CSSProperties } from 'react';
import type { ApiComponents } from '@/api/client';
import { dayRange } from '@/lib/datetime';
import type { CalendarOptions } from './calendar-options';
import { AlarmClock, CheckCheck, Clock3, Flag } from '@/components/ui/reference-icons';

type Item=ApiComponents['ScheduleItemDTO'];
export const scheduleAttributes=[
 {id:'review',label:'方案评审',category:'meeting',color:'#7d5689'},
 {id:'collaboration',label:'跨部门协同',category:'meeting',color:'#3269aa'},
 {id:'coding',label:'架构编码',category:'deep_work',color:'#236b67'},
 {id:'research',label:'随笔调研',category:'deep_work',color:'#7566a7'},
 {id:'routine',label:'日常规程',category:'routine',color:'#87653c'},
 {id:'study',label:'上课学习',category:'deep_work',color:'#3f7a4e'},
 {id:'homework',label:'作业自习',category:'deep_work',color:'#25836f'},
 {id:'exam',label:'考试复习',category:'deep_work',color:'#a24d58'},
 {id:'meeting',label:'工作会议',category:'meeting',color:'#317a9b'},
 {id:'project',label:'项目推进',category:'deep_work',color:'#ad652f'},
 {id:'recovery',label:'运动休息',category:'recovery',color:'#7b7832'},
] as const;
export function attributeFromText(value:string){return scheduleAttributes.find(attribute=>attribute.id===value||attribute.label===value.trim());}
export function scheduleAttribute(item:Item){return attributeFromText(item.presentation?.attributeTag??'');}
export function scheduleStyle(item:Item):CSSProperties|undefined{
 const attribute=scheduleAttribute(item);return attribute?{'--event-accent':attribute.color} as CSSProperties:undefined;
}
const categories={deep_work:'深度工作',meeting:'协同会议',recovery:'恢复缓冲',routine:'日常事务',urgent:'紧急任务'};
export function ScheduleMeta({item,options}:{item:Item;options:CalendarOptions}){
 const goal=item.presentation?.goalId&&item.presentation?.goalTitle?item.presentation.goalTitle:null;
 return <span className="schedule-meta">
  {options.attributeTags&&<span className="event-category">{scheduleAttribute(item)?.label??categories[item.category]}</span>}
  {options.completionStatus&&<span className="event-status" role="img" aria-label={item.status==='completed'?'已完成':item.status==='cancelled'?'已取消':'待完成'} title={item.status==='completed'?'已完成':item.status==='cancelled'?'已取消':'待完成'}>{item.status==='completed'?<CheckCheck size={10}/>:<Clock3 size={10}/>}<span className="metadata-text">{item.status==='completed'?'已完成':item.status==='cancelled'?'已取消':'待完成'}</span></span>}
  {options.buffersAndReminders&&item.category==='recovery'&&<span className="event-buffer" title={`恢复缓冲 ${item.durationMinutes} 分钟`}><Clock3 size={10}/><span className="metadata-text">恢复缓冲 {item.durationMinutes} 分钟</span></span>}
  {options.buffersAndReminders&&item.reminderMinutes>0&&<span className="event-reminder" role="img" aria-label={`提前 ${item.reminderMinutes} 分钟`} title={`提前 ${item.reminderMinutes} 分钟提醒`}><AlarmClock size={10}/><span className="metadata-text">提前 {item.reminderMinutes} 分钟</span></span>}
  {options.strategyLinks&&goal&&<span className="event-goal-link" role="img" aria-label={'目标：'+goal} title={'关联自本机目标：'+goal}><Flag size={10}/><span className="metadata-text">目标：{goal}</span></span>}
 </span>;
}
export function summarizeDay(items:Item[],day:string,timezone:string){
 const range=dayRange(day,timezone),from=Date.parse(range.from),to=Date.parse(range.to);
 const selected=items.filter(item=>item.status!=='cancelled'&&Date.parse(item.startAt)<to&&Date.parse(item.endAt)>from);
 return {count:selected.length,minutes:selected.reduce((sum,item)=>sum+Math.round((Math.min(to,Date.parse(item.endAt))-Math.max(from,Date.parse(item.startAt)))/60000),0),protectedCount:selected.filter(item=>item.flexibility==='focus_shield').length};
}
export function AttributeLegend({items}:{items:Item[]}){
 const used=scheduleAttributes.filter(attribute=>items.some(item=>item.presentation?.attributeTag===attribute.id));
 return used.length?<span className="attribute-legend" aria-label="日程属性颜色">{used.map(attribute=><span key={attribute.id}><i style={{background:attribute.color}}/>{attribute.label}</span>)}</span>:null;
}
