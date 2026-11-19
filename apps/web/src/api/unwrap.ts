import { ApiError, parseProblemDetail } from "./errors";
export function unwrap<T>({ data, error, response }: { data?: T; error?: unknown; response: Response }): T {
  if (!response.ok || error) throw new ApiError(parseProblemDetail(response, error));
  if (data === undefined) throw new Error("服务端未返回数据，请重试");
  return data;
}
export function assertSuccess({ error, response }: { error?: unknown; response: Response }): void {
  if (!response.ok || error) throw new ApiError(parseProblemDetail(response, error));
}
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const known: Record<string, string> = { UNAUTHORIZED: "登录已过期，请重新登录", INVALID_CREDENTIALS: "邮箱或密码不正确", EMAIL_ALREADY_EXISTS: "这个邮箱已注册，请直接登录", SCHEDULE_CONFLICT: "这段时间与已有日程冲突，请调整时间", BASELINE_VERSION_MISMATCH: "日程已发生变化，请刷新并重新计算方案", CONFLICT: "数据已发生变化，请刷新后重试", FORBIDDEN: "你没有执行此操作的权限" };
    return known[error.code] ?? error.detail ?? "操作未完成，请重试";
  }
  if (error instanceof TypeError) return "无法连接服务端，请检查网络并重试";
  return error instanceof Error ? error.message : "操作未完成，请重试";
}

