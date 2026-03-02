import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Lightbulb, TrendingUp, Users, Star, Target,
  AlertTriangle, Sparkles, Mail, ArrowRight, CheckCircle, Brain,
} from "lucide-react";
import { Link } from "wouter";

export default function MatchingInsights() {
  usePageMeta({ title: "マッチングインサイト", description: "AI横断分析・パターン検出・成功要因分析", path: "/matching/insights" });
  const { data: insights, isLoading, refetch } = trpc.matching.getInsights.useQuery();
  const generateMut = trpc.matching.generateInsights.useMutation();
  const sendReportMut = trpc.matching.sendInsightsReport.useMutation();

  const handleGenerate = async () => {
    try {
      await generateMut.mutateAsync();
      refetch();
      toast.success("インサイトを生成しました");
    } catch (e: any) {
      toast.error(e.message || "インサイト生成に失敗しました");
    }
  };

  const handleSendReport = async () => {
    try {
      const result = await sendReportMut.mutateAsync();
      if (result.sent) {
        toast.success("レポートをメール送信しました");
      } else {
        toast.info(result.reason || "メール送信できませんでした");
      }
    } catch (e: any) {
      toast.error(e.message || "メール送信に失敗しました");
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Lightbulb className="h-6 w-6 text-yellow-500" />
              マッチングインサイト
            </h1>
            <p className="text-muted-foreground">AI横断分析 — パターン検出・最適パートナー・成功要因</p>
          </div>
          <div className="flex gap-2">
            {insights && (
              <Button variant="outline" size="sm" onClick={handleSendReport} disabled={sendReportMut.isPending}>
                <Mail className="h-4 w-4 mr-2" />メール送信
              </Button>
            )}
            <Button onClick={handleGenerate} disabled={generateMut.isPending}>
              {generateMut.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />分析中...</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-2" />AI分析実行</>
              )}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : insights ? (
          <>
            {/* Summary */}
            {insights.summary && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <Brain className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <p className="text-sm">{insights.summary}</p>
                  </div>
                  {insights.generatedAt && (
                    <p className="text-xs text-muted-foreground mt-2">最終分析: {insights.generatedAt.slice(0, 16).replace("T", " ")}</p>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Patterns */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-blue-500" />
                    発見パターン
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {insights.patterns?.length > 0 ? (
                    <ul className="space-y-2">
                      {insights.patterns.map((p: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <CheckCircle className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">パターンが見つかりませんでした</p>
                  )}
                </CardContent>
              </Card>

              {/* Best Partner */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-green-500" />
                    最適パートナー
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {insights.bestPartner ? (
                    <div className="bg-green-500/5 rounded-lg p-4">
                      <p className="font-medium text-lg">{insights.bestPartner.name}</p>
                      <p className="text-sm text-muted-foreground mt-1">{insights.bestPartner.reason}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">データ不足のため分析できませんでした</p>
                  )}
                </CardContent>
              </Card>

              {/* Success Factors */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Star className="h-5 w-5 text-yellow-500" />
                    成功要因
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {insights.successFactors?.length > 0 ? (
                    <ul className="space-y-2">
                      {insights.successFactors.map((f: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <Star className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">データ不足です</p>
                  )}
                </CardContent>
              </Card>

              {/* Weak Areas */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-orange-500" />
                    改善領域
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {insights.weakAreas?.length > 0 ? (
                    <ul className="space-y-2">
                      {insights.weakAreas.map((w: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">改善点はありません</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Recommendation */}
            {insights.recommendation && (
              <Card className="border-primary/30">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <Target className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium mb-1">次のマッチングへのアドバイス</p>
                      <p className="text-sm">{insights.recommendation}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <Card>
            <CardContent className="py-16 text-center">
              <Lightbulb className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-2">インサイトがまだ生成されていません</p>
              <p className="text-sm text-muted-foreground mb-4">2件以上のマッチング結果があれば、AI横断分析が可能です</p>
              <Button onClick={handleGenerate} disabled={generateMut.isPending}>
                {generateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                AI分析実行
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
