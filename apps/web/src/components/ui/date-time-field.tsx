import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useId, useRef, useState, type KeyboardEvent } from "react";
export interface DateTimeFieldProps { name?:string;label:string;value?:string;defaultValue?:string;onChange?:(value:string)=>void;required?:boolean;disabled?:boolean;type?:"time"|"datetime-local"|"date"; }
function dateString(date: Date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`; }
export function DateTimeField({label,value,defaultValue,onChange,type="datetime-local",...props}:DateTimeFieldProps) {
 const [local,setLocal]=useState(defaultValue??""),[picker,setPicker]=useState<"time"|"date"|null>(null),[hour,setHour]=useState(9),[minute,setMinute]=useState(0);
 const [selectedDay,setSelectedDay]=useState(""),[month,setMonth]=useState(()=>new Date().toLocaleDateString("sv-SE").slice(0,7)+"-01");
 const id=useId(),field=useRef<HTMLDivElement>(null),popup=useRef<HTMLDivElement>(null),opener=useRef<HTMLButtonElement|null>(null),[position,setPosition]=useState({top:0,left:0});const current=value??local;
 function change(next:string){setLocal(next);onChange?.(next);}
 function show(kind:"date"|"time",button:HTMLButtonElement){
  opener.current=button;
  const time=type==="time"?current:current.split("T")[1]??"09:00";setHour(Number(time.slice(0,2))||0);setMinute(Number(time.slice(3,5))||0);
  const day=/^\d{4}-\d{2}-\d{2}/.test(current)?current.slice(0,10):new Date().toLocaleDateString("sv-SE");setSelectedDay(day);setMonth(day.slice(0,7)+"-01");
  const rect=field.current!.getBoundingClientRect(),height=kind==="date"?352:320;setPosition({left:Math.max(12,Math.min(rect.right-260,window.innerWidth-272)),top:rect.bottom+height>window.innerHeight?Math.max(12,rect.top-height):rect.bottom+6});setPicker(kind);
 }
 function applyTime(){const time=`${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`;change(type==="time"?time:`${current.slice(0,10)||new Date().toLocaleDateString("sv-SE")}T${time}`);setPicker(null);}
 function applyDate(){change(type==="date"?selectedDay:`${selectedDay}T${current.split("T")[1]||"09:00"}`);setPicker(null);}
 function moveTime(event:KeyboardEvent<HTMLDivElement>,kind:"hour"|"minute"){
  if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;event.preventDefault();
  const max=kind==="hour"?23:59,old=kind==="hour"?hour:minute,next=event.key==="Home"?0:event.key==="End"?max:(old+(event.key==="ArrowDown"?1:max))%(max+1);(kind==="hour"?setHour:setMinute)(next);event.currentTarget.querySelector(`[data-value="${next}"]`)?.scrollIntoView?.({block:"nearest"});
 }
 function shiftMonth(offset:number){const next=new Date(month+"T12:00:00Z");next.setUTCMonth(next.getUTCMonth()+offset);setMonth(dateString(next));}
 const first=new Date(month+"T12:00:00Z"),offset=(first.getUTCDay()+6)%7;
 const dates=Array.from({length:42},(_,index)=>{const day=new Date(first);day.setUTCDate(day.getUTCDate()+index-offset);return dateString(day);});
 return <div className="field"><label htmlFor={id}>{label}</label><div className="reference-time-field" ref={field}>
  <input {...props} id={id} type={type} value={current} onChange={e=>change(e.target.value)}/>
  {type!=="time"&&<button type="button" disabled={props.disabled} aria-label={`选择${label}日期`} aria-expanded={picker==="date"} onClick={e=>show("date",e.currentTarget)}><span className="material-symbols-outlined" aria-hidden="true">calendar_today</span></button>}
  {type!=="date"&&<button type="button" disabled={props.disabled} aria-label={`选择${label}`} aria-expanded={picker==="time"} onClick={e=>show("time",e.currentTarget)}><span className="material-symbols-outlined" aria-hidden="true">schedule</span></button>}
 </div><DialogPrimitive.Root open={picker!==null} onOpenChange={open=>{if(!open)setPicker(null);}}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="time-picker-overlay"/>
 <DialogPrimitive.Content ref={popup} className="reference-time-popover" style={position} aria-describedby={undefined} onOpenAutoFocus={event=>{if(picker!=="time")return;event.preventDefault();popup.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus();popup.current?.querySelectorAll<HTMLElement>('[aria-selected="true"]').forEach(option=>option.scrollIntoView?.({block:"nearest",inline:"nearest"}));}} onCloseAutoFocus={event=>{if(opener.current?.isConnected){event.preventDefault();opener.current.focus();}}}>
  {picker==="date"?<><header><DialogPrimitive.Title>选择日期</DialogPrimitive.Title><button className="reference-picker-dismiss" aria-label="关闭日期选择" onClick={()=>setPicker(null)}><span className="material-symbols-outlined" aria-hidden="true">close</span></button></header>
   <div className="reference-month-heading"><button type="button" aria-label="上个月" onClick={()=>shiftMonth(-1)}><span className="material-symbols-outlined" aria-hidden="true">chevron_left</span></button><strong>{Number(month.slice(0,4))} 年 {Number(month.slice(5,7))} 月</strong><button type="button" aria-label="下个月" onClick={()=>shiftMonth(1)}><span className="material-symbols-outlined" aria-hidden="true">chevron_right</span></button></div>
   <div className="reference-month-weekdays">{["一","二","三","四","五","六","日"].map(day=><span key={day}>{day}</span>)}</div>
   <div className="reference-month-days" role="group" aria-label="日期">{dates.map(day=><button type="button" key={day} aria-label={day} aria-pressed={selectedDay===day} className={day.slice(0,7)!==month.slice(0,7)?"outside":""} onClick={()=>setSelectedDay(day)}>{Number(day.slice(-2))}</button>)}</div>
   <div className="reference-date-actions"><button type="button" onClick={()=>{const today=new Date().toLocaleDateString("sv-SE");setSelectedDay(today);setMonth(today.slice(0,7)+"-01");}}>今天</button><button type="button" className="button button-primary" onClick={applyDate}>确认日期</button></div>
  </>:<><header><DialogPrimitive.Title>{`选择${label}`}</DialogPrimitive.Title><strong>{String(hour).padStart(2,"0")}:{String(minute).padStart(2,"0")}</strong></header><div className="reference-time-columns">{(["hour","minute"] as const).map(kind=><div key={kind}><span>{kind==="hour"?"小时":"分钟"}</span><div role="listbox" aria-label={kind==="hour"?"小时":"分钟"} tabIndex={0} onKeyDown={event=>moveTime(event,kind)}>{Array.from({length:kind==="hour"?24:60},(_,n)=><button key={n} type="button" role="option" data-value={n} aria-label={`${n} ${kind==="hour"?"时":"分"}`} aria-selected={(kind==="hour"?hour:minute)===n} onClick={()=>(kind==="hour"?setHour:setMinute)(n)}>{String(n).padStart(2,"0")}</button>)}</div></div>)}</div><button type="button" className="button button-primary w-full mt-3" onClick={applyTime}>确认时间</button></>}
 </DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root></div>;
}
