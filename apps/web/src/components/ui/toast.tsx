import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "@/components/ui/reference-icons";
import { cn } from "@/lib/utils";

export type ToastTone = "info" | "success" | "warning" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
  action?: ToastAction;
}

interface ToastRecord extends ToastInput {
  id: string;
  tone: ToastTone;
}

interface ToastContextValue {
  push: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  push: () => "",
  dismiss: () => {},
});

const toneIcons: Record<ToastTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
};

const toneStyles: Record<ToastTone, string> = {
  info: "border-outline-variant bg-surface-container-lowest text-on-surface",
  success: "border-energy-peak/30 bg-surface-container-lowest text-on-surface",
  warning: "border-energy-strained/40 bg-surface-container-lowest text-on-surface",
  error: "border-error/40 bg-error-container text-on-error-container",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts(current => current.filter(item => item.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id =
        typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const tone = input.tone ?? "info";
      setToasts(current => [...current.slice(-3), { ...input, id, tone }]);
      const duration = input.durationMs ?? (input.action ? 8000 : 4500);
      if (duration > 0) {
        const timer = window.setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const currentTimers = timers.current;
    return () => {
      currentTimers.forEach(timer => window.clearTimeout(timer));
      currentTimers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ push, dismiss }}>
      {children}
      {toasts.length > 0 && (
        <div
          className="fixed bottom-5 right-5 z-90 flex w-[min(390px,calc(100vw-24px))] flex-col gap-2.5 pointer-events-none"
          aria-live="polite"
          aria-label="操作提示"
        >
          {toasts.map(item => {
            const Icon = toneIcons[item.tone];
            return (
              <div
                key={item.id}
                role={item.tone === "error" ? "alert" : "status"}
                className={cn(
                  "pointer-events-auto flex items-start gap-3 rounded-xl border p-3.5 shadow-lg transition-all",
                  toneStyles[item.tone],
                )}
              >
                <Icon
                  size={18}
                  className={cn(
                    "mt-0.5 shrink-0",
                    item.tone === "success" && "text-energy-peak",
                    item.tone === "warning" && "text-energy-strained",
                    item.tone === "info" && "text-secondary",
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold leading-snug">{item.title}</p>
                  {item.description && (
                    <p className="mt-1 text-xs opacity-85 leading-relaxed">{item.description}</p>
                  )}
                  {item.action && (
                    <button
                      type="button"
                      className="mt-2 inline-flex items-center rounded-lg bg-secondary px-2.5 py-1 text-xs font-semibold text-on-secondary hover:brightness-110"
                      onClick={() => {
                        void item.action?.onClick();
                        dismiss(item.id);
                      }}
                    >
                      {item.action.label}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="关闭提示"
                  onClick={() => dismiss(item.id)}
                  className="rounded-md p-1 text-on-surface-variant hover:bg-surface-container"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
