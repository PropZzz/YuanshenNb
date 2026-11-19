import { create } from "zustand";
import type { components } from "@/api/schema";

export type UserProfile = components["schemas"]["UserProfile"];
export type ThemeMode = UserProfile["themeMode"];

interface AuthState {
  accessToken: string | null;
  user: UserProfile | null;
  themeMode: ThemeMode;
  setSession: (accessToken: string, user: UserProfile) => void;
  clearSession: () => void;
  setThemeMode: (mode: ThemeMode) => void;
}

function applyThemeToDom(mode: ThemeMode) {
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
  accessToken: null,
  user: null,
  themeMode: "system",
  setSession: (accessToken, user) => {
    applyThemeToDom(user.themeMode);
    set({ accessToken, user, themeMode: user.themeMode });
  },
  clearSession: () => set({ accessToken: null, user: null }),
  setThemeMode: (themeMode) => {
    applyThemeToDom(themeMode);
    set((state) => ({
      themeMode,
      user: state.user ? { ...state.user, themeMode } : null,
    }));
  },
}));
