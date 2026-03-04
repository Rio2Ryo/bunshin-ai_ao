import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Activity, Loader2, TrendingUp, AlertTriangle, Heart } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

const EMOTION_COLORS: Record<string, string> = {
  joy: "#fbbf24", anger: "#ef4444", sadness: "#3b82f6", fun: "#22c55e", anxiety: "#a855f7", confidence: "#f97316"
};
const EMOTION_LABELS: Record<string, string> = {
  joy: "喜び", anger: "怒り", sadness: "悲しみ", fun: "楽しさ", anxiety: "不安", confidence: "自信"
};

export default function EmotionFlow() {
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const sessions = trpc.matching.sessions.useQuery();
  const analyzeMutation = trpc.matching.analyzeEmotionFlow.useMutation();
  const emotionData = trpc.matching.getEmotionFlow.useQuery(
    { sessionId: Number(selectedSessionId) },
    { enabled: !!selectedSessionId }
  );
  const history = trpc.matching.getEmotionFlowHistory.useQuery();

  const handleAnalyze = async () => {
    if (!selectedSessionId) return;
    try {
      await analyzeMutation.mutateAsync({ sessionId: Number(selectedSessionId) });
      toast.success("感情分析が完了しました");
      emotionData.refetch();
    } catch (e: any) { toast.error(e.message || "分析に失敗しました"); }
  };

  const data = analyzeMutation.data || emotionData.data;
  const emotionTurns = data?.emotionData || [];
  const transitionPoints = data?.transitionPoints || [];
  const syncScore = data?.syncScore ?? null;

  // Prepare chart data — group by turn, show speaker1 and speaker2 emotions
  const speakers: string[] = Array.from(new Set(emotionTurns.map((et: any) => et.speaker)));
  const turnNumbers: number[] = (Array.from(new Set(emotionTurns.map((et: any) => et.turnNumber))) as number[]).sort((a, b) => a - b);

  const chartData = turnNumbers.map((tn: number) => {
    const row: any = { turn: `T${tn}` };
    emotionTurns.filter((et: any) => et.turnNumber === tn).forEach((et: any) => {
      const prefix = et.speaker === speakers[0] ? "A_" : "B_";
      Object.entries(et.emotions || {}).forEach(([k, v]) => { row[prefix + k] = v; });
    });
    return row;
  });

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Activity className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">感情フロー可視化</h1>
            <p className="text-sm text-muted-foreground">マッチング対話の感情の流れをリアルタイム分析</p>
          </div>
        </div>

        <Tabs defaultValue="analyze">
          <TabsList>
            <TabsTrigger value="analyze">感情分析</TabsTrigger>
            <TabsTrigger value="history">分析履歴</TabsTrigger>
          </TabsList>

          <TabsContent value="analyze" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>セッション選択</CardTitle>
              </CardHeader>
              <CardContent className="flex gap-3">
                <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="マッチングセッションを選択" /></SelectTrigger>
                  <SelectContent>
                    {(sessions.data || []).filter((s: any) => s.status === "completed").map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.theme} (#{s.id})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleAnalyze} disabled={!selectedSessionId || analyzeMutation.isPending}>
                  {analyzeMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />分析中...</> : "感情を分析"}
                </Button>
              </CardContent>
            </Card>

            {syncScore !== null && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-4 text-center">
                    <Heart className="h-6 w-6 mx-auto mb-1 text-pink-500" />
                    <p className="text-2xl font-bold">{syncScore}</p>
                    <p className="text-xs text-muted-foreground">感情同期度スコア</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <TrendingUp className="h-6 w-6 mx-auto mb-1 text-blue-500" />
                    <p className="text-2xl font-bold">{emotionTurns.length}</p>
                    <p className="text-xs text-muted-foreground">分析ターン数</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <AlertTriangle className="h-6 w-6 mx-auto mb-1 text-amber-500" />
                    <p className="text-2xl font-bold">{transitionPoints.length}</p>
                    <p className="text-xs text-muted-foreground">感情転換ポイント</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {chartData.length > 0 && speakers.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>感情フロー（話者A: {speakers[0]}）</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={chartData}>
                      <XAxis dataKey="turn" />
                      <YAxis domain={[0, 100]} />
                      <Tooltip />
                      <Legend />
                      {Object.entries(EMOTION_COLORS).map(([key, color]) => (
                        <Area key={`A_${key}`} type="monotone" dataKey={`A_${key}`} name={`${EMOTION_LABELS[key]}`} stroke={color} fill={color} fillOpacity={0.2} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {chartData.length > 0 && speakers.length > 1 && (
              <Card>
                <CardHeader>
                  <CardTitle>感情フロー（話者B: {speakers[1]}）</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={chartData}>
                      <XAxis dataKey="turn" />
                      <YAxis domain={[0, 100]} />
                      <Tooltip />
                      <Legend />
                      {Object.entries(EMOTION_COLORS).map(([key, color]) => (
                        <Area key={`B_${key}`} type="monotone" dataKey={`B_${key}`} name={`${EMOTION_LABELS[key]}`} stroke={color} fill={color} fillOpacity={0.2} strokeDasharray="5 5" />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {transitionPoints.length > 0 && (
              <Card>
                <CardHeader><CardTitle>感情転換ポイント</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {transitionPoints.map((tp: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg border">
                      <Badge variant="outline" className="shrink-0">T{tp.turnNumber}</Badge>
                      <div>
                        <p className="font-medium text-sm">{tp.description}</p>
                        <p className="text-xs text-muted-foreground mt-1">{tp.fromEmotion} → {tp.toEmotion} | トリガー: {tp.trigger}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {data?.summary && (
              <Card>
                <CardHeader><CardTitle>分析サマリー</CardTitle></CardHeader>
                <CardContent><p className="text-sm whitespace-pre-wrap">{data.summary}</p></CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-4 mt-4">
            {(history.data || []).length === 0 && (
              <p className="text-center text-muted-foreground py-8">分析履歴がまだありません</p>
            )}
            {(history.data || []).map((h: any) => (
              <Card key={h.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelectedSessionId(String(h.sessionId))}>
                <CardContent className="flex items-center gap-4 p-4">
                  <Activity className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">{h.theme}</p>
                    <p className="text-sm text-muted-foreground">セッション #{h.sessionId} • {new Date(h.createdAt).toLocaleDateString("ja-JP")}</p>
                  </div>
                  <Badge variant="outline">同期度: {h.syncScore}</Badge>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
