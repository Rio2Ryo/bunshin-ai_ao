import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, HeartPulse, Brain, Database, HelpCircle, Zap, MessageSquareHeart, ArrowRight, CheckCircle2, AlertTriangle, Star } from "lucide-react";
import { useLocation } from "wouter";

const DIMENSION_ICONS: Record<string, any> = {
  personality: Brain,
  knowledge: Database,
  faq: HelpCircle,
  matching: Zap,
  feedback: MessageSquareHeart,
};

const GRADE_COLORS: Record<string, string> = {
  S: "text-yellow-400 border-yellow-400",
  A: "text-green-400 border-green-400",
  B: "text-blue-400 border-blue-400",
  C: "text-orange-400 border-orange-400",
  D: "text-red-400 border-red-400",
};

const GRADE_BG: Record<string, string> = {
  S: "bg-yellow-500/10",
  A: "bg-green-500/10",
  B: "bg-blue-500/10",
  C: "bg-orange-500/10",
  D: "bg-red-500/10",
};

const PRIORITY_BADGE: Record<string, { variant: "destructive" | "default" | "secondary"; label: string }> = {
  high: { variant: "destructive", label: "HIGH" },
  medium: { variant: "default", label: "MEDIUM" },
  low: { variant: "secondary", label: "LOW" },
};

function ScoreStars({ score, max = 5 }: { score: number; max?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${i < score ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground/30"}`}
        />
      ))}
    </div>
  );
}

export default function TwinHealth() {
  usePageMeta({ title: "ツインヘルスチェック", description: "ツインの設定充実度を診断" });
  const [, navigate] = useLocation();

  const healthQuery = trpc.myTwin.healthCheck.useQuery();
  const data = healthQuery.data;

  if (healthQuery.isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (healthQuery.error || !data) {
    return (
      <DashboardLayout>
        <div className="container mx-auto py-6 px-4">
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <HeartPulse className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>ツインが見つかりません。先にツインを作成してください。</p>
              <Button variant="outline" className="mt-4" onClick={() => navigate("/twins")}>
                ツインを作成
              </Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const gradeColor = GRADE_COLORS[data.grade] || "text-muted-foreground";
  const gradeBg = GRADE_BG[data.grade] || "";
  const completedActions = data.actions.filter((a: any) => a.completed).length;
  const pendingActions = data.actions.filter((a: any) => !a.completed);

  return (
    <DashboardLayout>
      <div className="container mx-auto py-6 px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <HeartPulse className="h-6 w-6" />
              ツインヘルスチェック
            </h1>
            <p className="text-muted-foreground text-sm mt-1">{data.twinName}の設定充実度を診断</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => healthQuery.refetch()}>
            再診断
          </Button>
        </div>

        {/* Overall Grade & Score */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className={gradeBg}>
            <CardContent className="p-6 flex flex-col items-center justify-center">
              <div className={`text-6xl font-black border-4 rounded-full w-24 h-24 flex items-center justify-center ${gradeColor}`}>
                {data.grade}
              </div>
              <div className="text-lg font-semibold mt-3">総合グレード</div>
              <div className="text-sm text-muted-foreground">{data.overallScore} / 5.0</div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">5次元スコア</CardTitle>
              <CardDescription>各項目を5段階で評価</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.dimensions.map((dim: any) => {
                const Icon = DIMENSION_ICONS[dim.key] || Star;
                return (
                  <div key={dim.key} className="flex items-center gap-3">
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm w-28 shrink-0">{dim.label}</span>
                    <Progress value={(dim.score / dim.max) * 100} className="flex-1 h-2" />
                    <ScoreStars score={dim.score} />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {/* Stats Detail */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">詳細統計</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="text-muted-foreground text-xs">人格設定文字数</div>
                <div className="font-semibold">{data.stats.personalityLength}文字</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="text-muted-foreground text-xs">Big Five / MBTI</div>
                <div className="font-semibold">
                  {data.stats.hasBigFive ? "✓" : "✗"} / {data.stats.hasMbti ? "✓" : "✗"}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="text-muted-foreground text-xs">ナレッジ数</div>
                <div className="font-semibold">{data.stats.knowledgeCount}件</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="text-muted-foreground text-xs">FAQ数</div>
                <div className="font-semibold">{data.stats.faqCount}件</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="text-muted-foreground text-xs">マッチング回数</div>
                <div className="font-semibold">{data.stats.matchingCount}回</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="text-muted-foreground text-xs">フィードバック数</div>
                <div className="font-semibold">{data.stats.feedbackTotal}件</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="text-muted-foreground text-xs">フィードバック反映</div>
                <div className="font-semibold">{data.stats.feedbackApplied}回</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="text-muted-foreground text-xs">反映率</div>
                <div className="font-semibold">{data.stats.feedbackRate}%</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Improvement Actions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              改善アクション ({pendingActions.length}件)
            </CardTitle>
            <CardDescription>ワンクリックで各ページに移動して改善を実行</CardDescription>
          </CardHeader>
          <CardContent>
            {pendingActions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-green-500" />
                <p className="font-medium">すべての改善アクションが完了しています！</p>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingActions.map((action: any) => {
                  const badge = PRIORITY_BADGE[action.priority] || PRIORITY_BADGE.low;
                  return (
                    <div
                      key={action.key}
                      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => navigate(action.actionPath)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{action.label}</span>
                          <Badge variant={badge.variant} className="text-[10px] px-1.5 py-0">{badge.label}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{action.description}</p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
