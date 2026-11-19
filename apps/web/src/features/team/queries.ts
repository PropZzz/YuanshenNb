import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { unwrap } from "@/api/unwrap";
import { queryKeys } from "@/api/query-keys";
export function useWorkspaces() { return useQuery({ queryKey: queryKeys.workspaces.all, queryFn: async () => unwrap(await apiClient.GET("/api/v1/workspaces")) }); }
export function useMembers(id: string) { return useQuery({ queryKey: queryKeys.workspaces.members(id), queryFn: async () => unwrap(await apiClient.GET("/api/v1/workspaces/{id}/members", {params:{path:{id}}})), enabled: !!id }); }
export function useMeetings(id: string) { return useQuery({ queryKey: queryKeys.workspaces.meetings(id), queryFn: async () => unwrap(await apiClient.GET("/api/v1/workspaces/{id}/meetings",{params:{path:{id}}})), enabled: !!id }); }
export function useAvailability(id: string, from: string, to: string) { return useQuery({ queryKey: queryKeys.workspaces.availability(id,from,to), queryFn: async () => unwrap(await apiClient.GET("/api/v1/workspaces/{id}/availability", {params:{path:{id},query:{from,to}}})), enabled: !!id, staleTime:15_000 }); }
export const privacyLabels = { busy_only: "仅忙闲", energy_tier: "忙闲与精力等级", full_title: "共享日程标题" } as const;
