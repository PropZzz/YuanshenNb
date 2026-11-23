import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AlarmClock, ArrowRight, Brain, CalendarDays, CheckCheck, Clock3, Edit3,
  FileText, Flag, LockKeyhole, RefreshCw, ShieldCheck, Trash2,
} from '@/components/ui/reference-icons';
import { apiClient, type ApiComponents } from '@/api/client';
import { assertSuccess, unwrap } from '@/api/unwrap';
import { useAuthStore } from '@/stores/auth-store';
import { localDate, localTime, displayDay } from '@/lib/datetime';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { ErrorState, InlineError, LoadingState, Notice } from '@/components/ui/states';
import { categoryLabels, loadLabels, useInvalidateSchedule } from './queries';
import { scheduleAttribute, scheduleStyle } from './schedule-presentation';
import './schedule-detail.css';

type Item = ApiComponents['ScheduleItemDTO'];
type Props = {
  open?: boolean; id: string; item?: Item; loading?: boolean; error?: unknown;
  retry?: () => void; onClose: () => void; onEdit: (item: Item) => void;
};
const statusLabels = { planned: '待完成', in_progress: '进行中', completed: '已完成', cancelled: '已取消' };
const protectionModes = {
  flexible: { label: '排期灵活性微调', icon: RefreshCw, note: '在你明确确认后，可按重排方案调整时间。', detail: '适合时间可协商的安排；生成方案不会直接改变当前日程。' },
  hard_locked: { label: '硬约束防挤压锁定', icon: LockKeyhole, note: '保持原定时段，仍可手动编辑。', detail: '重排时锁定当前时间，保护不可挪动的安排。' },
  focus_shield: { label: '深度专注保护', icon: ShieldCheck, note: '此日程已标记为专注保护时段。', detail: '重排时优先保护专注安排；任何变更仍需你确认。' },
};

export function ScheduleDetail({ open = true, id, item, loading = false, error, retry, onClose, onEdit }: Props) {
  const timezone = useAuthStore(state => state.user?.timezone ?? 'Asia/Shanghai');
  const invalidate = useInvalidateSchedule();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sectionId = useId();
  const remove = useMutation({
    mutationFn: async () => assertSuccess(await apiClient.DELETE('/api/v1/schedule/items/{id}', { params: { path: { id } } })),
    onSuccess: async () => { await invalidate(); onClose(); },
  });
  const complete = useMutation({
    mutationFn: async () => unwrap(await apiClient.PATCH('/api/v1/schedule/items/{id}', {
      params: { path: { id } },
      body: { status: item?.status === 'completed' || item?.status === 'cancelled' ? 'planned' : 'completed' },
    })),
    onSuccess: async () => { await invalidate(); onClose(); },
  });
  const pending = remove.isPending || complete.isPending;
  const stamp = (value: string) => displayDay(localDate(value, timezone), { year: 'numeric', month: 'long', day: 'numeric' }) + ' ' + localTime(value, timezone);
  const attribute = item && scheduleAttribute(item);
  const mode = item && protectionModes[item.flexibility];
  const ProtectionIcon = mode?.icon ?? ShieldCheck;
  const startDay = item && localDate(item.startAt, timezone);
  const endDay = item && localDate(item.endAt, timezone);
  const reminderAt = item && item.reminderMinutes > 0 ? new Date(Date.parse(item.startAt) - item.reminderMinutes * 60_000).toISOString() : null;
  const goalTitle = item?.presentation?.goalId && item.presentation.goalTitle;
  const missedDeadline = !!item?.deadlineAt && Date.parse(item.endAt) > Date.parse(item.deadlineAt);

  return <Drawer open={open} onOpenChange={nextOpen => { if (!nextOpen && !pending) onClose(); }} title="日程详情" description="查看已保存的时间安排、执行信息与排期保护" className="calendar-drawer schedule-detail-drawer" footer={item && <div className="schedule-detail-actions" aria-busy={pending}>
    <InlineError error={remove.error ?? complete.error}/>
    {confirmDelete ? <>
      <p className="schedule-delete-question" role="alert">确定删除「{item.title}」？删除后将从日历移除，无法直接撤销。</p>
      <div className="schedule-detail-action-row">
        <Button variant="outline" disabled={pending} onClick={() => { remove.reset(); setConfirmDelete(false); }}>保留日程</Button>
        <Button variant="danger" disabled={pending} pending={remove.isPending} onClick={() => remove.mutate()}><Trash2 size={16}/>确认删除</Button>
      </div>
    </> : <>
      <div className="schedule-detail-action-row">
        <Button variant="secondary" disabled={pending} pending={complete.isPending} onClick={() => { remove.reset(); complete.mutate(); }}>
          {item.status === 'completed' || item.status === 'cancelled' ? <RefreshCw size={17}/> : <CheckCheck size={17}/>}
          {item.status === 'completed' ? '重新打开' : item.status === 'cancelled' ? '恢复日程' : '标记完成'}
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => onEdit(item)}><Edit3 size={16}/>编辑日程</Button>
      </div>
      <Button className="schedule-delete-button" variant="ghost" disabled={pending || !!item.meetingProposalId} onClick={() => { complete.reset(); setConfirmDelete(true); }}><Trash2 size={14}/>删除日程</Button>
    </>}
  </div>}>
    {!item ? (loading ? <LoadingState label="正在读取日程详情"/> : <ErrorState error={error ?? new Error('当前日期范围未找到此日程，请返回选择对应日期后重试。日程可能已被删除。')} retry={retry}/>) : <article className="schedule-detail" style={scheduleStyle(item)} data-category={item.category}>
      <header className="schedule-detail-heading">
        <h3>{item.title}</h3>
        <div className="schedule-detail-badges">
          <span className="schedule-detail-attribute"><i aria-hidden="true"/>{attribute?.label ?? categoryLabels[item.category]}</span>
          <span className="schedule-detail-status" data-status={item.status}>
            {item.status === 'completed' ? <CheckCheck size={14}/> : <Clock3 size={14}/>}{statusLabels[item.status]}
          </span>
          {attribute && <span className="schedule-detail-category">{categoryLabels[item.category]}</span>}
        </div>
      </header>

      <section className="schedule-detail-interval" aria-label="时间安排">
        <div className="schedule-detail-date">
          <div className="schedule-detail-date-tile" aria-hidden="true"><span>{Number(startDay!.slice(5, 7))}月</span><strong>{Number(startDay!.slice(8))}</strong></div>
          <div><h4><CalendarDays size={15}/>{displayDay(startDay!)}</h4><p>{startDay!.slice(0, 4)}年 · <span>{timezone}</span></p></div>
          <span className="schedule-detail-duration">{item.durationMinutes}<small>分钟</small></span>
        </div>
        <div className="schedule-detail-endpoints">
          <div><span>开始时间</span><time dateTime={item.startAt}>{localTime(item.startAt, timezone)}</time><small>{displayDay(startDay!, { month: 'long', day: 'numeric', weekday: 'long' })}</small></div>
          <ArrowRight size={21}/>
          <div><span>结束时间{endDay !== startDay && <b>跨日</b>}</span><time dateTime={item.endAt}>{localTime(item.endAt, timezone)}</time><small>{displayDay(endDay!, { month: 'long', day: 'numeric', weekday: 'long' })}</small></div>
        </div>
      </section>

      <section className="schedule-detail-section" aria-labelledby={sectionId + '-execution'}>
        <h4 id={sectionId + '-execution'}>执行信息</h4>
        <dl className="schedule-detail-facts">
          <div className="schedule-detail-fact"><dt><AlarmClock size={17}/>提醒设置</dt><dd><strong>{reminderAt ? '提前 ' + item.reminderMinutes + ' 分钟' : '未设置提醒'}</strong>{reminderAt && <><time dateTime={reminderAt}>{stamp(reminderAt)}</time><small>仅保存提醒设置，当前未接入系统通知。</small></>}</dd></div>
          <div className="schedule-detail-fact" data-warning={missedDeadline || undefined}><dt><Flag size={17}/>截止时间</dt><dd>{item.deadlineAt ? <><time dateTime={item.deadlineAt} className="schedule-detail-fact-value">{stamp(item.deadlineAt)}</time>{missedDeadline && <small>安排结束晚于截止时间</small>}</> : <strong className="schedule-detail-empty">未设置截止时间</strong>}</dd></div>
          <div className="schedule-detail-fact"><dt><Brain size={17}/>认知负荷</dt><dd><div className="schedule-detail-load"><strong>{loadLabels[item.cognitiveLoad]}</strong><span aria-hidden="true">{[1, 2, 3].map(level => <i key={level} data-filled={level <= ({ low: 1, medium: 2, high: 3 }[item.cognitiveLoad])}/>)}</span></div><small>创建或编辑日程时设定的任务负荷</small></dd></div>
        </dl>
      </section>

      <section className="schedule-detail-protection" aria-labelledby={sectionId + '-protection'} data-mode={item.flexibility}>
        <div className="schedule-detail-protection-icon"><ProtectionIcon size={23}/></div>
        <div><h4 id={sectionId + '-protection'}>排期保护</h4><strong>{mode!.label}</strong><p>{mode!.note}</p><small>{mode!.detail}</small></div>
      </section>

      <section className="schedule-detail-section schedule-detail-goal" aria-labelledby={sectionId + '-goal'}>
        <h4 id={sectionId + '-goal'}><Flag size={17}/>关联目标</h4>
        {goalTitle ? <><p>{goalTitle}</p><small>本机目标关联 · 名称随日程保存</small></> : <><p className="schedule-detail-empty">未关联目标</p><small>可在编辑日程中选择已有本机目标</small></>}
      </section>

      <section className="schedule-detail-section" aria-labelledby={sectionId + '-notes'}>
        <h4 id={sectionId + '-notes'}><FileText size={17}/>备注</h4>
        <p className={'schedule-detail-notes' + (item.notes.trim() ? '' : ' schedule-detail-empty')}>{item.notes.trim() ? item.notes : '暂无备注'}</p>
      </section>

      {item.meetingProposalId && <Notice>团队会议请前往团队页取消或拒绝，避免单独删除成员的日程。</Notice>}
      <details className="schedule-detail-record"><summary>记录信息</summary><dl>
        <div><dt>日程归属</dt><dd>{item.meetingProposalId || item.workspaceId ? '团队日程' : '个人日程'}</dd></div>
        <div><dt>创建时间</dt><dd><time dateTime={item.createdAt}>{stamp(item.createdAt)}</time></dd></div>
        <div><dt>最近更新</dt><dd><time dateTime={item.updatedAt}>{stamp(item.updatedAt)}</time></dd></div>
        <div><dt>日程编号</dt><dd>{item.id}</dd></div>
      </dl></details>
    </article>}
  </Drawer>;
}
