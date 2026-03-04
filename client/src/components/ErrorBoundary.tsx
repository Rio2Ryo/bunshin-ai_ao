import { cn } from "@/lib/utils";
import { Sentry } from "@/lib/sentry";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    Sentry.withScope((scope) => {
      scope.setExtras({ componentStack: errorInfo.componentStack });
      Sentry.captureException(error);
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-md p-8 text-center">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl font-semibold mb-2">
              予期しないエラーが発生しました
            </h2>

            <p className="text-sm text-muted-foreground mb-6">
              問題が発生しました。ページを再読み込みしてください。
              問題が続く場合はサポートにお問い合わせください。
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => window.location.reload()}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg",
                  "bg-primary text-primary-foreground",
                  "hover:opacity-90 cursor-pointer"
                )}
              >
                <RotateCcw size={16} />
                ページを再読み込み
              </button>
              <button
                onClick={() => {
                  window.location.href = "/dashboard";
                }}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg",
                  "border border-border text-foreground",
                  "hover:bg-muted cursor-pointer"
                )}
              >
                ダッシュボードへ
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
