import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-lg mx-4">
        <CardContent className="pt-8 pb-8 text-center">
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="absolute inset-0 bg-destructive/10 rounded-full animate-pulse" />
              <AlertCircle className="relative h-16 w-16 text-destructive" />
            </div>
          </div>

          <h1 className="text-4xl font-bold mb-2">404</h1>

          <h2 className="text-xl font-semibold text-muted-foreground mb-4">
            ページが見つかりません
          </h2>

          <p className="text-muted-foreground mb-8 leading-relaxed">
            お探しのページは存在しないか、移動または削除された可能性があります。
          </p>

          <Button onClick={() => setLocation("/")} size="lg">
            <Home className="w-4 h-4 mr-2" />
            トップページへ
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
