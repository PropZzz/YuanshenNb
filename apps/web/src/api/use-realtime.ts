import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient, type ApiComponents } from "./client";
import { unwrap } from "./unwrap";
import { ShixuWsClient, type WsConnectionState, type WsEvent } from "./ws";
import { queryKeys } from "./query-keys";

export interface RealtimeFeedItem {
  id: string;
  type: WsEvent["type"];
  occurredAt: string;
  title: string;
  detail: string;
  to: string;
  tone: "info" | "warning" | "success";
  read: boolean;
}

const reasonLabels: Record<ApiComponents["ScheduleUpdateReason"], string> = {
  item_created: "新增了日程安排",
  item_updated: "更新了日程安排",
  item_cancelled: "取消了日程安排",
  rescue_applied: "已应用日程救援方案",
  rescue_reverted: "已撤销日程救援方案",
  team_meeting_synced: "团队会议已同步至个人日历",
};

function summarizeEvent(event: WsEvent): RealtimeFeedItem | null {
  switch (event.type) {
    case "energy.updated":
      return {
        id: event.eventId,
        type: event.type,
        occurredAt: event.occurredAt,
        title: `精力指数更新为 ${event.payload.score} 分`,
        detail: `${event.payload.localDay} · 已同步最新穿戴与节律状态`,
        to: "/energy",
        tone: "info",
        read: false,
      };
    case "energy.overload_alert":
      return {
        id: event.eventId,
        type: event.type,
        occurredAt: event.occurredAt,
        title: "精力过载预警",
        detail: event.payload.message,
        to: `/calendar?rescue=1&trigger=${event.payload.triggerReason}`,
        tone: "warning",
        read: false,
      };
    case "schedule.updated":
      return {
        id: event.eventId,
        type: event.type,
        occurredAt: event.occurredAt,
        title: reasonLabels[event.payload.reason] ?? "日程已更新",
        detail: `${event.payload.baselineLocalDay} · 涉及 ${event.payload.itemIds.length} 项安排`,
        to: `/calendar?day=${event.payload.baselineLocalDay}`,
        tone: "info",
        read: false,
      };
    case "workspace.meeting_confirmed":
      return {
        id: event.eventId,
        type: event.type,
        occurredAt: event.occurredAt,
        title: `新协同会议：${event.payload.title}`,
        detail: "已落库到时间地图，请前往确认是否接受邀请",
        to: "/team",
        tone: "success",
        read: false,
      };
    case "workspace.meeting_cancelled":
      return {
        id: event.eventId,
        type: event.type,
        occurredAt: event.occurredAt,
        title: `会议已取消：${event.payload.title}`,
        detail: event.payload.reason || "关联的日程占用已同步释放",
        to: "/team",
        tone: "warning",
        read: false,
      };
    case "workspace.meeting_responded":
      return {
        id: event.eventId,
        type: event.type,
        occurredAt: event.occurredAt,
        title: `${event.payload.displayName}${event.payload.responseStatus === "accepted" ? "接受了" : "拒绝了"}会议邀请`,
        detail: "团队日程可用性已实时刷新",
        to: "/team",
        tone: "info",
        read: false,
      };
    case "workspace.availability_changed":
      return null;
  }
}

export function useRealtime() {
  const cache = useQueryClient();
  const [state, setState] = useState<WsConnectionState>("connecting");
  const [alert, setAlert] = useState<ApiComponents["WsEnergyOverloadAlertPayload"] | null>(null);
  const [events, setEvents] = useState<RealtimeFeedItem[]>([]);

  useEffect(() => {
    const socket = new ShixuWsClient({
      getTicket: async () => unwrap(await apiClient.POST("/api/v1/auth/ws-ticket")).ticket,
      onStateChange: setState,
      onReconnected: () => {
        void cache.invalidateQueries();
      },
      onEvent: event => {
        if (event.type === "energy.updated") {
          void cache.invalidateQueries({ queryKey: queryKeys.energy.todayRoot });
        }
        if (event.type === "energy.overload_alert") {
          setAlert(event.payload);
          void cache.invalidateQueries({ queryKey: queryKeys.energy.todayRoot });
        }
        if (event.type === "schedule.updated" || event.type.startsWith("workspace.meeting_")) {
          void cache.invalidateQueries({ queryKey: queryKeys.schedule.itemsRoot });
          void cache.invalidateQueries({ queryKey: queryKeys.schedule.rescueHistory });
          void cache.invalidateQueries({ queryKey: queryKeys.energy.todayRoot });
        }
        if ("workspaceId" in event.payload) {
          const id = event.payload.workspaceId;
          void cache.invalidateQueries({ queryKey: queryKeys.workspaces.availabilityRoot(id) });
          void cache.invalidateQueries({ queryKey: queryKeys.workspaces.meetings(id) });
          void cache.invalidateQueries({ queryKey: queryKeys.workspaces.all });
        }
        const summary = summarizeEvent(event);
        if (summary) {
          setEvents(current => [summary, ...current.filter(item => item.id !== summary.id)].slice(0, 30));
        }
      },
    });
    socket.connect();
    return () => socket.disconnect();
  }, [cache]);

  const markAllRead = useCallback(() => {
    setEvents(current => current.map(item => (item.read ? item : { ...item, read: true })));
  }, []);

  const clearFeed = useCallback(() => {
    setEvents([]);
  }, []);

  const unreadCount = events.filter(item => !item.read).length;

  return {
    state,
    alert,
    events,
    unreadCount,
    dismissAlert: () => setAlert(null),
    markAllRead,
    clearFeed,
  };
}
