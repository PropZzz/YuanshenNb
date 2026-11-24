import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { unwrap } from "@/api/unwrap";
import { queryKeys } from "@/api/query-keys";
import { useAuthStore } from "@/stores/auth-store";
export function useEnergy(day: string) {
  const authenticated = useAuthStore(s => s.status === "authenticated");
  return useQuery({ queryKey: queryKeys.energy.today(day), queryFn: async () => unwrap(await apiClient.GET("/api/v1/energy/today", { params: { query: { day } } })), staleTime: 30_000, enabled: authenticated && Boolean(day) });
}
export function useEnergyProfile() {
  const authenticated = useAuthStore(s => s.status === "authenticated");
  return useQuery({ queryKey: queryKeys.energy.profile, queryFn: async () => unwrap(await apiClient.GET("/api/v1/energy/profile")), staleTime: 60_000, enabled: authenticated });
}
export const freshnessLabels = { live_wearable: "穿戴实时", recent_wearable: "最近同步", replay_demo: "回放测试源", baseline_only: "节律基线估算" } as const;
export const tierLabels = { peak: "精力峰值", steady: "平稳专注", strained: "精力偏低", depleted: "建议恢复" } as const;
