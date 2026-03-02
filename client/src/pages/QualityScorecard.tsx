import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { Award, TrendingUp, Loader2, RefreshCw, CheckCircle, AlertTriangle, Lightbulb } from "lucide-react";

// Cast trpc to bypass TypeScript for not-yet-implemented backend procedures
const t = trpc as any;

function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400";
  if (score >= 60) return "text-yellow-600 dark:text-yellow-400";
  if (score >= 40) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

function getScoreLabel(score: number): string {
  if (score >= 80) return "優秀";
  if (score >= 60) return "良好";
  if (score >= 40) return "改善余地あり";
  return "要改善";
}

function getScoreBadgeVariant(score: number): "default" | "secondary" | "destructive" | "outline" {
  if (score >= 80) return "default";
  if (score >= 60) return "secondary";
  return "destructive";
}

export default function QualityScorecard() {
  usePageMeta({ title: "品質スコアカード", description: "マッチング対話の品質を多軸評価", path: "/quality" });

  const [selectedSessionId, setSelectedSessionId] = useState<string>("");

  // Fetch matching sessions
  const { data: sessionsData, isLoading: sessionsLoading } = trpc.matching.sessions.useQuery();
  const sessions = (sessionsData as any[]) ?? [];
  const completedSessions = sessions.filter((s: any) => s.status === "completed");

  // Fetch quality score for selected session
  const { data: qualityData, isLoading: qualityLoading } = t.matching.getQualityScore.useQuery(
    { sessionId: selectedSessionId },
    { enabled: !!selectedSessionId }
  );

  // Fetch quality trend
  const { data: trendData, isLoading: trendLoading } = t.matching.getQualityTrend.useQuery();

  // Evaluate quality mutation
  const evaluateMut = t.matching.evaluateQuality.useMutation({
    onSuccess: () => {
      toast.success("品質評価が完了しました");
    },
    onError: (err: any) => {
      toast.error(err.message || "品質評価に失敗しました");
    },
  });

  const handleEvaluate = () => {
    if (!selectedSessionId) {
      toast.error("セッションを選択してください");
      return;
    }
    evaluateMut.mutate({ sessionId: selectedSessionId });
  };

  const quality = qualityData as any;
  const trend = (trendData as any[]) ?? [];

  // Prepare radar chart data
  const radarData = quality?.breakdown
    ? [
        { axis: "論理性", value: quality.breakdown.logic ?? 0, fullMark: 100 },
        { axis: "創造性", value: quality.breakdown.creativity ?? 0, fullMark: 100 },
        { axis: "協調性", value: quality.breakdown.cooperation ?? 0, fullMark: 100 },
        { axis: "具体性", value: quality.breakdown.specificity ?? 0, fullMark: 100 },
        { axis: "実行可能性", value: quality.breakdown.feasibility ?? 0, fullMark: 100 },
      ]
    : [];

  // Prepare trend chart data
  const trendChartData = trend.map((item: any) => ({
    date: item.date ? new Date(item.date).toLocaleDateString("ja-JP", { month: "short", day: "numeric" }) : "",
    quality: item.overallQuality ?? 0,
    theme: item.theme ?? "",
  }));

  return (
    <DashboardLayout>
      <main id="main-content" className="flex-1 overflow-auto">
        <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <Award className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">品質スコアカード</h1>
              <p className="text-sm text-muted-foreground">マッチング対話の品質を多軸評価して改善ポイントを把握</p>
            </div>
          </div>

          {/* Session selector + evaluate */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">セッション選択</CardTitle>
              <CardDescription>品質評価するマッチングセッションを選んでください</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-3">
                <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={sessionsLoading ? "読み込み中..." : "セッションを選択"} />
                  </SelectTrigger>
                  <SelectContent>
                    {completedSessions.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.theme || `セッション #${s.id}`} — {s.status === "completed" ? "完了" : s.status}
                      </SelectItem>
                    ))}
                    {completedSessions.length === 0 && (
                      <SelectItem value="__none" disabled>
                        完了済みセッションがありません
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleEvaluate}
                  disabled={!selectedSessionId || evaluateMut.isPending}
                >
                  {evaluateMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  品質を評価
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Quality results */}
          {qualityLoading && selectedSessionId && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {quality && (
            <div className="grid gap-6 md:grid-cols-2">
              {/* Overall Score */}
              <Card className="md:col-span-2">
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                      <svg viewBox="0 0 120 120" className="h-32 w-32">
                        <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/20" />
                        <circle
                          cx="60"
                          cy="60"
                          r="50"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="8"
                          strokeDasharray={`${(quality.overallScore ?? 0) * 3.14} 314`}
                          strokeLinecap="round"
                          transform="rotate(-90 60 60)"
                          className={getScoreColor(quality.overallScore ?? 0)}
                        />
                        <text x="60" y="55" textAnchor="middle" className="fill-foreground text-2xl font-bold" fontSize="24">
                          {quality.overallScore ?? 0}
                        </text>
                        <text x="60" y="75" textAnchor="middle" className="fill-muted-foreground text-xs" fontSize="11">
                          / 100
                        </text>
                      </svg>
                    </div>
                    <div className="text-center">
                      <Badge variant={getScoreBadgeVariant(quality.overallScore ?? 0)} className="text-sm px-3 py-1">
                        {getScoreLabel(quality.overallScore ?? 0)}
                      </Badge>
                      <p className="mt-2 text-sm text-muted-foreground max-w-md">
                        {quality.summary || "品質評価の概要がここに表示されます"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Radar Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">多軸評価</CardTitle>
                  <CardDescription>5つの観点からの品質スコア</CardDescription>
                </CardHeader>
                <CardContent>
                  {radarData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                        <PolarGrid strokeDasharray="3 3" />
                        <PolarAngleAxis dataKey="axis" tick={{ fontSize: 12 }} />
                        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10 }} />
                        <Radar
                          name="品質スコア"
                          dataKey="value"
                          stroke="#8b5cf6"
                          fill="#8b5cf6"
                          fillOpacity={0.3}
                          strokeWidth={2}
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">
                      評価データがありません
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Strengths / Weaknesses / Improvements */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">評価詳細</CardTitle>
                  <CardDescription>強み・弱み・改善提案</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Strengths */}
                  {quality.strengths && quality.strengths.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-green-600 dark:text-green-400 mb-2 flex items-center gap-1.5">
                        <CheckCircle className="h-4 w-4" />
                        強み
                      </h4>
                      <ul className="space-y-1.5">
                        {quality.strengths.map((item: string, i: number) => (
                          <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                            <CheckCircle className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Weaknesses */}
                  {quality.weaknesses && quality.weaknesses.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-orange-600 dark:text-orange-400 mb-2 flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4" />
                        課題
                      </h4>
                      <ul className="space-y-1.5">
                        {quality.weaknesses.map((item: string, i: number) => (
                          <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                            <AlertTriangle className="h-3.5 w-3.5 text-orange-500 mt-0.5 shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Improvements */}
                  {quality.improvements && quality.improvements.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-2 flex items-center gap-1.5">
                        <Lightbulb className="h-4 w-4" />
                        改善提案
                      </h4>
                      <ul className="space-y-1.5">
                        {quality.improvements.map((item: string, i: number) => (
                          <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                            <Lightbulb className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {!quality.strengths?.length && !quality.weaknesses?.length && !quality.improvements?.length && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      詳細な評価データがありません
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* No session selected placeholder */}
          {!selectedSessionId && !quality && (
            <Card>
              <CardContent className="py-12">
                <div className="text-center space-y-3">
                  <Award className="h-12 w-12 text-muted-foreground/40 mx-auto" />
                  <p className="text-muted-foreground">セッションを選択して品質評価を開始してください</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Quality Trend */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    品質トレンド
                  </CardTitle>
                  <CardDescription>セッションごとの品質スコア推移</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {trendLoading ? (
                <div className="flex items-center justify-center h-[250px]">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : trendChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={trendChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
                      formatter={(value: number) => [`${value}点`, "品質スコア"]}
                      labelFormatter={(label: string, payload: any[]) => {
                        const theme = payload?.[0]?.payload?.theme;
                        return theme ? `${label} — ${theme}` : label;
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="quality"
                      name="品質スコア"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      dot={{ r: 4, fill: "#8b5cf6" }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
                  トレンドデータがまだありません。品質評価を実行するとここに表示されます。
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </DashboardLayout>
  );
}
