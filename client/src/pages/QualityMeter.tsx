import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Gauge, Lightbulb, TrendingUp, Loader2 } from "lucide-react";
import { toast } from "sonner";

const AXES = [
  { key: "logic", label: "論理性", color: "#3b82f6" },
  { key: "specificity", label: "具体性", color: "#10b981" },
  { key: "creativity", label: "創造性", color: "#f59e0b" },
  { key: "cooperation", label: "協調性", color: "#ec4899" },
];

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs w-12">{label}</span>
      <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono w-8 text-right">{value}</span>
    </div>
  );
}

export default function QualityMeter() {
  const [tab, setTab] = useState("score");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const sessions = trpc.matching.sessions.useQuery();
  const quality = trpc.matching.getDialogueQuality.useQuery({ sessionId: sessionId! }, { enabled: !!sessionId });
  const history = trpc.matching.getQualityHistory.useQuery();
  const scoreMutation = trpc.matching.scoreDialogueQuality.useMutation();
  const utils = trpc.useUtils();

  const handleScore = async () => {
    if (!sessionId) return;
    try {
      await scoreMutation.mutateAsync({ sessionId });
      utils.matching.getDialogueQuality.invalidate({ sessionId });
      utils.matching.getQualityHistory.invalidate();
      toast.success("品質採点が完了しました");
    } catch { toast.error("採点に失敗しました"); }
  };

  const chartData = [...(history.data ?? [])].reverse().map((h: any) => ({
    name: h.theme?.substring(0, 10) || `#${h.sessionId}`,
    logic: h.overallScores?.logic || 0,
    specificity: h.overallScores?.specificity || 0,
    creativity: h.overallScores?.creativity || 0,
    cooperation: h.overallScores?.cooperation || 0,
  }));

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">対話品質メーター</h1>
        <Select onValueChange={(v) => setSessionId(Number(v))}>
          <SelectTrigger className="w-80"><SelectValue placeholder="セッションを選択" /></SelectTrigger>
          <SelectContent>
            {(sessions.data ?? []).map((s: any) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.theme || `セッション #${s.id}`}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="score"><Gauge className="h-4 w-4 mr-1" />品質採点</TabsTrigger>
            <TabsTrigger value="hints"><Lightbulb className="h-4 w-4 mr-1" />改善ヒント</TabsTrigger>
            <TabsTrigger value="trend"><TrendingUp className="h-4 w-4 mr-1" />品質推移</TabsTrigger>
          </TabsList>

          <TabsContent value="score">
            {!sessionId ? <p className="text-muted-foreground">セッションを選択してください</p> : (
              <div className="space-y-4">
                <Button onClick={handleScore} disabled={scoreMutation.isPending}>
                  {scoreMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Gauge className="h-4 w-4 mr-2" />}
                  品質を採点
                </Button>
                {quality.data && (
                  <>
                    <Card>
                      <CardHeader><CardTitle>全体スコア</CardTitle></CardHeader>
                      <CardContent className="space-y-2">
                        {AXES.map(a => <ScoreBar key={a.key} label={a.label} value={(quality.data as any)?.overallScores?.[a.key] || 0} color={a.color} />)}
                      </CardContent>
                    </Card>
                    <div className="space-y-3">
                      {((quality.data as any)?.turnScores ?? []).map((t: any, i: number) => (
                        <Card key={i}>
                          <CardContent className="pt-4">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="outline">ターン {t.turnNumber || i + 1}</Badge>
                              {t.hint && <span className="text-xs text-yellow-500">{t.hint}</span>}
                            </div>
                            <div className="space-y-1">
                              {AXES.map(a => <ScoreBar key={a.key} label={a.label} value={t[a.key] || 0} color={a.color} />)}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="hints">
            {(quality.data as any)?.improvementHints?.length ? (
              <div className="space-y-3">
                {((quality.data as any).improvementHints as string[]).map((h: string, i: number) => (
                  <Card key={i}><CardContent className="pt-4 flex items-start gap-2"><Lightbulb className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" /><p className="text-sm">{h}</p></CardContent></Card>
                ))}
              </div>
            ) : <p className="text-muted-foreground">{sessionId ? "まず品質採点を実行してください" : "セッションを選択してください"}</p>}
          </TabsContent>

          <TabsContent value="trend">
            <Card>
              <CardHeader><CardTitle>セッション別品質推移</CardTitle></CardHeader>
              <CardContent>
                {chartData.length ? (
                  <ResponsiveContainer width="100%" height={350}>
                    <AreaChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} />
                      <Tooltip />
                      {AXES.map(a => (
                        <Area key={a.key} type="monotone" dataKey={a.key} name={a.label} stroke={a.color} fill={a.color} fillOpacity={0.15} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <p className="text-muted-foreground">品質データがありません</p>}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
