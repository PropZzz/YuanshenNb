import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "@/api/schema";
import { useAuthStore } from "@/stores/auth-store";

export type ApiComponents = components["schemas"];
export type ProblemDetail = ApiComponents["ProblemDetail"];
export type HealthResponse = ApiComponents["HealthResponse"];

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      request.headers.set("Authorization", `Bearer ${token}`);
    }
    return request;
  },
};

export const apiClient = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? "",
  credentials: "include",
});

apiClient.use(authMiddleware);
