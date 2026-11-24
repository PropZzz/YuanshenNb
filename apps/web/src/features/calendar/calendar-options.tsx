import { useEffect, useState } from "react";
import { Check, RotateCcw, SlidersHorizontal } from "@/components/ui/reference-icons";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";

export interface CalendarOptions { startHour:number; endHour:number; hourHeight:44|60|80; nowLine:boolean; autoScroll:boolean;timeRuler:boolean;attributeTags:boolean;completionStatus:boolean;buffersAndReminders:boolean;strategyLinks:boolean;energyBands:boolean }
export const calendarDisplayFilters=[{key:"timeRuler",label:"时间标尺"},{key:"attributeTags",label:"属性标签"},{key:"completionStatus",label:"完成状态"},{key:"buffersAndReminders",label:"缓冲与提醒"},{key:"strategyLinks",label:"战略目标关联"}] as const;
export const calendarOptionsKey="ruanchuang-calendar-options";
export const defaultCalendarOptions:CalendarOptions={startHour:8,endHour:21,hourHeight:60,nowLine:true,autoScroll:true,timeRuler:true,attributeTags:true,completionStatus:true,buffersAndReminders:true,strategyLinks:true,energyBands:true};
export function readCalendarOptions():CalendarOptions {
 try {const value=JSON.parse(localStorage.getItem(calendarOptionsKey)??"{}");return {
  startHour:[6,7,8].includes(value.startHour)?value.startHour:8,endHour:[19,20,21].includes(value.endHour)?value.endHour:21,
  hourHeight:[44,60,80].includes(value.hourHeight)?value.hourHeight:60,nowLine:value.nowLine!==false,autoScroll:value.autoScroll!==false,
  timeRuler:value.timeRuler!==false,attributeTags:value.attributeTags!==false,completionStatus:value.completionStatus!==false,buffersAndReminders:value.buffersAndReminders!==false,strategyLinks:value.strategyLinks!==false,energyBands:value.energyBands!==false,
 };} catch{return {...defaultCalendarOptions};}
}
export function useCalendarOptions(){
 const [options,setOptions]=useState(readCalendarOptions),[storageError,setStorageError]=useState(false);
 useEffect(()=>{const update=(event:StorageEvent)=>{if(event.key===calendarOptionsKey||event.key===null)setOptions(readCalendarOptions());};window.addEventListener("storage",update);return()=>window.removeEventListener("storage",update);},[]);
 function update(value:CalendarOptions){setOptions(value);try{localStorage.setItem(calendarOptionsKey,JSON.stringify(value));setStorageError(false);}catch{setStorageError(true);}}
 return {options,update,storageError};
}
export function CalendarOptionsDrawer({open=true,options,onChange,onClose,storageError=false}:{open?:boolean;options:CalendarOptions;onChange:(value:CalendarOptions)=>void;onClose:()=>void;storageError?:boolean}){
 const set=<K extends keyof CalendarOptions>(key:K,value:CalendarOptions[K])=>onChange({...options,[key]:value});
 return <Drawer open={open} onOpenChange={open=>{if(!open)onClose();}} title="日历显示选项" className="calendar-drawer" footer={<div className="calendar-drawer-actions"><Button onClick={onClose}><Check size={16}/>完成</Button><Button variant="ghost" onClick={()=>onChange({...defaultCalendarOptions})}><RotateCcw size={14}/>恢复默认显示</Button></div>}>
  <div className="calendar-drawer-stack"><section className="calendar-option-section"><h3><SlidersHorizontal size={16}/>时间轴范围</h3><div className="calendar-option-columns"><div><h4>起始时刻</h4><div className="calendar-pills">{[6,7,8].map(hour=><button type="button" key={hour} aria-pressed={options.startHour===hour} onClick={()=>set("startHour",hour)}>{String(hour).padStart(2,"0")}:00</button>)}</div></div><div><h4>结束时刻</h4><div className="calendar-pills">{[19,20,21].map(hour=><button type="button" key={hour} aria-pressed={options.endHour===hour} onClick={()=>set("endHour",hour)}>{hour}:00</button>)}</div></div></div><p className="calendar-field-note">范围内的时段始终完整显示；更早或更晚的真实日程仍会自动扩展时间轴。</p></section>
  <section className="calendar-option-section"><h3>刻度密度</h3><div className="calendar-pills">{([[44,"紧凑"],[60,"标准"],[80,"宽松"]] as const).map(([height,label])=><button type="button" key={height} aria-pressed={options.hourHeight===height} onClick={()=>set("hourHeight",height)}>{label}</button>)}</div></section>
  {([{key:"nowLine",label:"显示当前时间线",note:"在今天的时间列标记“现在”指示线"},{key:"autoScroll",label:"自动定位到当前时间",note:"打开日历时滚动到“现在”附近"}] as const).map(({key,label,note})=><div className="calendar-switch-row" key={key}><div><strong>{label}</strong><p>{note}</p></div><button type="button" role="switch" aria-label={label} aria-checked={options[key]} className="calendar-switch" onClick={()=>set(key,!options[key])}><span/></button></div>)}
  <section className="calendar-option-section"><h3>视域滤镜</h3><div className="calendar-display-filter-grid">{calendarDisplayFilters.map(({key,label})=><label key={key}><input type="checkbox" checked={options[key]} onChange={event=>set(key,event.target.checked)}/>{label}</label>)}</div><p className="calendar-field-note">仅控制字段、提醒与保护窗口的呈现。战略关联仅显示你已明确关联的真实目标；没有关联时不显示占位标签。精力底色仅在日 / 周视图显示所选日期的服务端逐时预测，使用柔和背景并在日期下方显示分数；缺少数据时不绘制。</p></section>
  <div className="calendar-local-note"><SlidersHorizontal size={20}/><div><strong>仅影响本机显示 <span>即时生效</span></strong><p>调整结果保存在本设备，不会修改已保存的日程数据；在其他设备登录不受影响。</p></div></div>
  {storageError&&<p role="alert" className="inline-error">本设备不允许保存偏好，本次显示选项只在当前页面生效。</p>}</div>
 </Drawer>;
}
