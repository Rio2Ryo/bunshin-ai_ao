import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Lightbulb, TrendingUp, Target, Sparkles, ArrowRight, Users, Loader2, BarChart3 } from "lucide-react";
import { Link } from "wouter";

export default function Recommendations() {
  usePageMeta({ title: "AIマッチング推薦", description: "過去のマッチング結果を分析した推薦", path: "/recommendations" });
  const { data, isLoading } = trpc.matching.recommendations.useQuery(undefined, { staleTime: 60_000 });

  if (isLoading || !data) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  const { recommendations, insights, stats } = data;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lightbulb className="h-6 w-6 text-primary" />
            AIマッチング推薦
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            過去のマッチング結果を分析して、相性の良いユーザーを自動サジェスト
          </p>
        </div>

        {/* Stats */}
        {stats && stats.totalMatchings > 0 && (
          <div className="grid gap-3 grid-cols-3">
            <Card>
              <CardContent className="p-4 text-center">
                <BarChart3 className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                <p className="text-2xl font-bold">{stats.totalMatchings}</p>
                <p className="text-xs text-muted-foreground">総マッチング数</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <TrendingUp className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                <p className="text-2xl font-bold">{stats.avgScore}%</p>
                <p className="text-xs text-muted-foreground">平均スコア</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Target className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                <p className="text-2xl font-bold">{stats.successCount}</p>
                <p className="text-xs text-muted-foreground">成功マッチング</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* AI Insights */}
        {insights && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm mb-1">AI分析インサイト</p>
                  <p className="text-sm text-muted-foreground">{insights.summary}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Badge variant="secondary" className="text-xs">パターン: {insights.topPattern}</Badge>
                    <Badge variant="outline" className="text-xs">提案: {insights.suggestion}</Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recommendations */}
        {recommendations.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Users className="h-5 w-5" />
              推薦ユーザー ({recommendations.length}名)
            </h2>
            {recommendations.map((rec: any, i: number) => (
              <Card key={rec.friendId} className="hover:border-primary/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${i < 3 ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                      <span className="font-bold text-sm">#{i + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-sm">{rec.friendName}</p>
                        <Badge variant={rec.score >= 80 ? "default" : rec.score >= 60 ? "secondary" : "outline"} className="text-xs">
                          推薦度 {rec.score}%
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{rec.twinName} · {rec.twinDescription?.slice(0, 50) || "説明なし"}</p>
                      {rec.industry && (
                        <Badge variant="outline" className="text-[10px] mt-1 mr-1">{rec.industry}</Badge>
                      )}
                      {rec.tags.slice(0, 3).map((tag: string) => (
                        <Badge key={tag} variant="outline" className="text-[10px] mt-1 mr-1">{tag}</Badge>
                      ))}
                      <div className="mt-2 space-y-0.5">
                        {rec.reasons.map((reason: string, ri: number) => (
                          <p key={ri} className="text-xs text-muted-foreground flex items-center gap-1">
                            <span className="text-primary">•</span> {reason}
                          </p>
                        ))}
                      </div>
                      {rec.matchHistory.count > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          過去{rec.matchHistory.count}回マッチング済み {rec.matchHistory.bestScore ? `(最高: ${rec.matchHistory.bestScore}%)` : ""}
                        </p>
                      )}
                    </div>
                    <Link href={`/matching`}>
                      <Button size="sm" variant="outline" className="shrink-0">
                        マッチング
                        <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <Target className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium">推薦データがまだありません</p>
              <p className="text-xs text-muted-foreground mt-1">マッチングを数回実行すると、AI推薦が利用できるようになります</p>
              <Link href="/matching">
                <Button className="mt-4" size="sm">
                  マッチングを始める
                  <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
