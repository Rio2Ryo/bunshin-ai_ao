import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Gauge, Loader2, RefreshCw, TrendingUp, AlertTriangle, Trophy, Zap } from "lucide-react";

export default function TwinBenchmark() {
  usePageMeta({ title: "ベンチマーク", description: "ツインパフォーマンス比較", path: "/benchmark" });

  const [activeTab, setActiveTab] = useState("benchmark");

  const { data: benchmarkData, isLoading, refetch } = trpc.matching.getBenchmark.useQuery(undefined, {
    enabled: activeTab === "benchmark",
  });
  const { data: historyData } = trpc.matching.getBenchmarkHistory.useQuery(undefined, {
    enabled: activeTab === "history",
  });

  const generateMut = trpc.matching.generateBenchmark.useMutation({
    onSuccess: () => {
      toast.success("ベンチマークを生成しました");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const impactColor = (impact: string): "destructive" | "default" | "secondary" => {
    if (impact === "high") return "destructive";
    if (impact === "medium") return "default";
    return "secondary";
  };

  const historyChartData = useMemo(() => {
    if (!historyData || historyData.length === 0) return [];
    return historyData.map((h: any) => ({
      date: h.createdAt ? new Date(h.createdAt).toLocaleDateString("ja-JP", { month: "short", day: "numeric" }) : "",
      percentile: h.overallPercentile ?? 0,
    }));
  }, [historyData]);

  const renderPercentileCircle = (percentile: number) => {
    const radius = 60;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentile / 100) * circumference;
    const color = percentile >= 80 ? "#22c55e" : percentile >= 50 ? "#3b82f6" : "#f97316";

    return (
      <div className="flex justify-center">
        <svg width="160" height="160" className="transform -rotate-90">
          <circle
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            className="text-muted"
          />
          <circle
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
          <text
            x="80"
            y="80"
            textAnchor="middle"
            dominantBaseline="central"
            className="transform rotate-90 origin-center"
            fill={color}
            fontSize="28"
            fontWeight="bold"
          >
            {percentile}%
          </text>
        </svg>
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <Gauge className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">ベンチマーク</h1>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="benchmark">ベンチマーク</TabsTrigger>
            <TabsTrigger value="history">履歴</TabsTrigger>
          </TabsList>

          {/* ベンチマークタブ */}
          <TabsContent value="benchmark" className="space-y-4 mt-4">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !benchmarkData ? (
              <Card>
                <CardContent className="py-12 text-center space-y-4">
                  <Gauge className="h-16 w-16 mx-auto text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground">ベンチマークデータがありません</p>
                  <Button
                    onClick={() => generateMut.mutate()}
                    disabled={generateMut.isPending}
                  >
                    {generateMut.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Zap className="h-4 w-4 mr-2" />
                    )}
                    ベンチマークを生成
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {/* Percentile Circle */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg text-center">総合パーセンタイル</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {renderPercentileCircle(benchmarkData.overallPercentile ?? 0)}
                  </CardContent>
                </Card>

                {/* Industry Percentile */}
                {benchmarkData.industryPercentile != null && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <TrendingUp className="h-5 w-5" />
                        業界別パーセンタイル
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          {benchmarkData.industry || "全業界"}
                        </span>
                        <span className="text-2xl font-bold">
                          {benchmarkData.industryPercentile}%
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Weaknesses */}
                {benchmarkData.weaknesses && benchmarkData.weaknesses.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-amber-500" />
                        改善エリア
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {benchmarkData.weaknesses.map((w: any, i: number) => (
                        <div key={i} className="flex items-start gap-3 p-2 rounded bg-muted/50">
                          <Badge variant={impactColor(w.priority || "low")} className="mt-0.5 shrink-0">
                            {w.priority === "high" ? "高" : w.priority === "medium" ? "中" : "低"}
                          </Badge>
                          <div className="flex-1">
                            <p className="text-sm font-medium">{w.area}</p>
                            <p className="text-xs text-muted-foreground">{w.suggestion}</p>
                            {w.score != null && (
                              <span className="text-xs text-muted-foreground">スコア: {w.score}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Top 10% Patterns */}
                {benchmarkData.topPatterns && benchmarkData.topPatterns.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Trophy className="h-5 w-5 text-yellow-500" />
                        トップ10%の特徴
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {benchmarkData.topPatterns.map((pattern: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="text-primary mt-0.5">•</span>
                            <span>{pattern}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Improvements */}
                {benchmarkData.improvements && benchmarkData.improvements.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Zap className="h-5 w-5" />
                        改善アクション
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {benchmarkData.improvements.map((imp: any, i: number) => (
                        <div key={i} className="border rounded-lg p-3 space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant={impactColor(imp.impact || "low")}>
                              {imp.impact === "high" ? "高効果" : imp.impact === "medium" ? "中効果" : "低効果"}
                            </Badge>
                            <p className="text-sm font-medium">{imp.action}</p>
                          </div>
                          {imp.description && (
                            <p className="text-xs text-muted-foreground">{imp.description}</p>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Summary */}
                {benchmarkData.summary && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">サマリー</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{benchmarkData.summary}</p>
                    </CardContent>
                  </Card>
                )}

                {/* Regenerate */}
                <Button
                  onClick={() => generateMut.mutate()}
                  disabled={generateMut.isPending}
                  variant="outline"
                  className="w-full"
                >
                  {generateMut.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  再分析
                </Button>
              </div>
            )}
          </TabsContent>

          {/* 履歴タブ */}
          <TabsContent value="history" className="space-y-4 mt-4">
            {!historyData || historyData.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Gauge className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>ベンチマーク履歴がありません</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">パーセンタイル推移</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={historyChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" fontSize={12} />
                        <YAxis domain={[0, 100]} fontSize={12} />
                        <Tooltip />
                        <Bar dataKey="percentile" fill="#3b82f6" name="パーセンタイル" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <div className="space-y-2">
                  {historyData.map((h: any, i: number) => (
                    <Card key={h.id || i}>
                      <CardContent className="py-3 flex items-center justify-between">
                        <div>
                          <p className="font-medium">
                            パーセンタイル: {h.overallPercentile ?? "-"}%
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {h.createdAt ? new Date(h.createdAt).toLocaleDateString("ja-JP") : ""}
                          </span>
                        </div>
                        {i > 0 && historyData[i - 1]?.overallPercentile != null && (
                          <Badge
                            variant={
                              (h.overallPercentile ?? 0) >= (historyData[i - 1].overallPercentile ?? 0)
                                ? "default"
                                : "destructive"
                            }
                          >
                            {(h.overallPercentile ?? 0) - (historyData[i - 1]?.overallPercentile ?? 0) >= 0
                              ? "+"
                              : ""}
                            {(h.overallPercentile ?? 0) - (historyData[i - 1]?.overallPercentile ?? 0)}
                          </Badge>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
