import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { TrendingUp, DollarSign, Target, Users, Loader2, Trash2, Sparkles, BarChart3 } from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

export default function ROIDashboard() {
  usePageMeta({ title: "ROIダッシュボード", description: "マッチングの投資対効果を分析", path: "/roi" });

  const { data: roiData, isLoading } = trpc.matching.getROIData.useQuery();
  const { data: goals, refetch: refetchGoals } = trpc.matching.getROIGoals.useQuery();

  const setGoalMut = trpc.matching.setROIGoal.useMutation({
    onSuccess: () => { refetchGoals(); toast.success("目標を設定しました"); setGoalForm({ targetAmount: "", targetMatchCount: "", period: "monthly", label: "" }); },
    onError: (e) => toast.error(e.message),
  });
  const deleteGoalMut = trpc.matching.deleteROIGoal.useMutation({
    onSuccess: () => { refetchGoals(); toast.success("目標を削除しました"); },
    onError: (e) => toast.error(e.message),
  });
  const suggestionsMut = trpc.matching.getROISuggestions.useMutation({
    onError: (e) => toast.error(e.message),
  });

  const [goalForm, setGoalForm] = useState({ targetAmount: "", targetMatchCount: "", period: "monthly", label: "" });
  const [trendPeriod, setTrendPeriod] = useState<"monthly" | "quarterly">("monthly");

  const totalMatchings = roiData?.totalMatchings ?? 0;
  const totalOutcome = roiData?.totalOutcome ?? 0;
  const avgROI = totalMatchings > 0 ? Math.round(totalOutcome / totalMatchings) : 0;
  const friendRanking = roiData?.friendRanking ?? [];
  const monthly = roiData?.monthly ?? [];

  // Quarterly aggregation for trend view
  const quarterlyData = (() => {
    const qMap: Record<string, { quarter: string; totalAmount: number; avgScore: number; scores: number[] }> = {};
    for (const m of monthly) {
      const [y, mo] = m.month.split("-");
      const q = `${y}-Q${Math.ceil(Number(mo) / 3)}`;
      if (!qMap[q]) qMap[q] = { quarter: q, totalAmount: 0, avgScore: 0, scores: [] };
      qMap[q].totalAmount += m.totalAmount;
      if (m.avgScore) qMap[q].scores.push(m.avgScore);
    }
    return Object.values(qMap).map((q) => ({
      ...q,
      avgScore: q.scores.length ? Math.round(q.scores.reduce((a, b) => a + b, 0) / q.scores.length) : 0,
    }));
  })();

  // Goal achievement rate
  const goalAchievementRate = (() => {
    if (!goals || goals.length === 0) return 0;
    let achieved = 0;
    for (const g of goals as any[]) {
      const targetAmt = g.targetAmount || 0;
      const targetCount = g.targetMatchCount || 0;
      const amtOk = targetAmt === 0 || totalOutcome >= targetAmt;
      const cntOk = targetCount === 0 || totalMatchings >= targetCount;
      if (amtOk && cntOk) achieved++;
    }
    return Math.round((achieved / goals.length) * 100);
  })();

  const impactColor = (impact: string) => {
    switch (impact) {
      case "high": return "destructive";
      case "medium": return "secondary";
      case "low": return "outline";
      default: return "secondary";
    }
  };

  const impactLabel = (impact: string) => {
    switch (impact) {
      case "high": return "高";
      case "medium": return "中";
      case "low": return "低";
      default: return impact;
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6" /> ROIダッシュボード
          </h1>
          <p className="text-muted-foreground text-sm mt-1">マッチングの投資対効果を分析</p>
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">概要</TabsTrigger>
            <TabsTrigger value="friends">友達別ROI</TabsTrigger>
            <TabsTrigger value="trends">トレンド</TabsTrigger>
            <TabsTrigger value="goals">目標設定</TabsTrigger>
          </TabsList>

          {/* ===== 概要タブ ===== */}
          <TabsContent value="overview" className="space-y-6 mt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <Users className="h-4 w-4" /> 総マッチング数
                  </div>
                  <p className="text-2xl font-bold">{totalMatchings}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <DollarSign className="h-4 w-4" /> 総成果金額
                  </div>
                  <p className="text-2xl font-bold">{totalOutcome.toLocaleString()}円</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <BarChart3 className="h-4 w-4" /> 平均ROI
                  </div>
                  <p className="text-2xl font-bold">{avgROI.toLocaleString()}円</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <Target className="h-4 w-4" /> 目標達成率
                  </div>
                  <p className="text-2xl font-bold">{goalAchievementRate}%</p>
                </CardContent>
              </Card>
            </div>

            {monthly.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-lg">月次推移</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={monthly}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis yAxisId="left" />
                      <YAxis yAxisId="right" orientation="right" />
                      <Tooltip />
                      <Legend />
                      <Bar yAxisId="left" dataKey="matchCount" fill="#6366f1" name="マッチング数" />
                      <Bar yAxisId="right" dataKey="totalAmount" fill="#10b981" name="成果金額" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {monthly.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  まだマッチングデータがありません。マッチングを実行してROIを確認しましょう。
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ===== 友達別ROIタブ ===== */}
          <TabsContent value="friends" className="space-y-4 mt-4">
            {friendRanking.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  友達別ROIデータがまだありません。
                </CardContent>
              </Card>
            )}
            {friendRanking.map((f: any, i: number) => (
              <Card key={f.friendId}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{f.friendName}</p>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
                        <span>成果: {f.totalOutcomeAmount.toLocaleString()}円</span>
                        <span>回数: {f.matchCount}</span>
                        <span>平均スコア: {f.avgScore}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {friendRanking.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-lg">友達別成果比較</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={friendRanking.slice(0, 10)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="friendName" type="category" width={100} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="totalOutcomeAmount" fill="#6366f1" name="成果金額" />
                      <Bar dataKey="matchCount" fill="#10b981" name="マッチング回数" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ===== トレンドタブ ===== */}
          <TabsContent value="trends" className="space-y-4 mt-4">
            <div className="flex items-center gap-2">
              <Button variant={trendPeriod === "monthly" ? "default" : "outline"} size="sm" onClick={() => setTrendPeriod("monthly")}>
                月次
              </Button>
              <Button variant={trendPeriod === "quarterly" ? "default" : "outline"} size="sm" onClick={() => setTrendPeriod("quarterly")}>
                四半期
              </Button>
            </div>

            {trendPeriod === "monthly" && monthly.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-lg">月次トレンド</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={monthly}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis yAxisId="left" />
                      <YAxis yAxisId="right" orientation="right" />
                      <Tooltip />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="totalAmount" stroke="#6366f1" name="成果金額" strokeWidth={2} />
                      <Line yAxisId="right" type="monotone" dataKey="avgScore" stroke="#f59e0b" name="平均スコア" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {trendPeriod === "quarterly" && quarterlyData.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-lg">四半期トレンド</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={quarterlyData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="quarter" />
                      <YAxis yAxisId="left" />
                      <YAxis yAxisId="right" orientation="right" />
                      <Tooltip />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="totalAmount" stroke="#6366f1" name="成果金額" strokeWidth={2} />
                      <Line yAxisId="right" type="monotone" dataKey="avgScore" stroke="#f59e0b" name="平均スコア" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {monthly.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  トレンドデータがまだありません。
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ===== 目標設定タブ ===== */}
          <TabsContent value="goals" className="space-y-6 mt-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">新しい目標を作成</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>ラベル</Label>
                    <Input
                      placeholder="目標名（任意）"
                      value={goalForm.label}
                      onChange={(e) => setGoalForm({ ...goalForm, label: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>期間</Label>
                    <Select value={goalForm.period} onValueChange={(v) => setGoalForm({ ...goalForm, period: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">月次</SelectItem>
                        <SelectItem value="quarterly">四半期</SelectItem>
                        <SelectItem value="yearly">年次</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>目標金額（円）</Label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={goalForm.targetAmount}
                      onChange={(e) => setGoalForm({ ...goalForm, targetAmount: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>目標マッチング数</Label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={goalForm.targetMatchCount}
                      onChange={(e) => setGoalForm({ ...goalForm, targetMatchCount: e.target.value })}
                    />
                  </div>
                </div>
                <Button
                  onClick={() => setGoalMut.mutate({
                    targetAmount: Number(goalForm.targetAmount) || 0,
                    targetMatchCount: Number(goalForm.targetMatchCount) || 0,
                    period: goalForm.period as "monthly" | "quarterly" | "yearly",
                    label: goalForm.label || undefined,
                  })}
                  disabled={setGoalMut.isPending}
                  className="w-full"
                >
                  {setGoalMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Target className="h-4 w-4 mr-2" />}
                  目標を設定
                </Button>
              </CardContent>
            </Card>

            {/* Active Goals */}
            {(goals ?? []).length > 0 && (
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">アクティブな目標</h3>
                {(goals as any[]).map((g: any) => {
                  const amtProgress = g.targetAmount > 0 ? Math.min(100, Math.round((totalOutcome / g.targetAmount) * 100)) : 100;
                  const cntProgress = g.targetMatchCount > 0 ? Math.min(100, Math.round((totalMatchings / g.targetMatchCount) * 100)) : 100;
                  const periodLabel = g.period === "monthly" ? "月次" : g.period === "quarterly" ? "四半期" : "年次";
                  return (
                    <Card key={g.id}>
                      <CardContent className="pt-4 pb-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold">{g.label || "目標"}</p>
                            <Badge variant="outline" className="mt-1">{periodLabel}</Badge>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteGoalMut.mutate({ goalId: g.id })}
                            disabled={deleteGoalMut.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                        {g.targetAmount > 0 && (
                          <div>
                            <div className="flex justify-between text-sm text-muted-foreground mb-1">
                              <span>金額: {totalOutcome.toLocaleString()} / {g.targetAmount.toLocaleString()}円</span>
                              <span>{amtProgress}%</span>
                            </div>
                            <Progress value={amtProgress} />
                          </div>
                        )}
                        {g.targetMatchCount > 0 && (
                          <div>
                            <div className="flex justify-between text-sm text-muted-foreground mb-1">
                              <span>回数: {totalMatchings} / {g.targetMatchCount}</span>
                              <span>{cntProgress}%</span>
                            </div>
                            <Progress value={cntProgress} />
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* AI Suggestions */}
            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Sparkles className="h-5 w-5" /> AI提案</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <Button
                  onClick={() => suggestionsMut.mutate()}
                  disabled={suggestionsMut.isPending}
                  variant="outline"
                  className="w-full"
                >
                  {suggestionsMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  AI提案を生成
                </Button>
                {suggestionsMut.data?.suggestions && (
                  <div className="space-y-3">
                    {suggestionsMut.data.suggestions.map((s: any, i: number) => (
                      <Card key={i} className="border-l-4" style={{ borderLeftColor: s.impact === "high" ? "#ef4444" : s.impact === "medium" ? "#f59e0b" : "#22c55e" }}>
                        <CardContent className="pt-3 pb-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-sm">{s.title}</p>
                              <p className="text-sm text-muted-foreground mt-1">{s.description}</p>
                            </div>
                            <Badge variant={impactColor(s.impact) as any}>
                              {impactLabel(s.impact)}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
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
