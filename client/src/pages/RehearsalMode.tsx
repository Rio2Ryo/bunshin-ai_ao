import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { MessageSquare, History, Loader2, Send, CheckCircle, Star } from "lucide-react";
import { toast } from "sonner";

export default function RehearsalMode() {
  const [tab, setTab] = useState("rehearsal");
  const [theme, setTheme] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const activeSession = trpc.myTwin.getRehearsal.useQuery({ sessionId: activeSessionId! }, { enabled: !!activeSessionId });
  const detail = trpc.myTwin.getRehearsal.useQuery({ sessionId: selectedId! }, { enabled: !!selectedId });
  const rehearsals = trpc.myTwin.listRehearsals.useQuery();
  const startMutation = trpc.myTwin.startRehearsal.useMutation();
  const respondMutation = trpc.myTwin.respondRehearsal.useMutation();
  const endMutation = trpc.myTwin.endRehearsal.useMutation();
  const utils = trpc.useUtils();

  const handleStart = async () => {
    if (!theme.trim()) return;
    try {
      const res = await startMutation.mutateAsync({ theme });
      setActiveSessionId(res.sessionId as number);
      toast.success("リハーサルを開始しました");
    } catch { toast.error("開始に失敗しました"); }
  };

  const handleSend = async () => {
    if (!message.trim() || !activeSessionId) return;
    try {
      await respondMutation.mutateAsync({ sessionId: activeSessionId, message });
      setMessage("");
      utils.myTwin.getRehearsal.invalidate({ sessionId: activeSessionId });
    } catch { toast.error("送信に失敗しました"); }
  };

  const handleEnd = async () => {
    if (!activeSessionId) return;
    try {
      const res = await endMutation.mutateAsync({ sessionId: activeSessionId });
      utils.myTwin.getRehearsal.invalidate({ sessionId: activeSessionId });
      utils.myTwin.listRehearsals.invalidate();
      toast.success(`準備度スコア: ${res.readinessScore}/100`);
    } catch { toast.error("終了に失敗しました"); }
  };

  const scoreColor = (score: number) => score >= 70 ? "text-green-500" : score >= 40 ? "text-yellow-500" : "text-red-500";

  return (
    <DashboardLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">対話リハーサル</h1>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="rehearsal"><MessageSquare className="h-4 w-4 mr-1" />リハーサル</TabsTrigger>
            <TabsTrigger value="history"><History className="h-4 w-4 mr-1" />履歴</TabsTrigger>
          </TabsList>

          <TabsContent value="rehearsal">
            {!activeSessionId || activeSession.data?.status === "completed" ? (
              <Card>
                <CardHeader><CardTitle>新しいリハーサル</CardTitle><CardDescription>マッチング前にツインと1対1で練習</CardDescription></CardHeader>
                <CardContent className="space-y-3">
                  <Input placeholder="テーマを入力（例: 新規事業提案）" value={theme} onChange={e => setTheme(e.target.value)} onKeyDown={e => e.key === "Enter" && handleStart()} />
                  <Button onClick={handleStart} disabled={startMutation.isPending || !theme.trim()}>
                    {startMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MessageSquare className="h-4 w-4 mr-2" />}
                    リハーサル開始
                  </Button>
                  {activeSession.data?.status === "completed" && activeSession.data.evaluation && (
                    <Card className="border-primary">
                      <CardHeader><CardTitle className="flex items-center gap-2"><Star className="h-5 w-5" />評価結果</CardTitle></CardHeader>
                      <CardContent className="space-y-3">
                        <div className="text-center">
                          <span className={`text-4xl font-bold ${scoreColor(activeSession.data.readinessScore || 0)}`}>{activeSession.data.readinessScore}</span>
                          <span className="text-muted-foreground">/100</span>
                        </div>
                        {activeSession.data.evaluation.strengths?.length > 0 && (
                          <div>
                            <p className="text-sm font-medium text-green-500 mb-1">強み</p>
                            {activeSession.data.evaluation.strengths.map((s: string, i: number) => <Badge key={i} variant="outline" className="mr-1 mb-1">{s}</Badge>)}
                          </div>
                        )}
                        {activeSession.data.evaluation.weaknesses?.length > 0 && (
                          <div>
                            <p className="text-sm font-medium text-red-500 mb-1">弱点</p>
                            {activeSession.data.evaluation.weaknesses.map((w: string, i: number) => <Badge key={i} variant="destructive" className="mr-1 mb-1">{w}</Badge>)}
                          </div>
                        )}
                        {activeSession.data.evaluation.improvements?.length > 0 && (
                          <div>
                            <p className="text-sm font-medium mb-1">改善アドバイス</p>
                            {activeSession.data.evaluation.improvements.map((imp: string, i: number) => <p key={i} className="text-sm text-muted-foreground">• {imp}</p>)}
                          </div>
                        )}
                        {activeSession.data.evaluation.strategyTips && <p className="text-sm bg-muted p-3 rounded">{activeSession.data.evaluation.strategyTips}</p>}
                      </CardContent>
                    </Card>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">テーマ: {activeSession.data?.theme}</Badge>
                  <Button variant="destructive" size="sm" onClick={handleEnd} disabled={endMutation.isPending}>
                    {endMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle className="h-4 w-4 mr-1" />}
                    終了＆評価
                  </Button>
                </div>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {(activeSession.data?.dialogue ?? []).map((d: any) => (
                    <div key={d.turnNumber} className={`flex ${d.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] p-3 rounded-lg text-sm ${d.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                        {d.message}
                      </div>
                    </div>
                  ))}
                  {respondMutation.isPending && <div className="flex justify-start"><div className="bg-muted p-3 rounded-lg"><Loader2 className="h-4 w-4 animate-spin" /></div></div>}
                </div>
                <div className="flex gap-2">
                  <Input placeholder="メッセージを入力..." value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSend()} />
                  <Button onClick={handleSend} disabled={respondMutation.isPending || !message.trim()}><Send className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="history">
            <div className="space-y-3">
              {(rehearsals.data ?? []).map((r: any) => (
                <Card key={r.id} className={selectedId === r.id ? "ring-2 ring-primary" : "cursor-pointer hover:border-primary"} onClick={() => setSelectedId(r.id)}>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{r.theme}</p>
                        <p className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString("ja-JP")}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status === "completed" ? "完了" : "進行中"}</Badge>
                        {r.readinessScore != null && <span className={`text-lg font-bold ${scoreColor(r.readinessScore)}`}>{r.readinessScore}</span>}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {selectedId && detail.data && (
                <Card className="border-primary">
                  <CardHeader><CardTitle>{detail.data.theme} — 詳細</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
                      {(detail.data.dialogue ?? []).map((d: any) => (
                        <div key={d.turnNumber} className={`flex ${d.role === "user" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[75%] p-2 rounded-lg text-sm ${d.role === "user" ? "bg-primary/20" : "bg-muted"}`}>{d.message}</div>
                        </div>
                      ))}
                    </div>
                    {detail.data.evaluation && (
                      <div className="border-t pt-3 space-y-2">
                        <p className="font-medium">準備度: <span className={scoreColor(detail.data.readinessScore || 0)}>{detail.data.readinessScore}/100</span></p>
                        {detail.data.evaluation.strategyTips && <p className="text-sm bg-muted p-2 rounded">{detail.data.evaluation.strategyTips}</p>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
              {!rehearsals.data?.length && <p className="text-muted-foreground">リハーサル履歴がありません</p>}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
