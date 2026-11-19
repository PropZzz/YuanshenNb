import { create } from "zustand";
import type { components } from "@/api/schema";

export type UserProfile = components["schemas"]["UserProfile"];
export type ThemeMode = components["schemas"]["ThemeMode"];
export type AuthStatus = "unknown" | "authenticated" | "unauthenticated";

interface AuthState {
  status: AuthStatus;
  accessToken: string | null;
  user: UserProfile | null;
  themeMode: ThemeMode;
  setSession: (accessToken: string, user: UserProfile) => void;
  clearSession: () => void;
  markUnauthenticated: () => void;
  setThemeMode: (mode: ThemeMode) => void;
}

export function applyThemeToDom(mode: ThemeMode): void {
  if (typeof document === "undefined") {
    return;
  }
  const prefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = mode === "dark" || (mode === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", isDark);
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "unknown",
  accessToken: null,
  user: null,
  themeMode: "system",
  setSession: (accessToken, user) => {
    applyThemeToDom(user.themeMode);
    set({
      status: "authenticated",
      accessToken,
      user,
      themeMode: user.themeMode,
    });
  },
  clearSession: () =>
    set({
      status: "unauthenticated",
      accessToken: null,
      user: null,
    }),
  markUnauthenticated: () =>
    set({
      status: "unauthenticated",
      accessToken: null,
      user: null,
    }),
  setThemeMode: (themeMode) => {
    applyThemeToDom(themeMode);
    set((state) => ({
      themeMode,
      user: state.user ? { ...state.user, themeMode } : null,
    }));
  },
}));

/**
 * 同步首屏主题并监听系统深/浅色偏好变化，返回清理函数。
 */
export function initThemeListener(): () => void {
  applyThemeToDom(useAuthStore.getState().themeMode);

  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    const mode = useAuthStore.getState().themeMode;
    if (mode === "system") {
      applyThemeToDom("system");
    }
  };

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }
  mediaQuery.addListener(onChange);
  return () => mediaQuery.removeListener(onChange);
}
