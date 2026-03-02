import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, GitCompare, Trophy, AlertTriangle, Lightbulb, ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

export default function ScenarioComparison() {
  usePageMeta({ title: "シナリオ比較", description: "マッチングシナリオを並列比較", path: "/scenario-compare" });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const { data: sessions } = trpc.matching.sessions.useQuery();
  const { data: comparisons, refetch: refetchComparisons } = trpc.matching.listComparisons.useQuery();
  const compareMut = trpc.matching.compareScenarios.useMutation({
    onSuccess: () => { refetchComparisons(); toast.success("比較分析が完了しました"); setSelectedIds([]); },
    onError: (e) => toast.error(e.message),
  });

  const completedSessions = (sessions ?? []).filter((s: any) => s.status === "completed");

  const toggleSession = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 5 ? [...prev, id] : prev);
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><GitCompare className="h-6 w-6" /> シナリオ比較</h1>
          <p className="text-muted-foreground text-sm mt-1">異なる設定のマッチングを並列比較して最適解を発見</p>
        </div>

        <Tabs defaultValue="compare">
          <TabsList>
            <TabsTrigger value="compare">新規比較</TabsTrigger>
            <TabsTrigger value="history">比較履歴</TabsTrigger>
          </TabsList>

          <TabsContent value="compare" className="space-y-4 mt-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">セッションを選択（2〜5件）</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {completedSessions.length === 0 && <p className="text-sm text-muted-foreground">完了済みのマッチングセッションがありません</p>}
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {completedSessions.map((s: any) => (
                    <label key={s.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
                      <Checkbox checked={selectedIds.includes(s.id)} onCheckedChange={() => toggleSession(s.id)} />
                      <div className="flex-1">
                        <span className="text-sm font-medium">{s.theme || `セッション #${s.id}`}</span>
                        <span className="text-xs text-muted-foreground ml-2">スコア: {s.compatibilityScore ?? "-"}</span>
                      </div>
                      <Badge variant="outline" className="text-xs">{s.createdAt?.slice(0, 10)}</Badge>
                    </label>
                  ))}
                </div>
                <Button onClick={() => compareMut.mutate({ sessionIds: selectedIds })} disabled={selectedIds.length < 2 || compareMut.isPending} className="w-full mt-2">
                  {compareMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <GitCompare className="h-4 w-4 mr-2" />}
                  {selectedIds.length}件を比較分析
                </Button>
              </CardContent>
            </Card>

            {compareMut.data && <ComparisonResult data={compareMut.data} />}
          </TabsContent>

          <TabsContent value="history" className="space-y-4 mt-4">
            {(comparisons ?? []).length === 0 && <p className="text-center text-muted-foreground py-8">比較履歴がありません</p>}
            {(comparisons ?? []).map((c: any) => (
              <Card key={c.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{c.theme}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{(c.sessionIds ?? []).length}件比較</Badge>
                      <span className="text-xs text-muted-foreground">{c.createdAt?.slice(0, 10)}</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{c.comparison?.overallInsight || "分析データなし"}</p>
                  {c.bestSettingAdvice?.recommendedApproach && (
                    <div className="mt-2 flex items-center gap-2"><Lightbulb className="h-4 w-4 text-yellow-500" /><span className="text-sm">{c.bestSettingAdvice.recommendedApproach}</span></div>
                  )}
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function ComparisonResult({ data }: { data: any }) {
  const { sessionsData, comparison } = data;
  if (!comparison) return null;

  const chartData = (sessionsData ?? []).map((s: any, i: number) => {
    const bd = s.scoreBreakdown || {};
    return { name: `#${s.sessionId}`, score: s.score, ...bd };
  });

  return (
    <div className="space-y-4">
      {chartData.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">スコア比較</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Bar dataKey="score" name="総合スコア" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {comparison.sessions?.map((s: any, i: number) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              セッション #{s.sessionId}
              {comparison.diffHighlights?.some((d: any) => d.winner === s.sessionId) && <Trophy className="h-4 w-4 text-yellow-500" />}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {s.strengths?.length > 0 && (
              <div><span className="text-xs font-medium text-green-600">強み:</span>
                <ul className="text-sm text-muted-foreground list-disc ml-4">{s.strengths.map((st: string, j: number) => <li key={j}>{st}</li>)}</ul>
              </div>
            )}
            {s.weaknesses?.length > 0 && (
              <div><span className="text-xs font-medium text-red-600">弱み:</span>
                <ul className="text-sm text-muted-foreground list-disc ml-4">{s.weaknesses.map((w: string, j: number) => <li key={j}>{w}</li>)}</ul>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {comparison.diffHighlights?.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">差分ハイライト</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {comparison.diffHighlights.map((d: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                <div><span className="font-medium">{d.aspect}:</span> {d.details} {d.winner && <Badge variant="secondary" className="text-xs ml-1">勝者: #{d.winner}</Badge>}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {comparison.bestSetting && (
        <Card className="border-primary/30">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Lightbulb className="h-4 w-4 text-yellow-500" /> 最適設定の提案</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {comparison.bestSetting.recommendedTurns && <p className="text-sm"><span className="font-medium">推奨ターン数:</span> {comparison.bestSetting.recommendedTurns}</p>}
            {comparison.bestSetting.recommendedApproach && <p className="text-sm"><span className="font-medium">推奨アプローチ:</span> {comparison.bestSetting.recommendedApproach}</p>}
            {comparison.bestSetting.reasoning && <p className="text-sm text-muted-foreground">{comparison.bestSetting.reasoning}</p>}
          </CardContent>
        </Card>
      )}

      {comparison.overallInsight && (
        <Card>
          <CardHeader><CardTitle className="text-base">総合所見</CardTitle></CardHeader>
          <CardContent><p className="text-sm">{comparison.overallInsight}</p></CardContent>
        </Card>
      )}
    </div>
  );
}
