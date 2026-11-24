import { useId, useState, type FormEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, ShieldCheck, X } from "@/components/ui/reference-icons";
import { apiClient, type ApiComponents } from "@/api/client";
import { unwrap } from "@/api/unwrap";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { SemanticIcon } from "@/components/ui/semantic-icon";
import { InlineError } from "@/components/ui/states";
import { useDialogMotion } from "@/components/ui/use-dialog-motion";
import { LockedWorkbenchBackdrop } from "./locked-backdrop";

function safeReturnPath(from: unknown): string {
  if (typeof from !== "string") return "/focus";
  if (!from.startsWith("/") || from.startsWith("//")) return "/focus";
  if (from.startsWith("/login") || from.startsWith("/register")) return "/focus";
  return from;
}

export interface AuthModalProps {
  open: boolean;
  mode: "login" | "register";
  blocking: boolean;
  onClose?: () => void;
  onModeChange?: (mode: "login" | "register") => void;
}

export function AuthModal({ open, mode, blocking, onClose, onModeChange }: AuthModalProps) {
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

  const passwordId = useId();
  const passwordHintId = useId();
  const confirmId = useId();
  const confirmHintId = useId();

  const { present, setPanel, setScrim } = useDialogMotion({
    open,
    drawer: false,
    edge: "responsive",
    onOpenChange: (next) => {
      if (!next && !blocking) onClose?.();
    },
  });

  const passwordLongEnough = password.length >= 8;
  const passwordsMatch = confirmation.length > 0 && password === confirmation;
  const confirmMismatch = register && confirmation.length > 0 && password !== confirmation;
  const formErrored = Boolean(error);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
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
      if (!blocking && onClose) {
        onClose();
        return;
      }
      const from = (location.state as { from?: string } | null)?.from;
      navigate(safeReturnPath(from), { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }

  const title = !blocking ? "切换账户" : register ? "创建账户通行证" : "账户通行证";
  const subtitle = !blocking
    ? "当前工作台上下文已保留；按 Esc 或点击外部可随时返回原会话。"
    : register
      ? "创建账号后立即同步你的日程节律、深度专注保护与团队隐私偏好。"
      : "登录后解锁你的个人时间地图、穿戴精力曲线与隐私边界内的团队排会。";

  return (
    <DialogPrimitive.Root
      open={present}
      onOpenChange={(next) => {
        if (!next && !blocking) onClose?.();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay ref={setScrim} className="auth-scrim" />
        <DialogPrimitive.Content
          ref={setPanel}
          data-surface="modal"
          className="auth-glass-card"
          onEscapeKeyDown={(event) => {
            if (blocking) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (blocking) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (blocking) event.preventDefault();
          }}
        >
          <header className="auth-brand">
            <div className="flex items-center gap-3">
              <img src="/brand-logo.png" alt="" width={40} height={40} className="size-10 rounded-xl object-contain" />
              <div>
                <strong>时序智配</strong>
                <span>时间地图工作台</span>
              </div>
            </div>
            {!blocking && (
              <DialogPrimitive.Close
                type="button"
                className="button button-ghost button-icon auth-close"
                aria-label="取消切换账户"
              >
                <X size={18} />
              </DialogPrimitive.Close>
            )}
          </header>

          <DialogPrimitive.Title className="auth-title">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="auth-copy">
            {subtitle}
          </DialogPrimitive.Description>

          <nav className={`auth-tabs ${register ? "is-register" : ""}`} aria-label="账号操作">
            <span className="auth-tab-pill" aria-hidden="true" />
            {onModeChange ? (
              <>
                <button
                  type="button"
                  aria-pressed={!register}
                  onClick={() => {
                    setError(null);
                    onModeChange("login");
                  }}
                >
                  登录
                </button>
                <button
                  type="button"
                  aria-pressed={register}
                  onClick={() => {
                    setError(null);
                    onModeChange("register");
                  }}
                >
                  注册
                </button>
              </>
            ) : (
              <>
                <Link to="/login" state={location.state} aria-current={!register ? "page" : undefined}>
                  登录
                </Link>
                <Link to="/register" state={location.state} aria-current={register ? "page" : undefined}>
                  注册
                </Link>
              </>
            )}
          </nav>

          <form onSubmit={submit} className="form-stack">
            <fieldset disabled={pending} className="auth-fieldset">
              {register && (
                <label className="field">
                  显示名称
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={64}
                    autoComplete="nickname"
                    placeholder="你希望我们怎样称呼你"
                    aria-invalid={formErrored || undefined}
                  />
                </label>
              )}

              <label className="field">
                邮箱地址
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="name@example.com"
                  aria-invalid={formErrored || undefined}
                />
              </label>

              <div className="field">
                <div className="auth-label-row">
                  <label htmlFor={passwordId}>密码</label>
                  {password.length > 0 && (
                    <span
                      id={passwordHintId}
                      className={`auth-field-hint ${passwordLongEnough ? "is-ok" : "is-warn"}`}
                    >
                      {passwordLongEnough ? "满足 8 位安全要求" : `还差 ${8 - password.length} 位字符`}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    id={passwordId}
                    type={visible ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    maxLength={128}
                    required
                    autoComplete={register ? "new-password" : "current-password"}
                    placeholder="至少 8 位字符"
                    className="pr-12!"
                    aria-invalid={formErrored || (password.length > 0 && !passwordLongEnough) || undefined}
                    aria-describedby={password.length > 0 ? passwordHintId : undefined}
                  />
                  <button
                    className="absolute right-1 top-1 button button-ghost button-icon"
                    type="button"
                    onClick={() => setVisible((v) => !v)}
                    aria-label={visible ? "隐藏密码" : "显示密码"}
                  >
                    {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>

              {register && (
                <div className="field">
                  <div className="auth-label-row">
                    <label htmlFor={confirmId}>确认密码</label>
                    {confirmation.length > 0 && (
                      <span
                        id={confirmHintId}
                        className={`auth-field-hint ${passwordsMatch ? "is-ok" : "is-err"}`}
                      >
                        {passwordsMatch ? "两次输入一致" : "与上方密码尚未匹配"}
                      </span>
                    )}
                  </div>
                  <input
                    id={confirmId}
                    type="password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    minLength={8}
                    maxLength={128}
                    required
                    autoComplete="new-password"
                    placeholder="再次输入密码"
                    aria-invalid={formErrored || confirmMismatch || undefined}
                    aria-describedby={confirmation.length > 0 ? confirmHintId : undefined}
                  />
                </div>
              )}

              <InlineError error={error} />

              <Button
                type="submit"
                variant="secondary"
                pending={pending}
                className="w-full min-h-12 text-sm!"
                aria-label={register ? "创建账号并开始使用" : "登录并进入工作台"}
              >
                <SemanticIcon name="login" />
                {register ? "创建账号" : "登录并进入工作台"}
              </Button>
            </fieldset>
          </form>

          <footer className="auth-footer">
            <ShieldCheck size={14} aria-hidden="true" />
            <span>Argon2id 加密会话 · 生理与穿戴数据默认仅本人可见</span>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Standalone wrapper for isolated unit tests (`auth-page.test.tsx`). */
export function AuthPage({ mode }: { mode: "login" | "register" }) {
  return (
    <main className="auth-canvas">
      <LockedWorkbenchBackdrop />
      <AuthModal open mode={mode} blocking />
    </main>
  );
}
