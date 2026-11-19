import { beforeEach, describe, expect, it } from "vitest";
import { apiClient } from "@/api/client";
import { useAuthStore, type UserProfile } from "@/stores/auth-store";

describe("web starter auth store & openapi client", () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      themeMode: "system",
    });
    document.documentElement.classList.remove("dark");
  });

  it("stores accessToken and syncs dark theme class on setSession", () => {
    const mockUser: UserProfile = {
      id: "11111111-1111-1111-1111-111111111111",
      email: "dev@shixu.app",
      displayName: "测试成员",
      timezone: "Asia/Shanghai",
      themeMode: "dark",
      createdAt: "2026-11-19T00:00:00Z",
      updatedAt: "2026-11-19T00:00:00Z",
    };

    useAuthStore.getState().setSession("token-123", mockUser);

    expect(useAuthStore.getState().accessToken).toBe("token-123");
    expect(useAuthStore.getState().themeMode).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    useAuthStore.getState().clearSession();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("exposes typed openapi-fetch client", () => {
    expect(typeof apiClient.GET).toBe("function");
    expect(typeof apiClient.POST).toBe("function");
  });
});
