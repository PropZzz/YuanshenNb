import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
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

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppShell>
          <Routes>
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
                  description="P3 视图起步骨架已就绪。仅渲染经服务端脱敏投影后的成员状态与 Top 3 黄金窗口推荐。"
                />
              }
            />
            <Route
              path="/energy"
              element={
                <ViewStarter
                  route="/energy"
                  title="穿戴精力洞察"
                  description="P3 视图起步骨架已就绪。接入穿戴数据新鲜度徽标、24h 节律预测曲线与四因子可解释拆解。"
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
            <Route path="*" element={<Navigate to="/focus" replace />} />
          </Routes>
        </AppShell>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
