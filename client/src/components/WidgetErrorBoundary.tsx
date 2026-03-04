import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sentry } from "@/lib/sentry";

interface Props {
  children: ReactNode;
  widgetName?: string;
}

interface State {
  hasError: boolean;
}

export class WidgetErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    Sentry.withScope((scope) => {
      scope.setTag("widget", this.props.widgetName || "unknown");
      scope.setExtras({ componentStack: errorInfo.componentStack });
      Sentry.captureException(error);
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive/60 mb-2" />
            <p className="text-sm text-muted-foreground mb-3">
              {this.props.widgetName ? `${this.props.widgetName}の` : ""}読み込みに失敗しました
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => this.setState({ hasError: false })}
              className="gap-1"
            >
              <RotateCcw className="h-3 w-3" />
              再試行
            </Button>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}
