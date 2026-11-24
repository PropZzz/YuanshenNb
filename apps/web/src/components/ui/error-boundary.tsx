import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "@/components/ui/reference-icons";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/** Top-level route ErrorBoundary preventing uncaught render exceptions from blanking the SPA. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : "页面渲染时发生意外错误";
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("AppErrorBoundary caught error:", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="surface-card w-full max-w-md p-6 space-y-4 text-center" role="alert">
          <div className="mx-auto w-11 h-11 rounded-2xl grid place-items-center bg-error-container text-on-error-container">
            <AlertTriangle size={22} aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-headline text-xl font-bold text-primary">工作台视图遇到意外异常</h1>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              {this.state.message || "可以尝试重新载入当前视图或返回专注首页。"}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => this.setState({ hasError: false, message: "" })}
            >
              <RefreshCw size={15} />
              重试渲染
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                window.location.assign("/focus");
              }}
            >
              回到专注首页
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
