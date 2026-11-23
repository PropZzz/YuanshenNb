import { lazy, Suspense, useEffect, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/shell/workbench-shell";
import { LoadingState } from "@/components/ui/states";
import { ToastProvider } from "@/components/ui/toast";
import { AuthPage } from "@/features/auth/auth-page";
import { RequireSession } from "@/features/auth/session";
import { resolveReferenceRoute } from "@/lib/reference-routing";
import { useAuthStore } from "@/stores/auth-store";

const FocusPage = lazy(() => import("@/features/focus/focus-page").then(m => ({ default: m.FocusPage })));
const CalendarPage = lazy(() => import("@/features/calendar/calendar-page").then(m => ({ default: m.CalendarPage })));
const TeamPage = lazy(() => import("@/features/team/team-page").then(m => ({ default: m.TeamPage })));
const EnergyPage = lazy(() => import("@/features/energy/energy-page").then(m => ({ default: m.EnergyPage })));
const SettingsPage = lazy(() => import("@/features/settings/settings-page").then(m => ({ default: m.SettingsPage })));

function ReferenceHashBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    function follow() {
      if (!window.location.hash.startsWith("#/")) return;
      const [path, query = ""] = window.location.hash.slice(1).split("?");
      navigate(resolveReferenceRoute(path, query) ?? "/focus", { replace: true });
    }
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [navigate]);
  return null;
}

function ReferenceAlias() {
  const location = useLocation();
  return <Navigate to={resolveReferenceRoute(location.pathname, location.search) ?? "/focus"} replace />;
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

function AppShellLayout() {
  return (
    <RequireSession>
      <AppShell>
        <Suspense fallback={<LoadingState label="正在载入工作视图" />}>
          <Outlet />
        </Suspense>
      </AppShell>
    </RequireSession>
  );
}

const legacyAliases = [
  "profile",
  "diagnostics",
  "integrations",
  "microtasks",
  "goals",
  "review",
  "bluetooth",
  "schedule",
  "smart-calendar",
  "micro",
  "micro-tasks",
  "emotion-energy",
  "emotion",
  "mcp",
  "settings-drawer",
  "microtask-entry",
  "microtask-entry-breakdown",
  "microtask-detail",
  "create-schedule",
  "schedule-detail",
  "urgent-task",
  "insert-urgent-task",
  "rescue-comparison",
  "urgent-rescue-comparison",
  "calendar-options",
  "calendar-import",
  "import-schedule",
];

export function App() {
  const identity = useAuthStore(state => state.user?.id ?? "anonymous");
  const queryClient = useMemo(createQueryClient, [identity]);
  useEffect(() => () => queryClient.clear(), [queryClient]);

  return (
    <QueryClientProvider key={identity} client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <ReferenceHashBridge />
          <Routes>
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/register" element={<AuthPage mode="register" />} />

            <Route element={<AppShellLayout />}>
              <Route path="/" element={<Navigate to="/focus" replace />} />
              <Route path="/focus" element={<FocusPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/team" element={<TeamPage />} />
              <Route path="/energy" element={<EnergyPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              {legacyAliases.map(path => (
                <Route key={path} path={`/${path}`} element={<ReferenceAlias />} />
              ))}
            </Route>

            <Route path="*" element={<Navigate to="/focus" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
