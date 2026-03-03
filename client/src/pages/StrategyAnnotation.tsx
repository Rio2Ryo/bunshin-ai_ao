import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Tags, BarChart3, Lightbulb, Loader2 } from "lucide-react";
import { toast } from "sonner";

const TAG_LABELS: Record<string, string> = { attack: "攻め", defend: "守り", empathy: "共感", gather: "情報収集", propose: "提案", consensus: "合意形成", avoid: "回避" };
const TAG_COLORS: Record<string, string> = { attack: "bg-red-500", defend: "bg-blue-500", empathy: "bg-pink-500", gather: "bg-yellow-500", propose: "bg-green-500", consensus: "bg-purple-500", avoid: "bg-gray-500" };
const TAGS = ["attack","defend","empathy","gather","propose","consensus","avoid"] as const;

export default function StrategyAnnotation() {
  const [tab, setTab] = useState("annotate");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const sessions = trpc.matching.sessions.useQuery();
  const sessionDetail = trpc.matching.getSession.useQuery({ id: sessionId! }, { enabled: !!sessionId });
  const annotations = trpc.matching.getStrategyAnnotations.useQuery({ sessionId: sessionId! }, { enabled: !!sessionId });
  const stats = trpc.matching.getStrategyStats.useQuery();
  const addMutation = trpc.matching.addStrategyAnnotation.useMutation();
  const suggestMutation = trpc.matching.suggestOptimalStrategy.useMutation();
  const utils = trpc.useUtils();

  const dialogues = sessionDetail.data?.dialogues ?? [];
  const annotationMap = new Map((annotations.data ?? []).map((a: any) => [a.turnNumber, a]));

  const handleAnnotate = async (turnNumber: number, tag: string) => {
    if (!sessionId) return;
    try {
      await addMutation.mutateAsync({ sessionId, turnNumber, tag: tag as any });
      utils.matching.getStrategyAnnotations.invalidate({ sessionId });
      toast.success("戦略タグを保存しました");
    } catch { toast.error("保存に失敗しました"); }
  };

  const handleSuggest = async () => {
    if (!sessionId) return;
    try {
      await suggestMutation.mutateAsync({ sessionId });
    } catch { toast.error("提案の生成に失敗しました"); }
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">戦略アノテーション</h1>
        <Select onValueChange={(v) => setSessionId(Number(v))}>
          <SelectTrigger className="w-80"><SelectValue placeholder="セッションを選択" /></SelectTrigger>
          <SelectContent>
            {(sessions.data ?? []).map((s: any) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.theme || `セッション #${s.id}`}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList><TabsTrigger value="annotate"><Tags className="h-4 w-4 mr-1" />アノテーション</TabsTrigger><TabsTrigger value="stats"><BarChart3 className="h-4 w-4 mr-1" />統計分析</TabsTrigger><TabsTrigger value="suggest"><Lightbulb className="h-4 w-4 mr-1" />戦略提案</TabsTrigger></TabsList>

          <TabsContent value="annotate">
            {!sessionId ? <p className="text-muted-foreground">セッションを選択してください</p> : (
              <div className="space-y-3">
                {dialogues.map((d: any) => {
                  const existing = annotationMap.get(d.turnNumber);
                  return (
                    <Card key={d.turnNumber}>
                      <CardContent className="pt-4">
                        <div className="flex items-start gap-3">
                          <Badge variant="outline">T{d.turnNumber}</Badge>
                          <div className="flex-1">
                            <p className="text-xs text-muted-foreground mb-1">ターン {d.turnNumber}</p>
                            <p className="text-sm">{(d.content || "")?.substring(0, 200)}</p>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {TAGS.map(t => (
                              <Button key={t} size="sm" variant={(existing as any)?.tag === t ? "default" : "outline"}
                                className={(existing as any)?.tag === t ? TAG_COLORS[t] + " text-white" : ""}
                                onClick={() => handleAnnotate(d.turnNumber, t)}>
                                {TAG_LABELS[t]}
                              </Button>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="stats">
            <Card>
              <CardHeader><CardTitle>タグ別成功率</CardTitle></CardHeader>
              <CardContent>
                {(stats.data as any[])?.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={(stats.data ?? []).map((s: any) => ({ ...s, tag: TAG_LABELS[s.tag] || s.tag, avgScore: Math.round(s.avgScore || 0) }))}>
                      <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="tag" /><YAxis /><Tooltip />
                      <Bar dataKey="avgScore" fill="hsl(var(--primary))" name="平均スコア" />
                      <Bar dataKey="count" fill="hsl(var(--muted-foreground))" name="使用回数" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="text-muted-foreground">アノテーションデータがありません</p>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="suggest">
            {!sessionId ? <p className="text-muted-foreground">セッションを選択してください</p> : (
              <div className="space-y-4">
                <Button onClick={handleSuggest} disabled={suggestMutation.isPending}>
                  {suggestMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Lightbulb className="h-4 w-4 mr-2" />}
                  最適戦略を提案
                </Button>
                {suggestMutation.data && (
                  <>
                    {suggestMutation.data.patternAdvice && (
                      <Card><CardHeader><CardTitle>全体アドバイス</CardTitle></CardHeader><CardContent><p className="text-sm">{suggestMutation.data.patternAdvice}</p></CardContent></Card>
                    )}
                    {(suggestMutation.data.optimalSequence as any[])?.length > 0 && (
                      <Card><CardHeader><CardTitle>最適シーケンス</CardTitle></CardHeader><CardContent><div className="flex gap-2 flex-wrap">{(suggestMutation.data.optimalSequence as string[]).map((t: string, i: number) => (<Badge key={i} className={TAG_COLORS[t] + " text-white"}>{TAG_LABELS[t] || t}</Badge>))}</div></CardContent></Card>
                    )}
                    <div className="space-y-2">
                      {((suggestMutation.data.suggestions as any[]) ?? []).map((s: any, i: number) => (
                        <Card key={i}><CardContent className="pt-4"><div className="flex items-center gap-2"><Badge variant="outline">T{s.turnNumber}</Badge><Badge className={TAG_COLORS[s.recommendedTag] + " text-white"}>{TAG_LABELS[s.recommendedTag] || s.recommendedTag}</Badge><span className="text-sm text-muted-foreground">{s.reason}</span></div></CardContent></Card>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
