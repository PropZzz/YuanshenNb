import { useState, type FormEvent } from "react";
import { Eye, EyeOff, ArrowLeft, UserRound } from "@/components/ui/reference-icons";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiClient, type ApiComponents } from "@/api/client";
import { unwrap } from "@/api/unwrap";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/states";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const register = mode === "register";
  const [visible, setVisible] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState<unknown>(null);
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState(""), [name, setName] = useState("");
  const navigate = useNavigate(), location = useLocation();
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null);
    if (register && password !== confirmation) { setError(new Error("两次输入的密码不一致")); return; }
    setPending(true);
    try {
      const credentials: ApiComponents["LoginRequest"] = { email: email.trim(), password, deviceName: "Web 工作台" };
      const tokens = register ? unwrap(await apiClient.POST("/api/v1/auth/register", { body: { ...credentials, displayName: name.trim(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } })) : unwrap(await apiClient.POST("/api/v1/auth/login", { body: credentials }));
      useAuthStore.getState().setSession(tokens.accessToken, tokens.user);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from?.startsWith("/") && !from.startsWith("//") ? from : "/focus", { replace: true });
    } catch (e) { setError(e); } finally { setPending(false); }
  }
  return <main className="auth-canvas"><section className="auth-panel" aria-labelledby="auth-title">
    <header className="auth-brand"><div className="flex items-center gap-3"><img src="/brand-logo.png" alt="" className="size-10 object-contain" /><div><strong>时序智配</strong><span>时间地图工作台</span></div></div><button type="button" className="button button-outline auth-back" aria-label="返回上一页" onClick={() => window.history.state?.idx > 0 ? navigate(-1) : navigate("/focus")}><ArrowLeft size={24}/></button></header>
    <h1 id="auth-title">账户通行证</h1><p className="auth-copy">{register ? "创建账号，开始同步日程与个人偏好。" : "登录后同步日程与个人偏好。"}</p>
    <nav className="auth-tabs" aria-label="账号操作"><Link to="/login" aria-current={!register ? "page" : undefined}>登录</Link><Link to="/register" aria-current={register ? "page" : undefined}>注册</Link></nav>
    <form onSubmit={submit} className="form-stack">
      {register && <label className="field">显示名称<input value={name} onChange={e => setName(e.target.value)} required maxLength={64} autoComplete="nickname" placeholder="你希望我们怎样称呼你" /></label>}
      <label className="field">邮箱地址<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="name@example.com" /></label>
      <div className="field"><label htmlFor="auth-password">密码</label><div className="relative"><input id="auth-password" type={visible ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} minLength={8} maxLength={128} required autoComplete={register ? "new-password" : "current-password"} placeholder="至少 8 位字符" className="pr-12!" /><button className="absolute right-1 top-1 button button-ghost button-icon" type="button" onClick={() => setVisible(v => !v)} aria-label={visible ? "隐藏密码" : "显示密码"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>{register && <small>请使用独立的长密码，避免与其他账号重复。</small>}</div>
      {register && <label className="field">确认密码<input type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} minLength={8} maxLength={128} required autoComplete="new-password" /></label>}
      <InlineError error={error} />
      <Button type="submit" variant="secondary" pending={pending} className="w-full min-h-12 text-sm!" aria-label={register ? "创建账号并开始使用" : "登录并进入工作台"}><span className="material-symbols-outlined" aria-hidden="true">login</span>{register ? "创建账号" : "登录"}</Button>
    </form>
    <div className="auth-divider">或</div>
    <button className="auth-guest" type="button" disabled aria-describedby="guest-unavailable"><UserRound size={20}/>以游客身份继续</button>
    <p className="auth-guest-note" id="guest-unavailable">当前版本需登录后访问工作台，暂不支持游客会话。</p>
  </section></main>;
}
