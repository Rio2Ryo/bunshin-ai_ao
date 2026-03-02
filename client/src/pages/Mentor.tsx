import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import {
  Brain, Loader2, TrendingUp, TrendingDown, Minus as MinusIcon,
  Target, Lightbulb, AlertTriangle, CheckCircle, Star,
  Users, MessageSquare, BarChart3, Shield, ArrowUpRight, Zap,
} from "lucide-react";

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string | number; color: string }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold">{value}</p>
      </div>
    </div>
  );
}

export default function Mentor() {
  usePageMeta({ title: "AIメンター", description: "パーソナルAIメンターがあなたのビジネス成長をサポート", path: "/mentor" });

  const { data: adviceData, isLoading: adviceLoading, refetch: refetchAdvice } = trpc.mentor.getAdvice.useQuery();
  const { data: growthData, isLoading: growthLoading } = trpc.mentor.getGrowthHistory.useQuery();

  const advice = adviceData?.advice;
  const stats = adviceData?.stats;
  const growth = growthData;

  return (
    <DashboardLayout>
      <div className="space-y-6" role="main" aria-label="AIメンター">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Brain className="h-8 w-8 text-purple-500" />
              AIメンター
            </h1>
            <p className="text-muted-foreground mt-1">
              あなたのデータを統合分析し、ビジネス成長アドバイスを提供します
            </p>
          </div>
          <Button variant="outline" onClick={() => refetchAdvice()} disabled={adviceLoading}>
            {adviceLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
            分析を更新
          </Button>
        </div>

        {adviceLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Stats Grid */}
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard icon={BarChart3} label="マッチング数" value={stats.totalMatchings} color="bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" />
                <StatCard icon={TrendingUp} label="平均スコア" value={`${stats.avgScore}%`} color="bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400" />
                <StatCard icon={Users} label="友達数" value={stats.friendsCount} color="bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400" />
                <StatCard icon={Shield} label="信頼スコア" value={stats.trustScore} color="bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400" />
              </div>
            )}

            {/* Growth Trend */}
            {growth && growth.dataPoints.length >= 2 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    {growth.trend === "improving" ? <TrendingUp className="h-5 w-5 text-green-500" /> :
                     growth.trend === "declining" ? <TrendingDown className="h-5 w-5 text-red-500" /> :
                     <MinusIcon className="h-5 w-5 text-muted-foreground" />}
                    成長トレンド
                  </CardTitle>
                  <CardDescription>
                    マッチングスコアの推移（{growth.dataPoints.length}回のマッチング）
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 mb-4">
                    <Badge variant={growth.trend === "improving" ? "default" : growth.trend === "declining" ? "destructive" : "secondary"}>
                      {growth.trend === "improving" ? `+${growth.growth}% 上昇傾向` :
                       growth.trend === "declining" ? `${growth.growth}% 下降傾向` :
                       "安定"}
                    </Badge>
                  </div>
                  {/* Simple bar chart */}
                  <div className="flex items-end gap-1 h-32">
                    {growth.dataPoints.map((dp: any, i: number) => (
                      <div
                        key={i}
                        className="flex-1 group relative"
                        title={`${dp.date}: ${dp.theme} - ${dp.score}%`}
                      >
                        <div
                          className={`w-full rounded-t transition-all ${
                            dp.score >= 70 ? "bg-green-500" : dp.score >= 50 ? "bg-blue-500" : "bg-orange-500"
                          } hover:opacity-80`}
                          style={{ height: `${Math.max(dp.score, 5)}%` }}
                        />
                        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10">
                          <div className="bg-popover text-popover-foreground text-xs rounded px-2 py-1 shadow-lg whitespace-nowrap border">
                            {dp.score}% - {dp.theme?.slice(0, 15)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* AI Advice */}
            {advice && (
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Summary */}
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Lightbulb className="h-5 w-5 text-yellow-500" />
                      メンターからのアドバイス
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-base">{advice.summary}</p>
                    {advice.insight && (
                      <p className="mt-3 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3 border-l-4 border-primary">
                        {advice.insight}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Strengths */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Star className="h-5 w-5 text-green-500" />
                      あなたの強み
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {advice.strengths?.length > 0 ? (
                      <ul className="space-y-2">
                        {advice.strengths.map((s: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                            {s}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">データが不足しています</p>
                    )}
                  </CardContent>
                </Card>

                {/* Improvements */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-orange-500" />
                      改善ポイント
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {advice.improvements?.length > 0 ? (
                      <ul className="space-y-2">
                        {advice.improvements.map((s: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <ArrowUpRight className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                            {s}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">データが不足しています</p>
                    )}
                  </CardContent>
                </Card>

                {/* Action Items */}
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Target className="h-5 w-5 text-primary" />
                      今週のアクションアイテム
                    </CardTitle>
                    {advice.weeklyGoal && (
                      <CardDescription className="font-medium text-primary">
                        目標: {advice.weeklyGoal}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    {advice.actionItems?.length > 0 ? (
                      <div className="space-y-2">
                        {advice.actionItems.map((item: string, i: number) => (
                          <div key={i} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                            <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                              {i + 1}
                            </div>
                            <p className="text-sm">{item}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">アクションアイテムを生成するにはもっとマッチングを実行してください</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
