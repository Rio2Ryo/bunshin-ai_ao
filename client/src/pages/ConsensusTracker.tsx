import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Handshake, TrendingUp, ListTodo, Loader2, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

const LEVEL_LABELS: Record<string, { label: string; color: string }> = {
  full: { label: "完全合意", color: "bg-green-500" },
  partial: { label: "部分合意", color: "bg-yellow-500" },
  unresolved: { label: "未合意", color: "bg-orange-500" },
  conflict: { label: "対立", color: "bg-red-500" },
};
const PRIORITY_COLORS: Record<string, string> = { high: "destructive", medium: "default", low: "secondary" };

export default function ConsensusTracker() {
  const [tab, setTab] = useState("analysis");
  const [sessionId, setSessionId] = useState<number | null>(null);

  const sessions = trpc.matching.sessions.useQuery();
  const consensus = trpc.matching.getConsensus.useQuery({ sessionId: sessionId! }, { enabled: !!sessionId });
  const history = trpc.matching.getConsensusHistory.useQuery();
  const followUps = trpc.matching.getConsensusFollowUps.useQuery();
  const trackMutation = trpc.matching.trackConsensus.useMutation();
  const utils = trpc.useUtils();

  const handleTrack = async () => {
    if (!sessionId) return;
    try {
      await trackMutation.mutateAsync({ sessionId });
      utils.matching.getConsensus.invalidate({ sessionId });
      utils.matching.getConsensusHistory.invalidate();
      utils.matching.getConsensusFollowUps.invalidate();
      toast.success("合意分析が完了しました");
    } catch { toast.error("分析に失敗しました"); }
  };

  const chartData = (history.data ?? []).reverse().map((h: any) => ({
    name: h.theme?.substring(0, 10) || `#${h.sessionId}`,
    rate: h.consensusRate || 0,
  }));

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">合意形成トラッカー</h1>
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
            <TabsTrigger value="analysis"><Handshake className="h-4 w-4 mr-1" />合意分析</TabsTrigger>
            <TabsTrigger value="trend"><TrendingUp className="h-4 w-4 mr-1" />推移</TabsTrigger>
            <TabsTrigger value="tasks"><ListTodo className="h-4 w-4 mr-1" />タスク</TabsTrigger>
          </TabsList>

          <TabsContent value="analysis">
            {!sessionId ? <p className="text-muted-foreground">セッションを選択してください</p> : (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Button onClick={handleTrack} disabled={trackMutation.isPending}>
                    {trackMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Handshake className="h-4 w-4 mr-2" />}
                    合意を分析
                  </Button>
                  {consensus.data && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">合意率:</span>
                      <span className={`text-2xl font-bold ${(consensus.data.consensusRate || 0) >= 60 ? "text-green-500" : "text-yellow-500"}`}>
                        {Math.round(consensus.data.consensusRate || 0)}%
                      </span>
                    </div>
                  )}
                </div>

                {consensus.data && (
                  <div className="grid md:grid-cols-2 gap-4">
                    <Card>
                      <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle className="h-5 w-5 text-green-500" />合意事項 ({consensus.data.agreements?.length || 0})</CardTitle></CardHeader>
                      <CardContent className="space-y-2">
                        {(consensus.data.agreements ?? []).map((a: any, i: number) => (
                          <div key={i} className="p-2 border rounded-lg">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={LEVEL_LABELS[a.level]?.color + " text-white"}>{LEVEL_LABELS[a.level]?.label || a.level}</Badge>
                              {a.turnNumber && <span className="text-xs text-muted-foreground">T{a.turnNumber}</span>}
                            </div>
                            <p className="text-sm">{a.topic}</p>
                          </div>
                        ))}
                        {!consensus.data.agreements?.length && <p className="text-sm text-muted-foreground">合意事項なし</p>}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader><CardTitle className="flex items-center gap-2"><XCircle className="h-5 w-5 text-red-500" />未合意事項 ({consensus.data.disagreements?.length || 0})</CardTitle></CardHeader>
                      <CardContent className="space-y-2">
                        {(consensus.data.disagreements ?? []).map((d: any, i: number) => (
                          <div key={i} className="p-2 border rounded-lg">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={LEVEL_LABELS[d.level]?.color + " text-white"}>{LEVEL_LABELS[d.level]?.label || d.level}</Badge>
                              {d.turnNumber && <span className="text-xs text-muted-foreground">T{d.turnNumber}</span>}
                            </div>
                            <p className="text-sm">{d.topic}</p>
                            {d.followUp && <p className="text-xs text-muted-foreground mt-1">{d.followUp}</p>}
                          </div>
                        ))}
                        {!consensus.data.disagreements?.length && <p className="text-sm text-muted-foreground">未合意事項なし</p>}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="trend">
            <Card>
              <CardHeader><CardTitle>合意率推移</CardTitle></CardHeader>
              <CardContent>
                {chartData.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} />
                      <Tooltip />
                      <Line type="monotone" dataKey="rate" name="合意率" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <p className="text-muted-foreground">データがありません</p>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tasks">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><ListTodo className="h-5 w-5" />フォローアップタスク</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(followUps.data ?? []).map((t: any, i: number) => (
                    <div key={i} className="p-3 border rounded-lg flex items-start gap-3">
                      <Badge variant={(PRIORITY_COLORS[t.priority] || "secondary") as any}>{t.priority?.toUpperCase()}</Badge>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{t.task}</p>
                        <p className="text-xs text-muted-foreground">{t.theme} — {t.relatedTopic}</p>
                      </div>
                    </div>
                  ))}
                  {!followUps.data?.length && <p className="text-muted-foreground">タスクなし</p>}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
