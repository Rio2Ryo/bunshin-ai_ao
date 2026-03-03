import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Gauge, ArrowRight } from "lucide-react";
import { Link } from "wouter";

export function QualityTrendWidget() {
  const { data } = trpc.matching.getDashboardQualityTrend.useQuery(undefined, { staleTime: 60_000 });

  const items = data || [];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-blue-500" />
            <span className="text-sm font-medium">品質トレンド</span>
          </div>
          <Link href="/quality-meter">
            <span className="text-xs text-primary hover:underline">詳細</span>
          </Link>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">品質データがありません</p>
        ) : (
          <div className="space-y-2">
            {items.map((item: any) => (
              <div key={item.sessionId} className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground truncate max-w-[60%]">{item.theme}</span>
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-muted rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${item.avg >= 70 ? 'bg-green-500' : item.avg >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                      style={{ width: `${item.avg}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium w-8 text-right">{item.avg}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
