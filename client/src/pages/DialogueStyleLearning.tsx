import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Brain, Mic, CheckCircle, RefreshCw, Sparkles, Loader2 } from "lucide-react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from "recharts";

const AXIS_LABELS: Record<string, string> = {
  formality: "フォーマル度",
  assertiveness: "主張性",
  empathy: "共感力",
  technicality: "専門性",
  verbosity: "冗長度",
  creativity: "創造性",
  logicality: "論理性",
  questionFrequency: "質問頻度",
};

const AXIS_DESCRIPTIONS: Record<string, { low: string; high: string }> = {
  formality: { low: "カジュアルで親しみやすいトーン", high: "フォーマルで礼儀正しいトーン" },
  assertiveness: { low: "控えめで相手の意見を尊重", high: "積極的に自分の意見を主張" },
  empathy: { low: "事実ベースの客観的な対応", high: "相手の感情に寄り添う対応" },
  technicality: { low: "平易な言葉で分かりやすく", high: "専門用語を活用した深い議論" },
  verbosity: { low: "簡潔で要点を絞った発言", high: "詳細で丁寧な説明" },
  creativity: { low: "定型的で安定した提案", high: "独創的でユニークなアイデア" },
  logicality: { low: "直感的・感覚的な判断", high: "論理的・構造的な分析" },
  questionFrequency: { low: "情報提供中心のスタイル", high: "質問で相手を引き出すスタイル" },
};

export default function DialogueStyleLearning() {
  usePageMeta({ title: "対話スタイル学習", description: "AIが対話スタイルを分析・学習します", path: "/dialogue-style" });

  const [activeTab, setActiveTab] = useState("analysis");

  const { data: styleRaw, refetch: refetchStyle } = trpc.myTwin.getDialogueStyle.useQuery();
  const style = styleRaw as any;

  const analyzeMut = trpc.myTwin.analyzeDialogueStyle.useMutation({
    onSuccess: () => {
      toast.success("スタイル分析が完了しました");
      refetchStyle();
    },
    onError: (err: any) => toast.error(err.message || "分析に失敗しました"),
  });

  const applyMut = trpc.myTwin.applyDialogueStyle.useMutation({
    onSuccess: () => {
      toast.success("スタイルをツインに適用しました");
      refetchStyle();
    },
    onError: (err: any) => toast.error(err.message || "適用に失敗しました"),
  });

  // Data from getDialogueStyle: { styleProfile, samplePhrases, analysisSource, appliedToPrompt }
  const styleProfile = style?.styleProfile || {};
  const radarData = Object.entries(AXIS_LABELS).map(([key, label]) => ({
    axis: label,
    value: styleProfile[key] ?? 50,
    fullMark: 100,
  }));

  const samplePhrases = (style?.samplePhrases || []) as string[];
  const analysisSource = style?.analysisSource || {};
  const isApplied = style?.appliedToPrompt === 1;
  const summary = analysisSource?.summary || "";

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Mic className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">対話スタイル学習</h1>
            <p className="text-sm text-muted-foreground">マッチング対話のスタイルを分析し、ツインに反映できます</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="analysis">
              <Brain className="h-4 w-4 mr-1.5" />スタイル分析
            </TabsTrigger>
            <TabsTrigger value="details">
              <Sparkles className="h-4 w-4 mr-1.5" />プロファイル詳細
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: スタイル分析 */}
          <TabsContent value="analysis" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Brain className="h-5 w-5" />
                    対話スタイル分析
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {isApplied && (
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                        <CheckCircle className="h-3 w-3 mr-1" />適用済み
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button onClick={() => analyzeMut.mutate()} disabled={analyzeMut.isPending}>
                    {analyzeMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                    スタイルを分析
                  </Button>
                  {style && !isApplied && (
                    <Button variant="outline" onClick={() => applyMut.mutate()} disabled={applyMut.isPending}>
                      {applyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
                      スタイルをツインに適用
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {style ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">レーダーチャート</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[350px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={radarData}>
                          <PolarGrid stroke="hsl(var(--muted-foreground))" opacity={0.2} />
                          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                          <Radar
                            name="スタイル"
                            dataKey="value"
                            stroke="#6366f1"
                            fill="#6366f1"
                            fillOpacity={0.3}
                            strokeWidth={2}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                {samplePhrases.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">特徴的なフレーズ</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {samplePhrases.map((phrase, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="text-primary mt-0.5">&#8226;</span>
                            <span className="text-muted-foreground">{phrase}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {summary && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">サマリー</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground leading-relaxed">{summary}</p>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Brain className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <p className="text-muted-foreground">「スタイルを分析」ボタンで対話スタイルを解析します</p>
                  <p className="text-xs text-muted-foreground mt-1">マッチング・チャット履歴をもとに分析します</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Tab 2: プロファイル詳細 */}
          <TabsContent value="details" className="space-y-4">
            {style ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  {Object.entries(AXIS_LABELS).map(([key, label]) => {
                    const score = styleProfile[key] ?? 50;
                    const desc = AXIS_DESCRIPTIONS[key];
                    return (
                      <Card key={key}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">{label}</CardTitle>
                          <CardDescription className="text-xs">
                            {score <= 40 ? desc.low : score >= 70 ? desc.high : `${desc.low} / ${desc.high} のバランス型`}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">スコア</span>
                            <span className="font-medium">{score}</span>
                          </div>
                          <Progress value={score} className="h-2" />
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {(analysisSource.matchingCount != null || analysisSource.chatCount != null) && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">分析ソース</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex gap-6 text-sm">
                        <div>
                          <span className="text-muted-foreground">マッチング数: </span>
                          <span className="font-medium">{analysisSource.matchingCount ?? 0}件</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">チャット数: </span>
                          <span className="font-medium">{analysisSource.chatCount ?? 0}件</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Sparkles className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <p className="text-muted-foreground">まずスタイル分析を実行してください</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
