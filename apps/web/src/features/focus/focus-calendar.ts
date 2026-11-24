import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient, type ApiComponents } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import { unwrap } from "@/api/unwrap";
import { dayRange, localDate } from "@/lib/datetime";
import { useSchedules } from "@/features/calendar/queries";
import { useFocusSession } from "./focus-session";

type Item = ApiComponents["ScheduleItemDTO"];
type Schedule = ApiComponents["ScheduleItemListResponse"];
const LOOKAHEAD_MS = 62 * 86_400_000;
const unfinished = (item: Item) => item.status === "planned" || item.status === "in_progress";
const validInterval = (item: Item) => Number.isFinite(Date.parse(item.startAt)) && Date.parse(item.endAt) > Date.parse(item.startAt);
const chronological = (a: Item, b: Item) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.id.localeCompare(b.id);

export function useFocusCalendar(now: number, ownerId: string, timezone: string) {
  const session = useFocusSession();
  const day = localDate(now, timezone), today = dayRange(day, timezone);
  // Use an absolute span so DST cannot exceed the API's 62-day maximum.
  const to = new Date(Date.parse(today.from) + LOOKAHEAD_MS).toISOString();
  const schedule = useSchedules(today.from, to);
  const hasSession = session.ownerId === ownerId && !!session.itemId && !!session.itemStartAt;
  const anchor = dayRange(localDate(session.itemStartAt ?? now, timezone), timezone);
  const outsideWindow = hasSession && (Date.parse(anchor.to) <= Date.parse(today.from) || Date.parse(anchor.from) >= Date.parse(to));
  // A running session can outlive its calendar interval or cross midnight.
  // Its original day stays in the same schedule cache/invalidation family.
  const originalDay = useQuery({
    queryKey: queryKeys.schedule.items(anchor.from, anchor.to),
    queryFn: async () => unwrap(await apiClient.GET("/api/v1/schedule/items", { params: { query: { from: anchor.from, to: anchor.to } } })),
    enabled: outsideWindow,
    staleTime: 15_000,
  });
  const items = (schedule.data?.items ?? []).filter(item => item.userId === ownerId && item.status !== "cancelled" && validInterval(item)).sort(chronological);
  const pending = items.filter(item => unfinished(item) && Date.parse(item.endAt) > now);
  const ongoing = pending.filter(item => Date.parse(item.startAt) <= now);
  const recommended = ongoing.find(item => item.status === "in_progress") ?? ongoing[0] ?? pending[0];
  const source = outsideWindow ? originalDay : schedule;
  const sessionItem = items.find(item => item.id === session.itemId) ?? (source.data?.items ?? []).find(item => item.id === session.itemId && item.userId === ownerId && validInterval(item));
  const pinned = hasSession && sessionItem && unfinished(sessionItem) && (session.startedAt !== null || Date.parse(sessionItem.endAt) > now) ? sessionItem : undefined;
  const [selection, setSelection] = useState<{ ownerId: string; id: string; recommendedId?: string; data?: Schedule }>();
  const [stopped, setStopped] = useState<{ ownerId: string; message: string }>();
  const selected = selection?.ownerId === ownerId && selection.data === schedule.data && selection.recommendedId === recommended?.id
    ? pending.find(item => item.id === selection.id) : undefined;
  const awaitingSession = hasSession && !source.isSuccess;
  const current = awaitingSession ? undefined : pinned ?? selected ?? recommended;

  useEffect(() => {
    if (!hasSession || !source.isSuccess || pinned) return;
    setStopped({ ownerId, message: sessionItem && unfinished(sessionItem)
      ? "上一项已过计划时段，暂停的计时已结束。已为你显示下一项日历安排。"
      : "上一项日程已变更，本次计时已停止。已为你重新关联日历安排。" });
    session.clear();
  }, [hasSession, source.isSuccess, pinned, ownerId, sessionItem, session.clear]);

  function choose(id: string) {
    if (session.startedAt !== null || !pending.some(item => item.id === id)) return;
    session.choose(ownerId, id);
    setSelection({ ownerId, id, recommendedId: recommended?.id, data: schedule.data });
    setStopped(undefined);
  }
  return {
    day, schedule, current, pending, choose,
    todayItems: items.filter(item => Date.parse(item.startAt) < Date.parse(today.to) && Date.parse(item.endAt) > Date.parse(today.from)),
    stoppedMessage: stopped?.ownerId === ownerId ? stopped.message : undefined,
    loading: schedule.isPending || (awaitingSession && source.isPending),
    error: outsideWindow && originalDay.isError ? originalDay.error : schedule.isError ? schedule.error : null,
    retry: () => Promise.all([schedule.refetch(), ...(outsideWindow ? [originalDay.refetch()] : [])]),
    pinned: !!pinned,
  };
}
