import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, MessageCircle, BarChart3, ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

export default function ConversationStyleAnalysis() {
  usePageMeta({ title: "会話スタイル分析", description: "ツインの会話パターンを深層分析", path: "/conversation-style" });
  const [selectedSession, setSelectedSession] = useState<string>("");

  const { data: sessions } = trpc.matching.sessions.useQuery();
  const { data: comparison } = trpc.matching.getStyleComparison.useQuery();
  const { data: styleData } = trpc.matching.getConversationStyle.useQuery(
    { sessionId: Number(selectedSession) },
    { enabled: !!selectedSession }
  );
  const analyzeMut = trpc.matching.analyzeConversationStyle.useMutation({
    onSuccess: () => { toast.success("会話スタイルを分析しました"); },
    onError: (e) => toast.error(e.message),
  });

  const completedSessions = (sessions ?? []).filter((s: any) => s.status === "completed");

  const radarData = comparison?.averages ? [
    { subject: "語彙レベル", value: comparison.averages.vocabularyLevel, fullMark: 100 },
    { subject: "話題展開", value: comparison.averages.topicDevelopment, fullMark: 100 },
    { subject: "質問頻度", value: comparison.averages.questionFrequency, fullMark: 100 },
    { subject: "合意形成", value: comparison.averages.agreementStyle, fullMark: 100 },
  ] : [];

  const trendData = (comparison?.analyses ?? []).slice(0, 10).reverse().map((a: any, i: number) => {
    const p = a.analysis?.participants?.[0];
    return {
      name: a.theme?.slice(0, 8) || `#${i + 1}`,
      vocabulary: p?.vocabularyLevel?.score ?? 0,
      topic: p?.topicDevelopment?.score ?? 0,
      question: p?.questionFrequency?.score ?? 0,
      agreement: p?.agreementStyle?.score ?? 0,
    };
  });

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MessageCircle className="h-6 w-6" /> 会話スタイル分析</h1>
          <p className="text-muted-foreground text-sm mt-1">マッチング対話からツインの会話パターンを深層分析</p>
        </div>

        <Tabs defaultValue="analyze">
          <TabsList>
            <TabsTrigger value="analyze">分析</TabsTrigger>
            <TabsTrigger value="overview">全体傾向</TabsTrigger>
            <TabsTrigger value="history">履歴</TabsTrigger>
          </TabsList>

          <TabsContent value="analyze" className="space-y-4 mt-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">セッションを選択して分析</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <Select value={selectedSession} onValueChange={setSelectedSession}>
                  <SelectTrigger><SelectValue placeholder="マッチングセッションを選択" /></SelectTrigger>
                  <SelectContent>
                    {completedSessions.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.theme || `セッション #${s.id}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={() => { if (selectedSession) analyzeMut.mutate({ sessionId: Number(selectedSession) }); }} disabled={!selectedSession || analyzeMut.isPending} className="w-full">
                  {analyzeMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <BarChart3 className="h-4 w-4 mr-2" />}
                  会話スタイルを分析
                </Button>
              </CardContent>
            </Card>

            {(analyzeMut.data || (styleData && styleData.length > 0)) && (
              <StyleResultCard analysis={analyzeMut.data || styleData?.[0]?.analysis} />
            )}
          </TabsContent>

          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-base">平均スタイルスコア</CardTitle></CardHeader>
                <CardContent>
                  {radarData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <RadarChart data={radarData}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12 }} />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} />
                        <Radar name="平均スコア" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
                      </RadarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-center text-muted-foreground py-8">分析データがありません</p>}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">スコア推移</CardTitle></CardHeader>
                <CardContent>
                  {trendData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis domain={[0, 100]} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="vocabulary" name="語彙" fill="#6366f1" />
                        <Bar dataKey="topic" name="話題" fill="#f59e0b" />
                        <Bar dataKey="question" name="質問" fill="#10b981" />
                        <Bar dataKey="agreement" name="合意" fill="#ef4444" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-center text-muted-foreground py-8">分析データがありません</p>}
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader><CardTitle className="text-base">統計</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div><div className="text-2xl font-bold text-primary">{comparison?.totalAnalyzed ?? 0}</div><div className="text-xs text-muted-foreground">分析済みセッション</div></div>
                  <div><div className="text-2xl font-bold text-primary">{comparison?.averages?.vocabularyLevel ?? 0}</div><div className="text-xs text-muted-foreground">平均語彙スコア</div></div>
                  <div><div className="text-2xl font-bold text-primary">{comparison?.averages?.topicDevelopment ?? 0}</div><div className="text-xs text-muted-foreground">平均話題展開</div></div>
                  <div><div className="text-2xl font-bold text-primary">{comparison?.averages?.agreementStyle ?? 0}</div><div className="text-xs text-muted-foreground">平均合意形成</div></div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="space-y-4 mt-4">
            {(comparison?.analyses ?? []).length === 0 && <p className="text-center text-muted-foreground py-8">分析履歴がありません</p>}
            {(comparison?.analyses ?? []).map((a: any, i: number) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{a.theme || `セッション`}</CardTitle>
                    <span className="text-xs text-muted-foreground">{a.createdAt?.slice(0, 10)}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  {a.analysis?.participants?.map((p: any, j: number) => (
                    <div key={j} className="flex items-center gap-4 text-sm">
                      <Badge>{p.overallStyle || p.speaker}</Badge>
                      <span>語彙: {p.vocabularyLevel?.score ?? "-"}</span>
                      <span>話題: {p.topicDevelopment?.score ?? "-"}</span>
                      <span>質問: {p.questionFrequency?.score ?? "-"}</span>
                      <span>合意: {p.agreementStyle?.score ?? "-"}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function StyleResultCard({ analysis }: { analysis: any }) {
  if (!analysis) return null;
  const participants = analysis.participants || [];
  const comp = analysis.comparison || {};

  return (
    <div className="space-y-4">
      {participants.map((p: any, i: number) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              {p.speaker || `参加者 ${i + 1}`}
              {p.overallStyle && <Badge variant="secondary">{p.overallStyle}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <ScoreBox label="語彙レベル" score={p.vocabularyLevel?.score} />
              <ScoreBox label="話題展開" score={p.topicDevelopment?.score} />
              <ScoreBox label="質問頻度" score={p.questionFrequency?.score} />
              <ScoreBox label="合意形成" score={p.agreementStyle?.score} />
            </div>
            {p.vocabularyLevel?.characteristics?.length > 0 && (
              <div className="flex flex-wrap gap-1">{p.vocabularyLevel.characteristics.map((c: string, j: number) => <Badge key={j} variant="outline" className="text-xs">{c}</Badge>)}</div>
            )}
            {p.improvements?.length > 0 && (
              <div>
                <h5 className="text-sm font-medium mb-1">改善提案</h5>
                <ul className="text-sm text-muted-foreground list-disc ml-4">{p.improvements.map((im: string, j: number) => <li key={j}>{im}</li>)}</ul>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      {(comp.complementary?.length > 0 || comp.friction?.length > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              比較分析 <Badge>類似度: {comp.similarity ?? "-"}%</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-4">
            <div>
              <h5 className="text-sm font-medium mb-1 text-green-600">補完的な点</h5>
              <ul className="text-sm text-muted-foreground list-disc ml-4">{(comp.complementary || []).map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>
            </div>
            <div>
              <h5 className="text-sm font-medium mb-1 text-red-600">摩擦点</h5>
              <ul className="text-sm text-muted-foreground list-disc ml-4">{(comp.friction || []).map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
            </div>
          </CardContent>
        </Card>
      )}
      {analysis.recommendations?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">推奨事項</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1">{analysis.recommendations.map((r: string, i: number) => <li key={i} className="flex items-center gap-2 text-sm"><ArrowRight className="h-3 w-3 text-primary" />{r}</li>)}</ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ScoreBox({ label, score }: { label: string; score?: number }) {
  const color = score == null ? "text-muted-foreground" : score >= 70 ? "text-green-600" : score >= 40 ? "text-yellow-600" : "text-red-600";
  return (
    <div className="text-center p-2 rounded-lg bg-muted/50">
      <div className={`text-xl font-bold ${color}`}>{score ?? "-"}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
