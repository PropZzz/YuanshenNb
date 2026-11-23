import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiComponents } from '@/api/client';
import { ScheduleDetail } from './schedule-detail';

type Item = ApiComponents['ScheduleItemDTO'];
const item: Item = {
  id: 'detail-item', userId: 'self', title: '跨日方案评审', notes: '确认接口边界\n记录评审结论',
  category: 'meeting', cognitiveLoad: 'high', flexibility: 'focus_shield', status: 'in_progress',
  startAt: '2026-11-23T15:30:00Z', endAt: '2026-11-23T16:30:00Z', durationMinutes: 60,
  reminderMinutes: 1440, deadlineAt: '2026-11-23T16:00:00Z',
  presentation: { attributeTag: 'review', goalId: 'goal-1', goalTitle: '完成原型评审' },
  createdAt: '2026-11-22T01:00:00Z', updatedAt: '2026-11-23T02:00:00Z',
};
const caches: QueryClient[] = [];
afterEach(() => { cleanup(); caches.splice(0).forEach(cache => cache.clear()); vi.unstubAllGlobals(); });
function mount(overrides: Partial<Item> = {}, handlers: { onClose?: () => void; onEdit?: (item: Item) => void } = {}) {
  const cache = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); caches.push(cache);
  return render(<QueryClientProvider client={cache}><ScheduleDetail id={item.id} item={{ ...item, ...overrides }} onClose={handlers.onClose ?? (() => {})} onEdit={handlers.onEdit ?? (() => {})}/></QueryClientProvider>);
}

it('shows saved attribute, actual in-progress status, goal and both cross-day endpoints', () => {
  mount(); const container = screen.getByRole('dialog', { name: '日程详情' });
  expect(screen.getByRole('heading', { name: item.title })).toBeTruthy();
  expect(screen.getByText('进行中', { exact: true })).toBeTruthy();
  expect(screen.getByText('方案评审', { exact: true })).toBeTruthy();
  expect(screen.getByText('完成原型评审', { exact: true })).toBeTruthy();
  expect(screen.getByText(/本机目标/)).toBeTruthy();
  expect(container.querySelector(`time[datetime="${item.startAt}"]`)?.textContent).toBe('23:30');
  expect(container.querySelector(`time[datetime="${item.endAt}"]`)?.textContent).toBe('00:30');
  expect(screen.getByText('11月24日星期二', { exact: true })).toBeTruthy();
  expect(container.querySelector('.schedule-detail')?.getAttribute('style')).toContain('--event-accent: #7d5689');
  expect(screen.getByText('Asia/Shanghai', { exact: true })).toBeTruthy();
});

it('shows the actual cross-day reminder instant, deadline conflict and delivery limitation', () => {
  mount(); const container = screen.getByRole('dialog', { name: '日程详情' });
  expect(container.querySelector('time[datetime="2026-11-22T15:30:00.000Z"]')?.textContent).toContain('2026年11月22日 23:30');
  expect(screen.getByText(/当前未接入系统通知/)).toBeTruthy();
  expect(container.querySelector(`time[datetime="${item.deadlineAt}"]`)?.textContent).toContain('2026年11月24日 00:00');
  expect(screen.getByText('安排结束晚于截止时间')).toBeTruthy();
  expect(screen.queryByText('独立日程')).toBeNull();
});

it.each([
  ['flexible', '排期灵活性微调', /确认后.*调整/],
  ['hard_locked', '硬约束防挤压锁定', /保持原定时段/],
  ['focus_shield', '深度专注保护', /专注保护/],
] as const)('describes only the saved %s protection mode', (flexibility, label, explanation) => {
  mount({ flexibility });
  const section = screen.getByRole('region', { name: '排期保护' });
  expect(within(section).getByText(label, { exact: true })).toBeTruthy();
  expect(section.textContent).toMatch(explanation);
  expect(within(section).queryByRole('switch')).toBeNull();
});

it('shows explicit empty values without fabricating goals, notes or reminders', () => {
  mount({ notes: '', deadlineAt: undefined, reminderMinutes: 0, presentation: undefined, status: 'planned', category: 'routine' });
  expect(screen.getByText('待完成', { exact: true })).toBeTruthy();
  for (const label of ['未设置提醒', '未设置截止时间', '未关联目标', '暂无备注']) expect(screen.getByText(label, { exact: true })).toBeTruthy();
  expect(screen.queryByText('完成原型评审')).toBeNull();
  expect(screen.getByText('日常事务', { exact: true })).toBeTruthy();
});

it.each([['planned', '标记完成', 'completed'], ['in_progress', '标记完成', 'completed'], ['completed', '重新打开', 'planned'], ['cancelled', '恢复日程', 'planned']] as const)(
  'saves the intended status from %s', async (status, label, nextStatus) => {
    const bodies: unknown[] = [], onClose = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => { bodies.push(await request.json()); return new Response(JSON.stringify({ item: { ...item, status: nextStatus } }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }));
    mount({ status }, { onClose });
    await userEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(bodies).toEqual([{ status: nextStatus }]);
  },
);

it('keeps a failed update visible and permits retry', async () => {
  const onClose = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ type: 'about:blank', title: 'Service unavailable', status: 503, code: 'UNAVAILABLE', detail: '状态保存失败，请重试' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
  mount({}, { onClose }); await userEvent.click(screen.getByRole('button', { name: '标记完成' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('状态保存失败，请重试');
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '标记完成' })).not.toBeDisabled();
});

it('allows cancelling delete confirmation before issuing any write', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); mount(); const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '删除日程' }));
  await user.click(screen.getByRole('button', { name: '保留日程' }));
  expect(screen.getByRole('button', { name: '删除日程' })).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

it('requires a second confirmation to delete and preserves the team restriction', async () => {
  const onClose = vi.fn();
  const fetch = vi.fn(async () => new Response(null, { status: 204 })); vi.stubGlobal('fetch', fetch);
  const view = mount({}, { onClose }); const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '删除日程' })); expect(fetch).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce()); view.unmount();
  mount({ meetingProposalId: 'meeting-1' });
  expect(screen.getByRole('button', { name: '删除日程' })).toBeDisabled();
  expect(screen.getByText(/团队会议请前往团队页/)).toBeTruthy();
});

it('clears a deletion failure when the user chooses to keep the schedule', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ type: 'about:blank', title: 'Unavailable', status: 503, code: 'SERVICE_UNAVAILABLE', detail: '删除暂时失败' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
  mount(); const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '删除日程' }));
  await user.click(screen.getByRole('button', { name: '确认删除' }));
  expect(await screen.findByText('删除暂时失败')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '保留日程' }));
  expect(screen.queryByText('删除暂时失败')).toBeNull();
});

it('hands the complete saved item to the editor and reveals original record timestamps', async () => {
  const onEdit = vi.fn(); mount({}, { onEdit }); const container = screen.getByRole('dialog', { name: '日程详情' }); const user = userEvent.setup();
  await user.click(screen.getByText('记录信息', { exact: true }));
  for (const value of [item.createdAt, item.updatedAt]) expect(container.querySelector(`time[datetime="${value}"]`)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '编辑日程' }));
  expect(onEdit).toHaveBeenCalledWith(item);
});
