import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { unwrap } from "@/api/unwrap";
import { queryKeys } from "@/api/query-keys";
export function useSchedules(from: string, to: string) { return useQuery({ queryKey: queryKeys.schedule.items(from,to), queryFn: async () => unwrap(await apiClient.GET("/api/v1/schedule/items", { params: { query: { from, to } } })), staleTime: 15_000 }); }
export function useRescueHistory() { return useQuery({ queryKey: queryKeys.schedule.rescueHistory, queryFn: async () => unwrap(await apiClient.GET("/api/v1/schedule/rescue/history", { params: { query: { limit: 10 } } })), staleTime: 15_000 }); }
export function useInvalidateSchedule() { const cache = useQueryClient(); return () => Promise.all([cache.invalidateQueries({queryKey:queryKeys.schedule.itemsRoot}),cache.invalidateQueries({queryKey:queryKeys.schedule.rescueHistory}),cache.invalidateQueries({queryKey:queryKeys.energy.todayRoot})]); }
export const categoryLabels = { deep_work: "深度工作", meeting: "协同会议", recovery: "恢复缓冲", routine: "日常事务", urgent: "紧急任务" } as const;
export const loadLabels = { high: "高认知负荷", medium: "中等负荷", low: "轻量任务" } as const;
export const strategyLabels = { protect_deadline: "优先保护截止期", protect_recovery: "优先保留恢复缓冲", minimize_changes: "最小化日程扰动" } as const;
