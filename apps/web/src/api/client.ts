import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "@/api/schema";
import { parseProblemDetail, type ErrorCode, type ProblemDetail } from "@/api/errors";
import { useAuthStore } from "@/stores/auth-store";

export type ApiComponents = components["schemas"];
export type { ProblemDetail, ErrorCode };
export type HealthResponse = ApiComponents["HealthResponse"];

const PUBLIC_AUTH_PATHS = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/register",
  "/api/v1/auth/refresh",
]);

export interface CreateApiClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  onSessionExpired?: (code: ErrorCode) => void;
}

export function createApiClient(clientOptions: CreateApiClientOptions = {}) {
  const baseUrl = clientOptions.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? "";
  const customFetch = clientOptions.fetch;
  const pendingRequests = new Map<string, Request>();
  let refreshPromise: Promise<string | null> | null = null;

  const client = createClient<paths>({
    baseUrl,
    credentials: "include",
    ...(customFetch ? { fetch: customFetch } : {}),
    querySerializer: {
      array: {
        style: "form",
        explode: false,
      },
    },
  });

  async function refreshSessionSingleFlight(fetchFn: typeof globalThis.fetch): Promise<string | null> {
    if (refreshPromise) {
      return refreshPromise;
    }

    refreshPromise = (async () => {
      try {
        const refreshUrl = `${baseUrl.replace(/\/$/, "")}/api/v1/auth/refresh`;
        const res = await fetchFn(refreshUrl, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });

        const payload = await res.clone().json().catch(() => null);
        if (!res.ok) {
          const problem = parseProblemDetail(res, payload);
          useAuthStore.getState().clearSession();
          clientOptions.onSessionExpired?.(problem.code);
          return null;
        }

        const tokens = payload as ApiComponents["AuthTokensResponse"] | null;
        if (!tokens || typeof tokens.accessToken !== "string" || !tokens.user) {
          useAuthStore.getState().clearSession();
          clientOptions.onSessionExpired?.("INVALID_REFRESH_TOKEN");
          return null;
        }

        useAuthStore.getState().setSession(tokens.accessToken, tokens.user);
        return tokens.accessToken;
      } catch {
        return null;
      } finally {
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  }

  const authMiddleware: Middleware = {
    async onRequest({ request, schemaPath, id }) {
      if (!PUBLIC_AUTH_PATHS.has(schemaPath)) {
        const token = useAuthStore.getState().accessToken;
        if (token) {
          request.headers.set("Authorization", `Bearer ${token}`);
        }
        pendingRequests.set(id, request.clone());
      }
      return request;
    },

    async onResponse({ response, schemaPath, options, id }) {
      const savedRequest = pendingRequests.get(id);
      pendingRequests.delete(id);

      if (response.status !== 401 || PUBLIC_AUTH_PATHS.has(schemaPath) || !savedRequest) {
        return response;
      }

      const rawBody = await response.clone().json().catch(() => null);
      const problem = parseProblemDetail(response, rawBody);
      if (problem.code !== "UNAUTHORIZED") {
        return response;
      }

      const newToken = await refreshSessionSingleFlight(options.fetch);
      if (!newToken) {
        return response;
      }

      const retryRequest = new Request(savedRequest, {
        headers: new Headers(savedRequest.headers),
      });
      retryRequest.headers.set("Authorization", `Bearer ${newToken}`);
      return options.fetch(retryRequest);
    },

    async onError({ id }) {
      pendingRequests.delete(id);
    },
  };

  client.use(authMiddleware);
  return client;
}

export const apiClient = createApiClient();
