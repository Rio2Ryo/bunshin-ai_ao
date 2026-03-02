import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { GitBranch, Clock, Trophy, Brain, Zap, TrendingUp, Loader2, Sparkles, ArrowUp, ArrowDown, Minus, BookOpen } from "lucide-react";

const eventTypeConfig: Record<string, { color: string; bgColor: string; icon: React.ElementType; label: string }> = {
  milestone: { color: "text-yellow-600", bgColor: "bg-yellow-100 dark:bg-yellow-900/30", icon: Trophy, label: "マイルストーン" },
  personality_change: { color: "text-purple-600", bgColor: "bg-purple-100 dark:bg-purple-900/30", icon: Brain, label: "人格変化" },
  skill_up: { color: "text-blue-600", bgColor: "bg-blue-100 dark:bg-blue-900/30", icon: Zap, label: "スキルアップ" },
  matching: { color: "text-green-600", bgColor: "bg-green-100 dark:bg-green-900/30", icon: TrendingUp, label: "マッチング" },
  knowledge_added: { color: "text-cyan-600", bgColor: "bg-cyan-100 dark:bg-cyan-900/30", icon: BookOpen, label: "知識追加" },
};

export default function TwinEvolution() {
  usePageMeta({ title: "ツイン進化マップ", description: "ツインの成長履歴と進化パスを可視化", path: "/evolution" });

  const [activeTab, setActiveTab] = useState("timeline");
  const [period, setPeriod] = useState<"week" | "month" | "quarter">("month");

  // Timeline data
  const { data: timelineData, isLoading: timelineLoading } = trpc.myTwin.getEvolutionTimeline.useQuery();

  // Comparison data
  const { data: comparisonData, isLoading: comparisonLoading } = trpc.myTwin.getEvolutionComparison.useQuery(
    { period },
    { enabled: activeTab === "comparison" }
  );

  // Prediction
  const predictMut = trpc.myTwin.predictEvolutionPath.useMutation();
  const [predictions, setPredictions] = useState<any>(null);

  const handlePredict = async () => {
    try {
      const result = await predictMut.mutateAsync();
      setPredictions(result);
      toast.success("進化予測を生成しました");
    } catch (e: any) {
      toast.error(e.message || "予測生成に失敗しました");
    }
  };

  const timeline = (timelineData as any)?.events ?? [];
  const comparison = comparisonData as any;

  const getLikelihoodColor = (likelihood: string) => {
    switch (likelihood) {
      case "high": return "bg-green-500/10 text-green-700 border-green-300";
      case "medium": return "bg-yellow-500/10 text-yellow-700 border-yellow-300";
      case "low": return "bg-red-500/10 text-red-700 border-red-300";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getLikelihoodLabel = (likelihood: string) => {
    switch (likelihood) {
      case "high": return "高確率";
      case "medium": return "中確率";
      case "low": return "低確率";
      default: return likelihood;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitBranch className="h-6 w-6 text-primary" />
            ツイン進化マップ
          </h1>
          <p className="text-muted-foreground mt-1">ツインの成長履歴と進化パスを可視化します</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="timeline">タイムライン</TabsTrigger>
            <TabsTrigger value="comparison">比較</TabsTrigger>
            <TabsTrigger value="prediction">予測</TabsTrigger>
          </TabsList>

          {/* Timeline Tab */}
          <TabsContent value="timeline" className="space-y-4">
            {timelineLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : timeline.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <GitBranch className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">まだ進化イベントがありません</p>
                  <p className="text-sm text-muted-foreground mt-1">マッチングやスキルアップを行うと記録されます</p>
                </CardContent>
              </Card>
            ) : (
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-border" />

                <div className="space-y-6">
                  {timeline.map((event: any, i: number) => {
                    const config = eventTypeConfig[event.type] ?? eventTypeConfig.milestone;
                    const IconComp = config.icon;
                    return (
                      <div key={i} className="relative flex gap-4 pl-2">
                        {/* Timeline dot */}
                        <div className={`relative z-10 h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 ${config.bgColor} ring-4 ring-background`}>
                          <IconComp className={`h-4 w-4 ${config.color}`} />
                        </div>
                        {/* Event card */}
                        <Card className="flex-1">
                          <CardContent className="py-3 px-4">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <h3 className="font-medium text-sm">{event.title}</h3>
                                  <Badge variant="outline" className={`text-xs ${config.color}`}>
                                    {config.label}
                                  </Badge>
                                </div>
                                <p className="text-sm text-muted-foreground">{event.description}</p>
                              </div>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                                <Clock className="h-3 w-3" />
                                {event.date ? new Date(event.date).toLocaleDateString("ja-JP") : ""}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Comparison Tab */}
          <TabsContent value="comparison" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">期間比較</h2>
              <Select value={period} onValueChange={(v) => setPeriod(v as "week" | "month" | "quarter")}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">週間</SelectItem>
                  <SelectItem value="month">月間</SelectItem>
                  <SelectItem value="quarter">四半期</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {comparisonLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : !comparison ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">比較データがありません</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  {/* Before card */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        Before
                      </CardTitle>
                      <CardDescription>期間開始時点</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">平均スコア</span>
                        <span className="font-medium">{comparison.before?.avgScore ?? "-"}%</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">スキル数</span>
                        <span className="font-medium">{comparison.before?.skillCount ?? 0}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">知識数</span>
                        <span className="font-medium">{comparison.before?.knowledgeCount ?? 0}</span>
                      </div>
                      {comparison.before?.personality && (
                        <div className="text-sm">
                          <span className="text-muted-foreground">人格:</span>
                          <p className="mt-1 text-xs bg-muted rounded p-2">{comparison.before.personality}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* After card */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        After
                      </CardTitle>
                      <CardDescription>現在</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">平均スコア</span>
                        <div className="flex items-center gap-1">
                          <span className="font-medium">{comparison.after?.avgScore ?? "-"}%</span>
                          {comparison.before?.avgScore != null && comparison.after?.avgScore != null && (
                            <ChangeIndicator before={comparison.before.avgScore} after={comparison.after.avgScore} />
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">スキル数</span>
                        <div className="flex items-center gap-1">
                          <span className="font-medium">{comparison.after?.skillCount ?? 0}</span>
                          {comparison.before?.skillCount != null && comparison.after?.skillCount != null && (
                            <ChangeIndicator before={comparison.before.skillCount} after={comparison.after.skillCount} />
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">知識数</span>
                        <div className="flex items-center gap-1">
                          <span className="font-medium">{comparison.after?.knowledgeCount ?? 0}</span>
                          {comparison.before?.knowledgeCount != null && comparison.after?.knowledgeCount != null && (
                            <ChangeIndicator before={comparison.before.knowledgeCount} after={comparison.after.knowledgeCount} />
                          )}
                        </div>
                      </div>
                      {comparison.after?.personality && (
                        <div className="text-sm">
                          <span className="text-muted-foreground">人格:</span>
                          <p className="mt-1 text-xs bg-muted rounded p-2">{comparison.after.personality}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Chart if data available */}
                {comparison.chartData && comparison.chartData.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">スコア推移</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={comparison.chartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 12 }} />
                          <Tooltip />
                          <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* Prediction Tab */}
          <TabsContent value="prediction" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">進化予測</h2>
                <p className="text-sm text-muted-foreground">AIがツインの成長パスを予測します</p>
              </div>
              <Button onClick={handlePredict} disabled={predictMut.isPending}>
                {predictMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                予測を生成
              </Button>
            </div>

            {!predictions ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">「予測を生成」ボタンを押して進化予測を確認しましょう</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Trajectory */}
                {predictions.trajectory && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-primary" />
                        全体の成長軌跡
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm">{predictions.trajectory}</p>
                    </CardContent>
                  </Card>
                )}

                {/* Prediction milestones */}
                {predictions.milestones && predictions.milestones.length > 0 && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {predictions.milestones.map((m: any, i: number) => (
                      <Card key={i}>
                        <CardContent className="py-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <h3 className="font-medium text-sm">{m.name}</h3>
                            <Badge className={`text-xs ${getLikelihoodColor(m.likelihood)}`}>
                              {getLikelihoodLabel(m.likelihood)}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mb-2">{m.description}</p>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {m.timeframe}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {/* Suggested actions */}
                {predictions.suggestedActions && predictions.suggestedActions.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">推奨アクション</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {predictions.suggestedActions.map((action: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <Zap className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                            <span>{action}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function ChangeIndicator({ before, after }: { before: number; after: number }) {
  const diff = after - before;
  if (diff > 0) {
    return (
      <span className="flex items-center text-xs text-green-600">
        <ArrowUp className="h-3 w-3" />+{diff}
      </span>
    );
  }
  if (diff < 0) {
    return (
      <span className="flex items-center text-xs text-red-600">
        <ArrowDown className="h-3 w-3" />{diff}
      </span>
    );
  }
  return (
    <span className="flex items-center text-xs text-muted-foreground">
      <Minus className="h-3 w-3" />0
    </span>
  );
}
