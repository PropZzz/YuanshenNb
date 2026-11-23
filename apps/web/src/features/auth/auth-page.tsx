import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiClient, type ApiComponents } from "@/api/client";
import { unwrap } from "@/api/unwrap";
import { Button } from "@/components/ui/button";
import {
  Activity,
  ArrowLeft,
  Eye,
  EyeOff,
  LogIn,
  ShieldCheck,
  Sparkles,
  Zap,
} from "@/components/ui/reference-icons";
import { InlineError } from "@/components/ui/states";
import { useAuthStore } from "@/stores/auth-store";

const capabilities = [
  {
    icon: Activity,
    title: "穿戴节律感知",
    description: "汇聚睡眠分期、HRV 与静息心率，生成可解释的 24 小时认知精力曲线。",
  },
  {
    icon: Zap,
    title: "柔性三方案救援",
    description: "突发插单或连续疲劳时对比三种重排代价，由你确认落库并支持一键撤销。",
  },
  {
    icon: ShieldCheck,
    title: "隐私边界协同排会",
    description: "团队仅投影脱敏后的忙闲与精力档位，守住深度心流，绝不泄露原始生理数据。",
  },
];

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const register = mode === "register";
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [name, setName] = useState("");
  const navigate = useNavigate();
  const location = useLocation();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (register && password !== confirmation) {
      setError(new Error("两次输入的密码不一致"));
      return;
    }
    setPending(true);
    try {
      const credentials: ApiComponents["LoginRequest"] = {
        email: email.trim(),
        password,
        deviceName: "Web 工作台",
      };
      const tokens = register
        ? unwrap(
            await apiClient.POST("/api/v1/auth/register", {
              body: {
                ...credentials,
                displayName: name.trim(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              },
            }),
          )
        : unwrap(await apiClient.POST("/api/v1/auth/login", { body: credentials }));
      useAuthStore.getState().setSession(tokens.accessToken, tokens.user);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from?.startsWith("/") && !from.startsWith("//") ? from : "/focus", { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-canvas">
      <div className="auth-split">
        <aside className="auth-showcase" aria-label="产品核心能力">
          <div className="auth-showcase-brand">
            <img src="/brand-logo.png" alt="时序智配标志" />
            <div>
              <strong>时序智配</strong>
              <span>Temporal Intelligence Scheduler</span>
            </div>
          </div>

          <div className="auth-showcase-copy">
            <span className="auth-showcase-pill">
              <Sparkles size={13} aria-hidden="true" /> 个人精力护盾 × 团队隐私排会
            </span>
            <h2>懂你身体节律的时间地图工作台</h2>
            <p>
              打破只看日历空白填格子的盲区，把生理恢复状态与团队协作窗口收口到同一个可解释工作台。
            </p>
          </div>

          <div className="auth-capability-list">
            {capabilities.map(({ icon: Icon, title, description }) => (
              <article key={title} className="auth-capability-card">
                <span className="auth-capability-icon">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </article>
            ))}
          </div>
        </aside>

        <section className="auth-panel" aria-labelledby="auth-title">
          <header className="auth-brand">
            <div className="flex items-center gap-3 lg:hidden">
              <img src="/brand-logo.png" alt="" className="size-9 object-contain" />
              <div>
                <strong>时序智配</strong>
                <span>时间地图工作台</span>
              </div>
            </div>
            <div className="hidden lg:block">
              <p className="eyebrow">Account Passport</p>
            </div>
            <button
              type="button"
              className="button button-outline auth-back"
              aria-label="返回上一页"
              onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate("/focus"))}
            >
              <ArrowLeft size={18} />
            </button>
          </header>

          <h1 id="auth-title">账户通行证</h1>
          <p className="auth-copy">
            {register ? "创建账户，开始同步日程、节律配置与团队协作。" : "登录你的工作台账户，同步日程与生理节律。"}
          </p>

          <nav className="auth-tabs" aria-label="账号操作">
            <Link to="/login" aria-current={!register ? "page" : undefined}>
              登录
            </Link>
            <Link to="/register" aria-current={register ? "page" : undefined}>
              注册
            </Link>
          </nav>

          <form onSubmit={submit} className="form-stack">
            {register && (
              <label className="field">
                显示名称
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  maxLength={64}
                  autoComplete="nickname"
                  placeholder="你希望我们怎样称呼你"
                />
              </label>
            )}
            <label className="field">
              邮箱地址
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="name@example.com"
              />
            </label>
            <div className="field">
              <label htmlFor="auth-password">密码</label>
              <div className="relative">
                <input
                  id="auth-password"
                  type={visible ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  minLength={8}
                  maxLength={128}
                  required
                  autoComplete={register ? "new-password" : "current-password"}
                  placeholder="至少 8 位字符"
                  className="pr-12!"
                />
                <button
                  className="absolute right-1.5 top-1.5 button button-ghost button-icon"
                  type="button"
                  onClick={() => setVisible(v => !v)}
                  aria-label={visible ? "隐藏密码" : "显示密码"}
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {register && <small>请使用独立的长密码，避免与其他账号重复。</small>}
            </div>
            {register && (
              <label className="field">
                确认密码
                <input
                  type="password"
                  value={confirmation}
                  onChange={event => setConfirmation(event.target.value)}
                  minLength={8}
                  maxLength={128}
                  required
                  autoComplete="new-password"
                />
              </label>
            )}
            <InlineError error={error} />
            <Button
              type="submit"
              variant="secondary"
              pending={pending}
              className="w-full min-h-12 text-sm!"
              aria-label={register ? "创建账号并开始使用" : "登录并进入工作台"}
            >
              <LogIn size={16} aria-hidden="true" />
              {register ? "创建账号" : "登录"}
            </Button>
          </form>

          <div className="auth-security">
            <ShieldCheck size={15} aria-hidden="true" />
            <span>Web 端采用 HttpOnly Refresh Cookie 与内存级访问令牌保护会话安全</span>
          </div>
        </section>
      </div>
    </main>
  );
}
