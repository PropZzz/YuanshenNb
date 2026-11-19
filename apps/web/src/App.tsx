import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "@/components/shell/AppShell";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

interface ViewPlaceholderProps {
  route: string;
  title: string;
  description: string;
}

function ViewStarter({ route, title, description }: ViewPlaceholderProps) {
  return (
    <section
      className="rounded-2xl bg-surface-container-lowest border p-6 space-y-3"
      style={{ borderColor: "var(--rc-line)", boxShadow: "var(--rc-shadow)" }}
    >
      <div className="inline-flex items-center rounded-full bg-surface-container-low px-3 py-1 text-xs font-medium text-on-surface-variant">
        {route}
      </div>
      <h1 className="font-headline text-2xl font-semibold text-primary">{title}</h1>
      <p className="text-sm text-on-surface-variant leading-relaxed">{description}</p>
    </section>
  );
}

function AuthLayout({ title, description }: { title: string; description: string }) {
  return (
    <div className="min-h-screen bg-surface text-on-surface flex items-center justify-center p-6">
      <div
        className="w-full max-w-md rounded-2xl bg-surface-container-lowest border p-7 space-y-4"
        style={{ borderColor: "var(--rc-line)", boxShadow: "var(--rc-shadow)" }}
      >
        <div className="flex items-center gap-3">
          <img src="/brand-logo.png" alt="时序智配" className="h-9 w-9 rounded-lg object-contain" />
          <div>
            <h1 className="font-headline text-xl font-semibold text-primary">{title}</h1>
            <p className="text-xs text-on-surface-variant">Temporal Intelligence Scheduler V2</p>
          </div>
        </div>
        <p className="text-sm text-on-surface-variant leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function AppShellLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={
              <AuthLayout
                title="登录时序智配"
                description="P3 独立认证流入口（无侧栏外壳）。接入 /api/v1/auth/login 与静默 Cookie 刷新后在此渲染登录表单。"
              />
            }
          />
          <Route
            path="/register"
            element={
              <AuthLayout
                title="创建账号"
                description="P3 独立注册流入口（无侧栏外壳）。接入 /api/v1/auth/register 并初始化个人精力节律基线。"
              />
            }
          />

          <Route element={<AppShellLayout />}>
            <Route path="/" element={<Navigate to="/focus" replace />} />
            <Route
              path="/focus"
              element={
                <ViewStarter
                  route="/focus"
                  title="今日专注与精力"
                  description="P3 视图起步骨架已就绪。接入 /api/v1/energy/today 与 /api/v1/schedule/items 后，在此渲染专注计时环与今日精力缓冲。"
                />
              }
            />
            <Route
              path="/calendar"
              element={
                <ViewStarter
                  route="/calendar"
                  title="智能日历与救援"
                  description="P3 视图起步骨架已就绪。接入时间地图网格、精力色带与三策略突发救援对比抽屉。"
                />
              }
            />
            <Route
              path="/team"
              element={
                <ViewStarter
                  route="/team"
                  title="团队协同排会"
                  description="P3 视图起步骨架已就绪。仅渲染经服务端脱敏投影后的成员状态与黄金窗口推荐。"
                />
              }
            />
            <Route
              path="/energy"
              element={
                <ViewStarter
                  route="/energy"
                  title="穿戴精力洞察"
                  description="P3 视图起步骨架已就绪。接入穿戴数据新鲜度徽标、本地自然日节律预测曲线与四因子可解释拆解。"
                />
              }
            />
            <Route
              path="/settings"
              element={
                <ViewStarter
                  route="/settings"
                  title="账号与隐私"
                  description="P3 视图起步骨架已就绪。管理账号偏好、工作时间窗、chronotype 与团队 privacy_level 隐私颗粒度。"
                />
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/focus" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
