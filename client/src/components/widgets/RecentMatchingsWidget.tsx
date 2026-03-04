import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Clock, CheckCircle, ArrowRight } from "lucide-react";
import { Link } from "wouter";

export function RecentMatchingsWidget() {
  const { data: matchingSessions } = trpc.matching.sessions.useQuery(undefined, { staleTime: 30_000 });
  const recentMatchings = (matchingSessions ?? []).slice(0, 5);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            最近のマッチング
          </CardTitle>
          <Link href="/matching">
            <Button variant="ghost" size="sm" className="text-xs">すべて見る</Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {recentMatchings.length === 0 ? (
          <div className="flex flex-col items-center py-4 gap-2">
            <p className="text-sm text-muted-foreground text-center">マッチングがありません</p>
            <Link href="/matching">
              <Button size="sm" variant="outline" className="gap-1 text-xs">
                <ArrowRight className="h-3 w-3" />
                マッチングを始める
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {recentMatchings.map((session: any) => {
              const score = session.compatibilityScore || 0;
              return (
                <Link key={session.id} href={`/matching/${session.id}`}>
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div className="flex items-center gap-2.5">
                      {session.status === "completed" ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <Clock className="h-4 w-4 text-muted-foreground" />
                      )}
                      <div>
                        <p className="font-medium text-sm">{session.theme}</p>
                        <p className="text-xs text-muted-foreground">
                          {session.twin1?.name} × {session.twin2?.name}
                        </p>
                      </div>
                    </div>
                    {score > 0 && (
                      <Badge variant={score >= 80 ? "default" : "secondary"} className="text-xs">
                        {score}%
                      </Badge>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
