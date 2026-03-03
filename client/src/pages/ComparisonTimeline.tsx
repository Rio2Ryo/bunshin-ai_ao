import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, GitCompare, Trophy, ArrowLeftRight, Clock, BarChart3 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

// Cast trpc to bypass TypeScript for not-yet-implemented backend procedures
const t = trpc as any;

export default function ComparisonTimeline() {
  usePageMeta({ title: "比較タイムライン", description: "マッチングセッション間の比較分析", path: "/comparison-timeline" });

  const [sessionA, setSessionA] = useState<string>("");
  const [sessionB, setSessionB] = useState<string>("");
  const [selectedComparison, setSelectedComparison] = useState<number | null>(null);

  const { data: sessions } = trpc.matching.sessions.useQuery();
  const { data: comparisons, isLoading: listLoading, refetch: refetchComparisons } = t.matching.listComparisonTimelines.useQuery();
  const { data: comparisonDetail, isLoading: detailLoading } = t.matching.getComparisonTimeline.useQuery(
    { comparisonId: selectedComparison! },
    { enabled: !!selectedComparison }
  );

  const createMut = t.matching.createComparisonTimeline.useMutation({
    onSuccess: (data: any) => {
      toast.success("比較を作成しました");
      if (data?.comparisonId) setSelectedComparison(data.comparisonId);
      refetchComparisons();
    },
    onError: (e: any) => toast.error(e.message || "比較作成に失敗しました"),
  });

  const completedSessions = (sessions ?? []).filter((s: any) => s.status === "completed");
  const comparison = createMut.data || comparisonDetail;

  const verdictColor = (v: string) => {
    if (v === "A" || v === "a") return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    if (v === "B" || v === "b") return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300";
  };

  const verdictLabel = (v: string) => {
    if (v === "A" || v === "a") return "A優勢";
    if (v === "B" || v === "b") return "B優勢";
    return "同等";
  };

  // Build chart data from score breakdowns
  const buildChartData = () => {
    if (!comparison?.scoreBreakdownA || !comparison?.scoreBreakdownB) return null;
    const a = comparison.scoreBreakdownA;
    const b = comparison.scoreBreakdownB;
    const dimensions = ["synergy", "innovation", "feasibility", "communication", "growthPotential"];
    const labels: Record<string, string> = {
      synergy: "シナジー",
      innovation: "革新性",
      feasibility: "実現性",
      communication: "コミュ力",
      growthPotential: "成長性",
    };
    return dimensions.map((d) => ({
      name: labels[d] || d,
      "セッションA": a[d] ?? 0,
      "セッションB": b[d] ?? 0,
    }));
  };

  const chartData = comparison ? buildChartData() : null;

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitCompare className="h-6 w-6" /> 比較タイムライン
          </h1>
          <p className="text-muted-foreground text-sm mt-1">2つのマッチングセッションをターン毎に比較分析</p>
        </div>

        <Tabs defaultValue="create">
          <TabsList>
            <TabsTrigger value="create">比較作成</TabsTrigger>
            <TabsTrigger value="history">比較履歴</TabsTrigger>
          </TabsList>

          {/* Tab 1: Create Comparison */}
          <TabsContent value="create" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">セッション選択</CardTitle>
                <CardDescription>比較する2つのマッチングセッションを選択</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-blue-600 dark:text-blue-400">セッションA</label>
                    <Select value={sessionA} onValueChange={setSessionA}>
                      <SelectTrigger className="border-blue-200 dark:border-blue-800">
                        <SelectValue placeholder="セッションAを選択..." />
                      </SelectTrigger>
                      <SelectContent>
                        {completedSessions.map((s: any) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            #{s.id} - {s.theme || "テーマなし"}
                          </SelectItem>
                        ))}
                        {completedSessions.length === 0 && (
                          <SelectItem value="_none" disabled>完了済みセッションなし</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-red-600 dark:text-red-400">セッションB</label>
                    <Select value={sessionB} onValueChange={setSessionB}>
                      <SelectTrigger className="border-red-200 dark:border-red-800">
                        <SelectValue placeholder="セッションBを選択..." />
                      </SelectTrigger>
                      <SelectContent>
                        {completedSessions.map((s: any) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            #{s.id} - {s.theme || "テーマなし"}
                          </SelectItem>
                        ))}
                        {completedSessions.length === 0 && (
                          <SelectItem value="_none" disabled>完了済みセッションなし</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button
                  onClick={() => createMut.mutate({
                    sessionIdA: Number(sessionA),
                    sessionIdB: Number(sessionB),
                  })}
                  disabled={!sessionA || !sessionB || sessionA === sessionB || createMut.isPending}
                >
                  {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowLeftRight className="h-4 w-4 mr-2" />}
                  比較分析を実行
                </Button>
              </CardContent>
            </Card>

            {(createMut.isPending || detailLoading) && (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            )}

            {comparison && (
              <>
                {/* Overall Verdict */}
                <Card className={
                  comparison.overallVerdict === "A" || comparison.overallVerdict === "a"
                    ? "border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-900/10"
                    : comparison.overallVerdict === "B" || comparison.overallVerdict === "b"
                    ? "border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-900/10"
                    : "border-gray-300 dark:border-gray-700"
                }>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <Trophy className="h-6 w-6 text-yellow-500" />
                      <div className="flex-1">
                        <p className="font-bold text-lg">
                          総合判定: {verdictLabel(comparison.overallVerdict)}
                        </p>
                        {comparison.overallReason && (
                          <p className="text-sm text-muted-foreground mt-1">{comparison.overallReason}</p>
                        )}
                      </div>
                      <Badge className={verdictColor(comparison.overallVerdict)}>
                        {comparison.overallVerdict === "A" || comparison.overallVerdict === "a" ? "セッションA" :
                         comparison.overallVerdict === "B" || comparison.overallVerdict === "b" ? "セッションB" : "引き分け"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                {/* Score Comparison Chart */}
                {chartData && chartData.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <BarChart3 className="h-5 w-5" /> スコア比較
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                          <YAxis domain={[0, 20]} tick={{ fontSize: 12 }} />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="セッションA" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
                          <Line type="monotone" dataKey="セッションB" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}

                {/* Key Differences */}
                {comparison.keyDifferences && comparison.keyDifferences.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">主要な相違点</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {comparison.keyDifferences.map((diff: string, i: number) => (
                          <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-muted/50">
                            <ArrowLeftRight className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                            <span className="text-sm">{diff}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Highlights */}
                {comparison.highlights && comparison.highlights.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">ハイライト</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {comparison.highlights.map((h: string, i: number) => (
                          <Badge key={i} variant="secondary">{h}</Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Turn-by-Turn Comparison */}
                {comparison.turns && comparison.turns.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">ターン別比較</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {comparison.turns.map((turn: any, i: number) => (
                        <div key={i} className="grid grid-cols-[1fr_auto_1fr] gap-3 items-start">
                          {/* Session A */}
                          <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-900/10">
                            <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">
                              ターン{i + 1} - A
                            </p>
                            <p className="text-sm">{turn.dialogueA || turn.contentA || "-"}</p>
                          </div>

                          {/* Center Verdict */}
                          <div className="flex items-center justify-center pt-6">
                            <Badge className={`${verdictColor(turn.verdict)} text-xs`}>
                              {verdictLabel(turn.verdict)}
                            </Badge>
                          </div>

                          {/* Session B */}
                          <div className="p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-900/10">
                            <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">
                              ターン{i + 1} - B
                            </p>
                            <p className="text-sm">{turn.dialogueB || turn.contentB || "-"}</p>
                          </div>

                          {/* Analysis Note (full width) */}
                          {turn.analysis && (
                            <div className="col-span-3 pl-4 border-l-2 border-muted">
                              <p className="text-xs text-muted-foreground italic">{turn.analysis}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* Tab 2: Comparison History */}
          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-5 w-5" /> 比較履歴
                </CardTitle>
                <CardDescription>過去に実行した比較分析の一覧</CardDescription>
              </CardHeader>
              <CardContent>
                {listLoading && (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!listLoading && (!comparisons || comparisons.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">比較履歴がまだありません</p>
                )}
                {comparisons && comparisons.length > 0 && (
                  <div className="space-y-3">
                    {comparisons.map((comp: any) => (
                      <div
                        key={comp.id}
                        className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => {
                          setSelectedComparison(comp.id);
                        }}
                      >
                        <GitCompare className="h-5 w-5 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">
                              {comp.themeA || `セッション#${comp.sessionIdA}`}
                            </span>
                            <ArrowLeftRight className="h-3 w-3 text-muted-foreground" />
                            <span className="text-sm font-medium">
                              {comp.themeB || `セッション#${comp.sessionIdB}`}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {comp.createdAt ? new Date(comp.createdAt).toLocaleString("ja-JP") : ""}
                          </p>
                        </div>
                        <Badge className={verdictColor(comp.overallVerdict)}>
                          {comp.overallVerdict === "A" || comp.overallVerdict === "a"
                            ? "A勝利"
                            : comp.overallVerdict === "B" || comp.overallVerdict === "b"
                            ? "B勝利"
                            : "引き分け"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
