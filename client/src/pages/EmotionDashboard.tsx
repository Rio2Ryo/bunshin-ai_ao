import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from "recharts";
import { Heart, Brain, Smile, Frown, Meh, Loader2, BarChart3, TrendingUp, Zap, RefreshCw } from "lucide-react";

export default function EmotionDashboard() {
  usePageMeta({ title: "感情ダッシュボード", description: "マッチング中のツインの感情変化を可視化します。", path: "/emotions" });

  const [selectedSession, setSelectedSession] = useState<string>("");

  const { data: sessions, isLoading: sessionsLoading } = trpc.matching.sessions.useQuery();

  const sessionId = selectedSession ? parseInt(selectedSession) : undefined;

  const { data: emotionData, isLoading: emotionLoading } = trpc.matching.getEmotionAnalysis.useQuery(
    { sessionId: sessionId! },
    { enabled: !!sessionId }
  );

  const { data: comparisonData, isLoading: comparisonLoading } = trpc.matching.getEmotionComparison.useQuery(
    { sessionId: sessionId! },
    { enabled: !!sessionId }
  );

  const analyzeMut = trpc.matching.analyzeEmotions.useMutation({
    onSuccess: () => {
      toast.success("感情分析が完了しました");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleAnalyze = () => {
    if (!sessionId) {
      toast.error("セッションを選択してください");
      return;
    }
    analyzeMut.mutate({ sessionId });
  };

  // Build chart data from emotion analysis
  const timelineData = (emotionData as any)?.timeline ?? [];
  const sentimentData = (emotionData as any)?.sentimentDistribution ?? [];
  const radarData = (emotionData as any)?.emotionRadar ?? [];

  const selfRadar = radarData.map((d: any) => ({ subject: d.category, self: d.self ?? 0, opponent: d.opponent ?? 0 }));

  const emotionIcon = (emotion: string) => {
    switch (emotion) {
      case "positive": return <Smile className="h-4 w-4 text-green-500" />;
      case "negative": return <Frown className="h-4 w-4 text-red-500" />;
      default: return <Meh className="h-4 w-4 text-gray-500" />;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <Heart className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">感情ダッシュボード</h1>
            <p className="text-sm text-muted-foreground">マッチング対話中のツインの感情を分析・可視化します</p>
          </div>
        </div>

        {/* Session Selector */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              分析対象セッション
            </CardTitle>
            <CardDescription>マッチングセッションを選択して感情分析を実行してください</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <Select value={selectedSession} onValueChange={setSelectedSession}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="セッションを選択..." />
                </SelectTrigger>
                <SelectContent>
                  {sessionsLoading ? (
                    <SelectItem value="__loading" disabled>読み込み中...</SelectItem>
                  ) : sessions && (sessions as any[]).length > 0 ? (
                    (sessions as any[]).map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.theme || `セッション #${s.id}`} — {s.createdAt ? new Date(s.createdAt).toLocaleDateString("ja-JP") : ""}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="__none" disabled>セッションがありません</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Button onClick={handleAnalyze} disabled={!sessionId || analyzeMut.isPending}>
                {analyzeMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
                感情を分析
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Loading state */}
        {(emotionLoading || comparisonLoading) && sessionId && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* No session selected */}
        {!sessionId && (
          <Card>
            <CardContent className="flex flex-col items-center py-16">
              <BarChart3 className="h-12 w-12 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">セッションを選択すると感情分析が表示されます</p>
            </CardContent>
          </Card>
        )}

        {/* Charts - shown when data available */}
        {sessionId && !emotionLoading && emotionData && (
          <div className="space-y-6">
            {/* Emotion Timeline */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  感情タイムライン
                </CardTitle>
                <CardDescription>対話ターンごとの信頼度の推移</CardDescription>
              </CardHeader>
              <CardContent>
                {timelineData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={timelineData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="turn" label={{ value: "ターン", position: "insideBottom", offset: -5 }} />
                      <YAxis domain={[0, 100]} label={{ value: "信頼度", angle: -90, position: "insideLeft" }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="selfConfidence" stroke="#3b82f6" strokeWidth={2} name="自分のツイン" dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="opponentConfidence" stroke="#f97316" strokeWidth={2} name="相手のツイン" dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex flex-col items-center py-8 text-muted-foreground">
                    <TrendingUp className="h-8 w-8 mb-2" />
                    <p className="text-sm">タイムラインデータがありません。「感情を分析」ボタンを押してください。</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Sentiment Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  センチメント分布
                </CardTitle>
                <CardDescription>各ターンのポジティブ・ニュートラル・ネガティブの割合</CardDescription>
              </CardHeader>
              <CardContent>
                {sentimentData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={sentimentData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="turn" />
                      <YAxis domain={[0, 100]} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="positive" stackId="a" fill="#22c55e" name="ポジティブ" />
                      <Bar dataKey="neutral" stackId="a" fill="#6b7280" name="ニュートラル" />
                      <Bar dataKey="negative" stackId="a" fill="#ef4444" name="ネガティブ" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex flex-col items-center py-8 text-muted-foreground">
                    <BarChart3 className="h-8 w-8 mb-2" />
                    <p className="text-sm">センチメントデータがありません</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Emotion Radar */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Brain className="h-5 w-5 text-primary" />
                  感情レーダー
                </CardTitle>
                <CardDescription>ツイン同士の感情特性比較</CardDescription>
              </CardHeader>
              <CardContent>
                {selfRadar.length > 0 ? (
                  <ResponsiveContainer width="100%" height={350}>
                    <RadarChart data={selfRadar}>
                      <PolarGrid className="stroke-muted" />
                      <PolarAngleAxis dataKey="subject" className="text-xs" />
                      <PolarRadiusAxis domain={[0, 100]} />
                      <Tooltip />
                      <Legend />
                      <Radar name="自分のツイン" dataKey="self" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
                      <Radar name="相手のツイン" dataKey="opponent" stroke="#f97316" fill="#f97316" fillOpacity={0.2} />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex flex-col items-center py-8 text-muted-foreground">
                    <Brain className="h-8 w-8 mb-2" />
                    <p className="text-sm">レーダーデータがありません</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Comparison Card */}
            {comparisonData && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <RefreshCw className="h-5 w-5 text-primary" />
                    ツイン感情比較
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <Smile className="h-4 w-4 text-blue-500" />
                        自分のツイン
                      </h3>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">平均信頼度</span>
                          <span className="font-medium">{(comparisonData as any).self?.avgConfidence ?? "—"}%</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">支配的感情</span>
                          <span className="font-medium flex items-center gap-1">
                            {emotionIcon((comparisonData as any).self?.dominantEmotion ?? "neutral")}
                            {(comparisonData as any).self?.dominantEmotion ?? "—"}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">トレンド</span>
                          <Badge variant="outline">{(comparisonData as any).self?.sentimentTrend ?? "—"}</Badge>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <Smile className="h-4 w-4 text-orange-500" />
                        相手のツイン
                      </h3>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">平均信頼度</span>
                          <span className="font-medium">{(comparisonData as any).opponent?.avgConfidence ?? "—"}%</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">支配的感情</span>
                          <span className="font-medium flex items-center gap-1">
                            {emotionIcon((comparisonData as any).opponent?.dominantEmotion ?? "neutral")}
                            {(comparisonData as any).opponent?.dominantEmotion ?? "—"}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">トレンド</span>
                          <Badge variant="outline">{(comparisonData as any).opponent?.sentimentTrend ?? "—"}</Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
