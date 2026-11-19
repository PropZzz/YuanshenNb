import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { apiClient } from "@/api/client";
import { ApiError } from "@/api/errors";
import { unwrap } from "@/api/unwrap";
import { useAuthStore } from "@/stores/auth-store";
import { ErrorState, LoadingState } from "@/components/ui/states";
let bootstrap: Promise<void> | null = null;
export function restoreSession(): Promise<void> {
  if (!bootstrap) bootstrap = (async () => {
    try {
      const tokens = unwrap(await apiClient.POST("/api/v1/auth/refresh", { body: {} }));
      useAuthStore.getState().setSession(tokens.accessToken, tokens.user);
    } catch (error) {
      if (error instanceof ApiError && [401,403].includes(error.status)) useAuthStore.getState().markUnauthenticated();
      else throw error;
    } finally { bootstrap = null; }
  })();
  return bootstrap;
}
export function RequireSession({ children }: { children: ReactNode }) {
  const status = useAuthStore(s => s.status);
  const location = useLocation();
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { if (status === "unknown") { let active = true; restoreSession().catch(e => { if(active) setError(e); }); return () => { active = false; }; } }, [status, attempt]);
  if (status === "unknown") return <div className="min-h-screen grid place-items-center p-6"><div className="surface-card w-full max-w-lg">{error ? <ErrorState error={error} retry={() => { setError(null); setAttempt(a => a + 1); }} /> : <LoadingState label="正在恢复安全会话" />}</div></div>;
  if (status !== "authenticated") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

