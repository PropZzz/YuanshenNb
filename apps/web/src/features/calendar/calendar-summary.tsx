import { BatteryCharging, CalendarDays, ShieldCheck } from '@/components/ui/reference-icons';
import type { ApiComponents } from '@/api/client';
import { summarizeDay } from './schedule-presentation';

export function CalendarSummary({day,today,timezone,items,scheduleError,energy,energyError}:{
 day:string;today:string;timezone:string;items?:ApiComponents['ScheduleItemDTO'][];
 scheduleError:boolean;energy?:ApiComponents['EnergyTodayResponse'];energyError:boolean;
}){
 const summary=items?summarizeDay(items,day,timezone):null;
 const periodCount=items?.filter(item=>item.status!=='cancelled').length;
 const validEnergy=energy?.localDay===day&&Number.isFinite(energy.score)?energy:undefined;
 const estimated=validEnergy?.dataFreshness==='baseline_only',replay=validEnergy?.dataFreshness==='replay_demo';
 const scoreLabel=energyError&&!validEnergy?'精力读取失败':!validEnergy?'精力读取中':`${estimated?'节律估算':replay?'测试回放':today===day?'今日精力':'所选日精力'} ${validEnergy.score}`;
 const source=energyError&&validEnergy?'更新失败 · 上次数据':estimated?'未接入实时穿戴 · 基线估算':replay?'回放测试数据，非实时测量':validEnergy?.dataFreshness==='live_wearable'?'穿戴实时数据':validEnergy?'最近同步的穿戴数据':'等待服务端响应';
 return <section className="calendar-rhythm" aria-label="日历真实数据概览" aria-live="polite">
  <span><BatteryCharging size={16}/><strong>{scoreLabel}</strong><small>{source}</small></span>
  <span><ShieldCheck size={16}/><strong>{validEnergy?`预测保护窗口 ${validEnergy.focusShields.length} 段`:energyError?'保护窗口读取失败':'保护窗口读取中'}</strong><small>{summary?`已保存专注保护日程 ${summary.protectedCount} 项`:'来自所选日服务端预测'}</small></span>
  <span><CalendarDays size={16}/><strong>{summary?`${today===day?'今日':'所选日'} ${summary.count} 项日程`:scheduleError?'日程读取失败':'日程读取中'}</strong><small>{summary?`${summary.minutes} 分钟 · 当前视域 ${periodCount} 项${scheduleError?' · 更新失败，显示上次结果':''}`:'尚无已确认的日程统计'}</small></span>
 </section>;
}
