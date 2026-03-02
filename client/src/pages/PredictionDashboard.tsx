import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Target, TrendingUp, Award, BarChart3, Loader2, ArrowRight } from "lucide-react";
import { Link } from "wouter";

function AccuracyBadge({ accuracy }: { accuracy: number }) {
  const color = accuracy >= 90 ? "text-green-500 border-green-500" :
                accuracy >= 75 ? "text-blue-500 border-blue-500" :
                accuracy >= 60 ? "text-yellow-500 border-yellow-500" :
                "text-red-500 border-red-500";
  return <Badge variant="outline" className={color}>{accuracy}%</Badge>;
}

export default function PredictionDashboard() {
  const { data: accuracy, isLoading } = trpc.matching.getPredictionAccuracy.useQuery();
  const { data: predictions } = trpc.matching.getPredictions.useQuery({ limit: 20 });

  const unresolvedPredictions = predictions?.filter((p: any) => !p.resolvedAt) ?? [];
  const resolvedPredictions = predictions?.filter((p: any) => p.resolvedAt) ?? [];

  if (isLoading) return <DashboardLayout><div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></DashboardLayout>;

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Target className="h-6 w-6" />AI予測ダッシュボード</h1>
          <p className="text-muted-foreground">マッチングスコアのAI予測精度を追跡</p>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">総予測数</p>
              <p className="text-2xl font-bold">{accuracy?.totalPredictions ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">検証済み</p>
              <p className="text-2xl font-bold">{accuracy?.resolvedPredictions ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">平均精度</p>
              <p className="text-2xl font-bold">{accuracy?.avgAccuracy != null ? `${accuracy.avgAccuracy}%` : "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">最高精度</p>
              <p className="text-2xl font-bold">{accuracy?.maxAccuracy != null ? `${accuracy.maxAccuracy}%` : "—"}</p>
            </CardContent>
          </Card>
        </div>

        {/* Accuracy trend */}
        {accuracy?.accuracyTrend && accuracy.accuracyTrend.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" />精度推移</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-1 h-24">
                {accuracy.accuracyTrend.map((t: any, i: number) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className={`w-full rounded-t ${t.accuracy >= 80 ? "bg-green-500" : t.accuracy >= 60 ? "bg-blue-500" : "bg-yellow-500"}`}
                      style={{ height: `${Math.max(4, t.accuracy)}%` }}
                      title={`${t.accuracy}%`}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2 text-center">最近の{accuracy.accuracyTrend.length}件の予測精度</p>
            </CardContent>
          </Card>
        )}

        {/* Unresolved predictions */}
        {unresolvedPredictions.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">未検証の予測</h2>
            <div className="space-y-2">
              {unresolvedPredictions.map((p: any) => (
                <Card key={p.id}>
                  <CardContent className="py-3 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{p.theme}</p>
                      <p className="text-xs text-muted-foreground">{p.friendName} — 予測: {p.predictedScore}%</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">未検証</Badge>
                      <Link href="/matching">
                        <span className="text-xs text-primary hover:underline flex items-center gap-1">マッチング実行 <ArrowRight className="h-3 w-3" /></span>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Resolved predictions */}
        {resolvedPredictions.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Award className="h-5 w-5" />検証済みの予測</h2>
            <div className="space-y-2">
              {resolvedPredictions.map((p: any) => (
                <Card key={p.id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{p.theme}</p>
                        <p className="text-xs text-muted-foreground">{p.friendName}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right text-sm">
                          <span className="text-muted-foreground">予測</span> <span className="font-bold">{p.predictedScore}%</span>
                          <span className="mx-1 text-muted-foreground">→</span>
                          <span className="text-muted-foreground">実際</span> <span className="font-bold">{p.actualScore}%</span>
                        </div>
                        <AccuracyBadge accuracy={Math.round(p.accuracy)} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {!predictions?.length && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>予測データがありません</p>
              <p className="text-sm">マッチング作成画面から「AI予測」を実行しましょう</p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
