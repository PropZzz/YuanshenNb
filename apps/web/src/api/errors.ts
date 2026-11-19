import type { components } from "@/api/schema";

export type ApiComponents = components["schemas"];
export type ProblemDetail = ApiComponents["ProblemDetail"];
export type ErrorCode = ApiComponents["ErrorCode"];

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly detail: string;
  readonly problem: ProblemDetail;

  constructor(problem: ProblemDetail) {
    super(problem.detail || problem.title || `HTTP ${problem.status}`);
    this.name = "ApiError";
    this.status = problem.status;
    this.code = problem.code;
    this.detail = problem.detail;
    this.problem = problem;
  }
}

export function isProblemDetail(value: unknown): value is ProblemDetail {
  if (!value || typeof value !== "object") {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.status === "number" &&
    typeof obj.code === "string" &&
    typeof obj.detail === "string" &&
    typeof obj.title === "string" &&
    typeof obj.type === "string"
  );
}

function fallbackErrorCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 405:
      return "METHOD_NOT_ALLOWED";
    case 409:
      return "CONFLICT";
    case 422:
      return "VALIDATION_FAILED";
    case 429:
      return "TOO_MANY_REQUESTS";
    case 503:
      return "SERVICE_UNAVAILABLE";
    default:
      return "INTERNAL_SERVER_ERROR";
  }
}

export function parseProblemDetail(response: Pick<Response, "status" | "statusText">, body: unknown): ProblemDetail {
  if (isProblemDetail(body)) {
    return body;
  }
  const code = fallbackErrorCode(response.status);
  return {
    type: `https://shixu.app/errors/${code}`,
    title: response.statusText || "Request Failed",
    status: response.status,
    detail: response.statusText || `HTTP ${response.status}`,
    code,
  };
}

export function isProblemCode(err: unknown, code: ErrorCode): boolean {
  if (err instanceof ApiError) {
    return err.code === code;
  }
  if (isProblemDetail(err)) {
    return err.code === code;
  }
  return false;
}
