import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient, createApiClient } from "@/api/client";
import { parseProblemDetail } from "@/api/errors";
import { parseWsEvent } from "@/api/ws";
import { initThemeListener, useAuthStore, type UserProfile } from "@/stores/auth-store";

const MOCK_USER: UserProfile = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "dev@shixu.app",
  displayName: "测试成员",
  timezone: "Asia/Shanghai",
  themeMode: "dark",
  createdAt: "2026-11-19T00:00:00Z",
  updatedAt: "2026-11-19T00:00:00Z",
};

function jsonResponse(status: number, body: unknown, contentType = "application/json"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": contentType },
  });
}

describe("web starter auth store & openapi client", () => {
  it("preserves the session during a temporary refresh service outage", async () => {
    useAuthStore.getState().setSession("expired-but-recoverable", MOCK_USER);
    const expired=vi.fn();
    const client=createApiClient({baseUrl:"http://localhost:8080",onSessionExpired:expired,fetch:async input=>{
      const request=input instanceof Request?input:new Request(input);
      return new URL(request.url).pathname.endsWith("/refresh")?jsonResponse(503,{type:"https://shixu.app/errors/SERVICE_UNAVAILABLE",status:503,title:"Unavailable",detail:"Try again",code:"SERVICE_UNAVAILABLE"}):jsonResponse(401,{type:"https://shixu.app/errors/UNAUTHORIZED",status:401,title:"Unauthorized",detail:"Expired",code:"UNAUTHORIZED"});
    }});
    await client.GET("/api/v1/auth/me");
    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(useAuthStore.getState().accessToken).toBe("expired-but-recoverable");
    expect(expired).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    useAuthStore.setState({
      status: "unknown",
      accessToken: null,
      user: null,
      themeMode: "system",
    });
    document.documentElement.classList.remove("dark");
    vi.restoreAllMocks();
  });

  it("stores accessToken and syncs dark theme class on setSession", () => {
    useAuthStore.getState().setSession("token-123", MOCK_USER);

    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(useAuthStore.getState().accessToken).toBe("token-123");
    expect(useAuthStore.getState().themeMode).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    useAuthStore.getState().clearSession();
    expect(useAuthStore.getState().status).toBe("unauthenticated");
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("exposes typed openapi-fetch client", () => {
    expect(typeof apiClient.GET).toBe("function");
    expect(typeof apiClient.POST).toBe("function");
  });

  it("serializes memberIds with explode=false (comma-separated)", async () => {
    const requestedUrls: string[] = [];
    const client = createApiClient({
      baseUrl: "http://localhost:8080",
      fetch: async (input) => {
        const req = input instanceof Request ? input : new Request(input);
        requestedUrls.push(req.url);
        return jsonResponse(200, {
          workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          from: "2026-11-19T00:00:00Z",
          to: "2026-11-20T00:00:00Z",
          members: [],
        });
      },
    });

    await client.GET("/api/v1/workspaces/{id}/availability", {
      params: {
        path: { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
        query: {
          from: "2026-11-19T00:00:00Z",
          to: "2026-11-20T00:00:00Z",
          memberIds: ["id-1", "id-2"],
        },
      },
    });

    expect(requestedUrls).toHaveLength(1);
    const url = new URL(requestedUrls[0]);
    expect(url.searchParams.get("memberIds")).toBe("id-1,id-2");
    expect(url.searchParams.getAll("memberIds")).toEqual(["id-1,id-2"]);
  });

  it("deduplicates concurrent 401 refresh calls and replays original requests", async () => {
    useAuthStore.getState().setSession("expired-token", { ...MOCK_USER, themeMode: "light" });

    let refreshCount = 0;
    const authHeadersSeen: string[] = [];

    const client = createApiClient({
      baseUrl: "http://localhost:8080",
      fetch: async (input) => {
        const req = input instanceof Request ? input : new Request(input);
        const url = new URL(req.url);

        if (url.pathname === "/api/v1/auth/refresh") {
          refreshCount += 1;
          await new Promise((r) => setTimeout(r, 15));
          return jsonResponse(200, {
            accessToken: "fresh-token",
            refreshToken: "new-refresh",
            expiresInSeconds: 900,
            user: { ...MOCK_USER, themeMode: "light" },
          });
        }

        const auth = req.headers.get("Authorization") ?? "";
        authHeadersSeen.push(auth);
        if (auth === "Bearer expired-token") {
          return jsonResponse(
            401,
            {
              type: "https://shixu.app/errors/UNAUTHORIZED",
              title: "Unauthorized",
              status: 401,
              detail: "token expired",
              code: "UNAUTHORIZED",
            },
            "application/problem+json"
          );
        }

        return jsonResponse(200, { ...MOCK_USER, themeMode: "light" });
      },
    });

    const [r1, r2] = await Promise.all([
      client.GET("/api/v1/auth/me"),
      client.GET("/api/v1/auth/me"),
    ]);

    expect(refreshCount).toBe(1);
    expect(r1.data?.id).toBe(MOCK_USER.id);
    expect(r2.data?.id).toBe(MOCK_USER.id);
    expect(authHeadersSeen).toEqual([
      "Bearer expired-token",
      "Bearer expired-token",
      "Bearer fresh-token",
      "Bearer fresh-token",
    ]);
    expect(useAuthStore.getState().accessToken).toBe("fresh-token");
  });

  it("does not refresh on login INVALID_CREDENTIALS 401", async () => {
    let refreshCalled = false;
    const client = createApiClient({
      baseUrl: "http://localhost:8080",
      fetch: async (input) => {
        const req = input instanceof Request ? input : new Request(input);
        if (new URL(req.url).pathname === "/api/v1/auth/refresh") {
          refreshCalled = true;
        }
        return jsonResponse(
          401,
          {
            type: "https://shixu.app/errors/INVALID_CREDENTIALS",
            title: "Unauthorized",
            status: 401,
            detail: "invalid email or password",
            code: "INVALID_CREDENTIALS",
          },
          "application/problem+json"
        );
      },
    });

    const res = await client.POST("/api/v1/auth/login", {
      body: { email: "a@b.com", password: "wrongpassword" },
    });

    expect(refreshCalled).toBe(false);
    expect(res.response.status).toBe(401);
    const problem = parseProblemDetail(res.response, res.error);
    expect(problem.code).toBe("INVALID_CREDENTIALS");
  });

  it("clears session and invokes onSessionExpired on TOKEN_REUSE_DETECTED", async () => {
    useAuthStore.getState().setSession("expired-token", MOCK_USER);
    const expiredCodes: string[] = [];

    const client = createApiClient({
      baseUrl: "http://localhost:8080",
      onSessionExpired: (code) => expiredCodes.push(code),
      fetch: async (input) => {
        const req = input instanceof Request ? input : new Request(input);
        const path = new URL(req.url).pathname;
        if (path === "/api/v1/auth/refresh") {
          return jsonResponse(
            401,
            {
              type: "https://shixu.app/errors/TOKEN_REUSE_DETECTED",
              title: "Unauthorized",
              status: 401,
              detail: "refresh token reuse detected",
              code: "TOKEN_REUSE_DETECTED",
            },
            "application/problem+json"
          );
        }
        return jsonResponse(
          401,
          {
            type: "https://shixu.app/errors/UNAUTHORIZED",
            title: "Unauthorized",
            status: 401,
            detail: "expired",
            code: "UNAUTHORIZED",
          },
          "application/problem+json"
        );
      },
    });

    const res = await client.GET("/api/v1/auth/me");
    expect(res.response.status).toBe(401);
    expect(expiredCodes).toEqual(["TOKEN_REUSE_DETECTED"]);
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().status).toBe("unauthenticated");
  });

  it("parses valid WsEnvelope and rejects malformed frames", () => {
    const valid = parseWsEvent(
      JSON.stringify({
        version: 1,
        eventId: "01933e6a-8c3b-7000-8000-000000000001",
        type: "energy.updated",
        occurredAt: "2026-11-19T02:00:00Z",
        payload: {
          userId: MOCK_USER.id,
          localDay: "2026-11-19",
          score: 88,
          tier: "peak",
          dataFreshness: "live_wearable",
          computedAt: "2026-11-19T02:00:00Z",
        },
      })
    );
    expect(valid?.type).toBe("energy.updated");
    expect(valid?.version).toBe(1);

    expect(parseWsEvent("not-json")).toBeNull();
    expect(
      parseWsEvent(
        JSON.stringify({
          version: 1,
          eventId: "1",
          type: "unknown.event",
          occurredAt: "2026-11-19T02:00:00Z",
          payload: {},
        })
      )
    ).toBeNull();
  });

  it("initializes dark theme immediately when system prefers dark", () => {
    let changeHandler: (() => void) | undefined;
    let prefersDark = true;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        get matches() {
          return prefersDark;
        },
        addEventListener: (_event: string, cb: () => void) => {
          changeHandler = cb;
        },
        removeEventListener: vi.fn(),
      })),
    });

    const cleanup = initThemeListener();
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    prefersDark = false;
    changeHandler?.();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    cleanup();
  });
});
