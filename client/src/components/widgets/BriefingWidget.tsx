import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Sun, ArrowRight } from "lucide-react";
import { Link } from "wouter";

export function BriefingWidget() {
  const { data } = trpc.matching.getDashboardBriefing.useQuery(undefined, { staleTime: 60_000 });

  if (!data) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sun className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium">デイリーブリーフィング</span>
          </div>
          <p className="text-xs text-muted-foreground">今日のブリーフィングはまだ生成されていません</p>
          <Link href="/daily-briefing">
            <span className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-2">
              生成する <ArrowRight className="h-3 w-3" />
            </span>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sun className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium">デイリーブリーフィング</span>
          </div>
          <Link href="/daily-briefing">
            <span className="text-xs text-primary hover:underline">詳細</span>
          </Link>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{data.content}</p>
        {data.recommendations.length > 0 && (
          <div className="space-y-1">
            {data.recommendations.slice(0, 2).map((r: string, i: number) => (
              <p key={i} className="text-xs flex items-start gap-1">
                <span className="text-primary shrink-0">•</span>
                <span className="line-clamp-1">{r}</span>
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
