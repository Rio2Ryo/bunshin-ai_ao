import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Eye, MessageCircleQuestion, History, Loader2, Sun, CloudRain, Briefcase } from "lucide-react";
import { toast } from "sonner";

const PERSPECTIVES = [
  { key: "optimistic", label: "楽観的", icon: Sun, color: "text-green-500", bg: "bg-green-500/10", border: "border-green-500/30" },
  { key: "pessimistic", label: "悲観的", icon: CloudRain, color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/30" },
  { key: "practical", label: "実務的", icon: Briefcase, color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/30" },
] as const;

export default function SecondOpinion() {
  const [tab, setTab] = useState("opinion");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [perspective, setPerspective] = useState<"optimistic" | "pessimistic" | "practical">("optimistic");
  const [question, setQuestion] = useState("");

  const sessions = trpc.matching.sessions.useQuery();
  const opinionData = trpc.matching.getSecondOpinionData.useQuery({ sessionId: sessionId! }, { enabled: !!sessionId });
  const opinionHistory = trpc.matching.listSecondOpinions.useQuery();
  const getOpinionMutation = trpc.matching.getSecondOpinion.useMutation();
  const deepDiveMutation = trpc.matching.deepDiveSecondOpinion.useMutation();
  const utils = trpc.useUtils();

  const handleGetOpinion = async () => {
    if (!sessionId) return;
    try {
      await getOpinionMutation.mutateAsync({ sessionId });
      utils.matching.getSecondOpinionData.invalidate({ sessionId });
      utils.matching.listSecondOpinions.invalidate();
      toast.success("セカンドオピニオンを取得しました");
    } catch {
      toast.error("取得に失敗しました");
    }
  };

  const handleDeepDive = async () => {
    if (!sessionId || !question.trim()) return;
    try {
      await deepDiveMutation.mutateAsync({ sessionId, perspective, question });
      setQuestion("");
    } catch {
      toast.error("質問に失敗しました");
    }
  };

  const data = getOpinionMutation.data || opinionData.data;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">セカンドオピニオンAI</h1>
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
            <TabsTrigger value="opinion"><Eye className="h-4 w-4 mr-1" />セカンドオピニオン</TabsTrigger>
            <TabsTrigger value="deepdive"><MessageCircleQuestion className="h-4 w-4 mr-1" />深掘り</TabsTrigger>
            <TabsTrigger value="history"><History className="h-4 w-4 mr-1" />履歴</TabsTrigger>
          </TabsList>

          <TabsContent value="opinion">
            {!sessionId ? <p className="text-muted-foreground">セッションを選択してください</p> : (
              <div className="space-y-4">
                <Button onClick={handleGetOpinion} disabled={getOpinionMutation.isPending}>
                  {getOpinionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                  3視点で再分析
                </Button>

                {data && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Card><CardContent className="pt-4 text-center"><p className="text-sm text-muted-foreground">乖離度</p><p className="text-2xl font-bold text-yellow-500">{data.divergenceScore}</p></CardContent></Card>
                      <Card><CardContent className="pt-4 text-center"><p className="text-sm text-muted-foreground">合議スコア</p><p className="text-2xl font-bold text-primary">{data.consensusScore}</p></CardContent></Card>
                    </div>

                    <div className="grid md:grid-cols-3 gap-4">
                      {PERSPECTIVES.map(p => {
                        const pData = (data as any)[p.key];
                        if (!pData) return null;
                        const Icon = p.icon;
                        return (
                          <Card key={p.key} className={p.border}>
                            <CardHeader className="pb-2">
                              <CardTitle className={`flex items-center gap-2 text-sm ${p.color}`}>
                                <Icon className="h-4 w-4" />{p.label}
                                <Badge variant="outline" className="ml-auto">{pData.score}点</Badge>
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                              <p className="text-sm">{pData.summary}</p>
                              {pData.keyPoints?.length > 0 && (
                                <div>{pData.keyPoints.map((kp: string, i: number) => <p key={i} className="text-xs text-muted-foreground">• {kp}</p>)}</div>
                              )}
                              {pData.opportunities?.length > 0 && (
                                <div className="flex flex-wrap gap-1">{pData.opportunities.map((o: string, i: number) => <Badge key={i} variant="outline" className="text-xs text-green-500">{o}</Badge>)}</div>
                              )}
                              {pData.risks?.length > 0 && (
                                <div className="flex flex-wrap gap-1">{pData.risks.map((r: string, i: number) => <Badge key={i} variant="outline" className="text-xs text-red-500">{r}</Badge>)}</div>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="deepdive">
            {!sessionId || !data ? <p className="text-muted-foreground">{sessionId ? "まずセカンドオピニオンを取得してください" : "セッションを選択してください"}</p> : (
              <Card>
                <CardHeader><CardTitle>視点を選んで深掘り質問</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    {PERSPECTIVES.map(p => (
                      <Button key={p.key} variant={perspective === p.key ? "default" : "outline"} size="sm" onClick={() => setPerspective(p.key as any)}>
                        <p.icon className="h-4 w-4 mr-1" />{p.label}
                      </Button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input placeholder="質問を入力..." value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === "Enter" && handleDeepDive()} />
                    <Button onClick={handleDeepDive} disabled={deepDiveMutation.isPending || !question.trim()}>
                      {deepDiveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "質問"}
                    </Button>
                  </div>
                  {deepDiveMutation.data && (
                    <div className={`p-3 rounded-lg ${PERSPECTIVES.find(pp => pp.key === (deepDiveMutation.data as any).perspective)?.bg || "bg-muted"}`}>
                      <p className="text-sm">{(deepDiveMutation.data as any).answer}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="history">
            <div className="space-y-2">
              {(opinionHistory.data ?? []).map((h: any) => (
                <Card key={h.sessionId} className="cursor-pointer hover:border-primary" onClick={() => { setSessionId(h.sessionId); setTab("opinion"); }}>
                  <CardContent className="pt-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{h.theme || `セッション #${h.sessionId}`}</p>
                      <p className="text-xs text-muted-foreground">{new Date(h.createdAt).toLocaleDateString("ja-JP")}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-center"><p className="text-xs text-muted-foreground">乖離</p><p className="font-bold text-yellow-500">{h.divergenceScore}</p></div>
                      <div className="text-center"><p className="text-xs text-muted-foreground">合議</p><p className="font-bold text-primary">{h.consensusScore}</p></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {!opinionHistory.data?.length && <p className="text-muted-foreground">履歴がありません</p>}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
