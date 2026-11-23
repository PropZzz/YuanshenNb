import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { ApiComponents } from '@/api/client';
import { CalendarSummary } from './calendar-summary';
afterEach(cleanup);
const props={day:'2026-11-23',today:'2026-11-23',timezone:'Asia/Shanghai',scheduleError:false,energyError:false};
it('never presents a failed read as zero saved schedules or zero protection windows',()=>{
 render(<CalendarSummary {...props} scheduleError energyError/>);
 expect(screen.getByText('日程读取失败')).toBeTruthy();expect(screen.getByText('保护窗口读取失败')).toBeTruthy();expect(screen.queryByText(/0 项日程|0 段/)).toBeNull();
});
it('identifies baseline scores as estimates and displays actual empty returned arrays',()=>{
 const energy={localDay:props.day,score:41,dataFreshness:'baseline_only',hourlyCurve:[],focusShields:[]} as unknown as ApiComponents['EnergyTodayResponse'];
 render(<CalendarSummary {...props} items={[]} energy={energy}/>);
 expect(screen.getByText('节律估算 41')).toBeTruthy();expect(screen.getByText(/未接入实时穿戴/)).toBeTruthy();expect(screen.getByText('今日 0 项日程')).toBeTruthy();expect(screen.getByText('预测保护窗口 0 段')).toBeTruthy();
});
