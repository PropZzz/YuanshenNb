import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiComponents } from '@/api/client';
import { weekDays } from '@/lib/datetime';
import { GanttMap, MonthMap } from './calendar-views';
import { defaultCalendarOptions } from './calendar-options';
import { TimeMap } from './time-map';

const item: ApiComponents['ScheduleItemDTO'] = {
  id: 'layout-item', userId: 'self', title: '架构设计与需求讨论的完整中文标题', notes: '整理接口边界，并记录下一步行动。',
  startAt: '2026-11-24T01:00:00Z', endAt: '2026-11-24T03:00:00Z', durationMinutes: 120,
  category: 'deep_work', cognitiveLoad: 'medium', flexibility: 'focus_shield', status: 'completed', reminderMinutes: 10,
  presentation: { attributeTag: 'coding', goalId: 'real-goal', goalTitle: '完成项目架构' },
  createdAt: '2026-11-23T00:00:00Z', updatedAt: '2026-11-23T00:00:00Z',
};

afterEach(cleanup);

it('keeps notes, status and real linked metadata available in a spacious day card', async () => {
  const onEdit = vi.fn();
  render(<TimeMap days={['2026-11-24']} items={[item]} timezone="Asia/Shanghai" showEnergy={false} onEdit={onEdit} onCreate={vi.fn()} />);
  const card = screen.getByRole('button', { name: item.title + ' 09:00至11:00' });
  expect(within(card).getByText(item.notes)).toBeTruthy();
  expect(within(card).getByRole('img', { name: '已完成' })).toBeTruthy();
  expect(within(card).getByRole('img', { name: '目标：完成项目架构' })).toBeTruthy();
  expect(card.getAttribute('data-attribute')).toBe('coding');
  await userEvent.click(card);
  expect(onEdit).toHaveBeenCalledWith(item);
});

it('keeps the same detail action on a tiny gantt interval and its readable label', async () => {
  const onEdit = vi.fn();
  const short = { ...item, endAt: '2026-11-24T01:15:00Z', durationMinutes: 15 };
  const { container } = render(<GanttMap selectedDay="2026-11-24" days={weekDays('2026-11-24')} items={[short]} timezone="Asia/Shanghai" ganttScale="week" onScaleChange={vi.fn()} onSelectDay={vi.fn()} onEdit={onEdit} onCreate={vi.fn()} />);
  const label = screen.getByRole('button', { name: item.title + ' 09:00至09:15' });
  expect(within(label).getByText('11-24 09:00 – 09:15')).toBeTruthy();
  expect(container.querySelector<HTMLElement>('.cal-gantt-bar')?.style.getPropertyValue('--gantt-length')).toBe(100 * 15 / (7 * 1440) + '%');
  await userEvent.click(label);
  await userEvent.click(screen.getByRole('button', { name: '查看 ' + item.title }));
  expect(onEdit).toHaveBeenCalledTimes(2);
});

it('respects display filters after the day card expands', () => {
  render(<TimeMap days={['2026-11-24']} items={[item]} timezone="Asia/Shanghai" showEnergy={false} onEdit={vi.fn()} onCreate={vi.fn()} options={{ ...defaultCalendarOptions, attributeTags: false, completionStatus: false, buffersAndReminders: false, strategyLinks: false }} />);
  const card = screen.getByRole('button', { name: item.title + ' 09:00至11:00' });
  expect(within(card).queryByRole('img')).toBeNull();
  expect(within(card).queryByText('架构编码')).toBeNull();
  expect(card.classList.contains('is-complete')).toBe(false);
});

const course:ApiComponents['ScheduleItemDTO'] = { ...item, title: '课程地点展示', notes: '教师：王老师\n地点：B座507\n第 1 周 · 第 3-4 节', presentation: { attributeTag: 'study' } };

it.each(['day','week'])('shows the saved classroom separately in a %s card without importing it again',view=>{
 const {container}=render(<TimeMap days={view==='day'?['2026-11-24']:weekDays('2026-11-24')} items={[course]} timezone="Asia/Shanghai" showEnergy={false} onEdit={vi.fn()} onCreate={vi.fn()} />);
 const card=screen.getByRole('button',{name:course.title+' 09:00至11:00'});
 expect(within(card).getByLabelText('地点：B座507').textContent).toBe('B座507');
 expect(container.querySelector('.event-detail')?.textContent).toContain('教师：王老师');
 expect(container.querySelector('.event-detail')?.textContent).not.toContain('地点：');
});

it('keeps the saved classroom visible in a month card, its agenda and the gantt label',()=>{
 const view=render(<MonthMap selectedDay="2026-11-24" days={weekDays('2026-11-24')} items={[course]} timezone="Asia/Shanghai" onSelectDay={vi.fn()} onEdit={vi.fn()} onCreate={vi.fn()} />);
 expect(view.container.querySelector('.cal-event-compact .event-location')?.textContent).toBe('B座507');
 expect(view.container.querySelector('.cal-agenda-item .event-location')?.textContent).toBe('B座507');
 view.rerender(<GanttMap selectedDay="2026-11-24" days={weekDays('2026-11-24')} items={[course]} timezone="Asia/Shanghai" ganttScale="week" onScaleChange={vi.fn()} onSelectDay={vi.fn()} onEdit={vi.fn()} onCreate={vi.fn()} />);
 expect(view.container.querySelector('.cal-gantt-label .event-location')?.textContent).toBe('B座507');
});

it.each(['教室：A101','上课地点: 图书馆北区五楼研讨室501','Location: Room 307'])('recognizes the explicit saved location label %s',notes=>{
 const located={...course,notes};
 render(<TimeMap days={['2026-11-24']} items={[located]} timezone="Asia/Shanghai" showEnergy={false} onEdit={vi.fn()} onCreate={vi.fn()} />);
 const location=notes.split(/[：:]/).slice(1).join(':').trim();
 expect(screen.getByLabelText('地点：'+location).textContent).toBe(location);
});

it('does not invent a classroom from ordinary notes',()=>{
 const {container}=render(<TimeMap days={['2026-11-24']} items={[{...item,notes:'请课前阅读教室分配通知，周三再确认地点。'}]} timezone="Asia/Shanghai" showEnergy={false} onEdit={vi.fn()} onCreate={vi.fn()} />);
 expect(container.querySelector('.event-location')).toBeNull();
});
