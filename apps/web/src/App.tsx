import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { domMax, LazyMotion, MotionConfig } from "motion/react";
import { useAuthStore } from "@/stores/auth-store";
import { AppShell } from "@/components/shell/workbench-shell";
import { AuthModal } from "@/features/auth/auth-page";
import { LockedWorkbenchBackdrop } from "@/features/auth/locked-backdrop";
import { RequireSession } from "@/features/auth/session";
import { AppErrorBoundary } from "@/components/ui/error-boundary";
import { LoadingState } from "@/components/ui/states";
import { resolveReferenceRoute } from "@/lib/reference-routing";
import { Drawer } from "@/components/ui/drawer";
import { ToastProvider } from "@/components/ui/toast";

const FocusPage = lazy(() => import("@/features/focus/focus-page").then(module => ({ default: module.FocusPage })));
const TeamPage = lazy(() => import("@/features/team/team-page").then(module => ({ default: module.TeamPage })));
const EnergyPage = lazy(() => import("@/features/energy/energy-page").then(module => ({ default: module.EnergyPage })));
const SettingsPage = lazy(() => import("@/features/settings/settings-page").then(module => ({ default: module.SettingsPage })));
const CalendarPage = lazy(() => import("@/features/calendar/calendar-page").then(module => ({ default: module.CalendarPage })));
const ProfilePage = lazy(() => import("@/features/settings/profile-page").then(module => ({default:module.ProfilePage})));
const MicrotasksPage = lazy(() => import("@/features/legacy/legacy-pages").then(module => ({default:module.MicrotasksPage})));
const GoalsPage = lazy(() => import("@/features/legacy/legacy-pages").then(module => ({default:module.GoalsPage})));
const ReviewPage = lazy(() => import("@/features/legacy/legacy-pages").then(module => ({default:module.ReviewPage})));
const IntegrationsPage = lazy(() => import("@/features/legacy/legacy-pages").then(module => ({default:module.IntegrationsPage})));
const DiagnosticsPage = lazy(() => import("@/features/legacy/legacy-pages").then(module => ({default:module.DiagnosticsPage})));
const BluetoothPage = lazy(() => import("@/features/legacy/legacy-pages").then(module => ({default:module.BluetoothPage})));

function ReferenceHashBridge(){const navigate=useNavigate();useEffect(()=>{function follow(){if(!window.location.hash.startsWith("#/"))return;const [path,query=""]=window.location.hash.slice(1).split("?");navigate(resolveReferenceRoute(path,query)??"/focus",{replace:true});}follow();window.addEventListener("hashchange",follow);return()=>window.removeEventListener("hashchange",follow);},[navigate]);return null;}
function ReferenceAlias(){const location=useLocation();return <Navigate to={resolveReferenceRoute(location.pathname,location.search)??"/focus"} replace/>;}
function IntegrationsSurface(){const navigate=useNavigate(),[open,setOpen]=useState(true);return <><CalendarPage/><Drawer open={open} onOpenChange={setOpen} onAfterClose={()=>navigate("/calendar",{replace:true})} title="跨平台接入与文本解析" description="MCP / 外部日历与协同消息"><Suspense fallback={<LoadingState/>}><IntegrationsPage embedded/></Suspense></Drawer></>;}

function createQueryClient() { return new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
}); }

function AppShellLayout() {
  return (
    <RequireSession><AppShell>
      <Suspense fallback={<LoadingState label="正在载入工作视图" />}><Outlet /></Suspense>
    </AppShell></RequireSession>
  );
}

function AuthRouteSurface({ mode }: { mode: "login" | "register" }) {
  const status = useAuthStore(state => state.status);
  const location = useLocation();
  const navigate = useNavigate();
  const from = (location.state as { from?: string } | null)?.from;
  const safeFrom =
    typeof from === "string" && from.startsWith("/") && !from.startsWith("//") && !from.startsWith("/login") && !from.startsWith("/register")
      ? from
      : "/focus";
  return (
    <>
      <AppShell previewLocked>
        <LockedWorkbenchBackdrop />
      </AppShell>
      <AuthModal
        open
        mode={mode}
        blocking={status !== "authenticated"}
        onClose={() => navigate(safeFrom, { replace: true })}
      />
    </>
  );
}

export function App() {
  const identity = useAuthStore(state => state.user?.id ?? "anonymous");
  const queryClient = useMemo(createQueryClient, [identity]);
  useEffect(() => () => queryClient.clear(), [queryClient]);
  return (
    <QueryClientProvider key={identity} client={queryClient}>
      <MotionConfig reducedMotion="user" transition={{ type: "spring", bounce: 0, visualDuration: 0.26 }}>
      <LazyMotion features={domMax}>
      <ToastProvider>
        <BrowserRouter>
        <ReferenceHashBridge/>
        <AppErrorBoundary>
        <Routes>
          <Route
            path="/login"
            element={
              <AuthRouteSurface mode="login" />
            }
          />
          <Route
            path="/register"
            element={
              <AuthRouteSurface mode="register" />
            }
          />

          <Route element={<AppShellLayout />}>
            <Route path="/" element={<Navigate to="/focus" replace />} />
            <Route
              path="/focus"
              element={
                <FocusPage />
              }
            />
            <Route
              path="/calendar"
              element={
                <CalendarPage />
              }
            />
            <Route
              path="/team"
              element={
                <TeamPage />
              }
            />
            <Route
              path="/energy"
              element={
                <EnergyPage />
              }
            />
            <Route
              path="/settings"
              element={
                <SettingsPage />
              }
            />
            <Route path="/profile" element={<ProfilePage/>}/>
            <Route path="/microtasks" element={<MicrotasksPage/>}/>
            <Route path="/goals" element={<GoalsPage/>}/>
            <Route path="/review" element={<ReviewPage/>}/>
            <Route path="/integrations" element={<IntegrationsSurface/>}/>
            <Route path="/diagnostics" element={<DiagnosticsPage/>}/>
            <Route path="/bluetooth" element={<BluetoothPage/>}/>
            {["schedule","smart-calendar","micro","micro-tasks","emotion-energy","emotion","mcp","settings-drawer","microtask-entry","microtask-entry-breakdown","microtask-detail","create-schedule","schedule-detail","urgent-task","insert-urgent-task","rescue-comparison","urgent-rescue-comparison","calendar-options","calendar-import","import-schedule"].map(path=><Route key={path} path={`/${path}`} element={<ReferenceAlias/>}/>)}
          </Route>

          <Route path="*" element={<Navigate to="/focus" replace />} />
          </Routes>
        </AppErrorBoundary>
        </BrowserRouter>
      </ToastProvider>
      </LazyMotion>
      </MotionConfig>
    </QueryClientProvider>
  );
}

export default App;
