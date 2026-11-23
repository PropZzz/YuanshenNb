import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { scheduleAttribute, ScheduleMeta, summarizeDay } from './schedule-presentation';
import { defaultCalendarOptions } from './calendar-options';
import type { ApiComponents } from '@/api/client';
afterEach(cleanup);
const item:ApiComponents['ScheduleItemDTO']={id:'i',userId:'u',title:'跨天学习',notes:'',category:'deep_work',cognitiveLoad:'medium',flexibility:'flexible',status:'completed',startAt:'2026-11-22T15:30:00Z',endAt:'2026-11-22T17:00:00Z',durationMinutes:90,reminderMinutes:10,createdAt:'2026-11-20T00:00:00Z',updatedAt:'2026-11-20T00:00:00Z',presentation:{attributeTag:'study',goalId:'g',goalTitle:'完成学期计划'}};
it('resolves the real saved attribute instead of guessing from schedule titles',()=>{
 expect(scheduleAttribute(item)?.label).toBe('上课学习');
 expect(scheduleAttribute({...item,presentation:undefined})).toBeUndefined();
});
it('makes metadata toggles remove their corresponding real fields',()=>{
 const view=render(<ScheduleMeta item={item} options={defaultCalendarOptions}/>);
 expect(screen.getByText('上课学习')).toBeTruthy();expect(screen.getByText('已完成')).toBeTruthy();expect(screen.getByText('提前 10 分钟')).toBeTruthy();expect(screen.getByText('目标：完成学期计划')).toBeTruthy();
 view.rerender(<ScheduleMeta item={item} options={{...defaultCalendarOptions,attributeTags:false,completionStatus:false,buffersAndReminders:false,strategyLinks:false}}/>);
 expect(screen.queryByText('上课学习')).toBeNull();expect(screen.queryByText('已完成')).toBeNull();expect(screen.queryByText('提前 10 分钟')).toBeNull();expect(screen.queryByText('目标：完成学期计划')).toBeNull();
});
it('does not invent a goal when no association exists',()=>{
 render(<ScheduleMeta item={{...item,presentation:undefined}} options={defaultCalendarOptions}/>);
 expect(screen.queryByText(/目标：|未关联目标/)).toBeNull();
});
it('counts only actual selected-day overlap and excludes cancelled schedules',()=>{
 expect(summarizeDay([item,{...item,id:'cancelled',status:'cancelled'}],'2026-11-23','Asia/Shanghai')).toEqual({count:1,minutes:60,protectedCount:0});
});
