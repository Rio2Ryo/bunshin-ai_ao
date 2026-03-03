import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Drama, Loader2, Send, Square, Lightbulb, Trophy, MessageSquare } from "lucide-react";
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer } from "recharts";

const SCENE_LABELS: Record<string, string> = { sales: "商談", presentation: "プレゼン", complaint: "クレーム対応", interview: "面接" };
const DIFFICULTY_LABELS: Record<string, string> = { beginner: "初級", intermediate: "中級", advanced: "上級" };
const SCORE_LABELS: Record<string, string> = { communication: "コミュニケーション", problemSolving: "問題解決", empathy: "共感力", expertise: "専門性", adaptability: "適応力" };

export default function RoleplayTraining() {
  const [scene, setScene] = useState<string>("sales");
  const [difficulty, setDifficulty] = useState<string>("beginner");
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  const startMutation = trpc.myTwin.startRoleplay.useMutation();
  const respondMutation = trpc.myTwin.respondRoleplay.useMutation();
  const endMutation = trpc.myTwin.endRoleplay.useMutation();
  const sessionDetail = trpc.myTwin.getRoleplay.useQuery(
    { sessionId: activeSessionId! },
    { enabled: !!activeSessionId }
  );
  const history = trpc.myTwin.listRoleplays.useQuery();

  const handleStart = async () => {
    try {
      const result = await startMutation.mutateAsync({ scene: scene as any, difficulty: difficulty as any });
      if ((result as any).id) setActiveSessionId(Number((result as any).id));
      toast.success("ロールプレイを開始しました");
      history.refetch();
    } catch (e: any) { toast.error(e.message || "開始に失敗しました"); }
  };

  const handleSend = async () => {
    if (!activeSessionId || !message.trim()) return;
    try {
      const result = await respondMutation.mutateAsync({ sessionId: activeSessionId, message: message.trim() });
      setMessage("");
      sessionDetail.refetch();
      if ((result as any).shouldEnd) toast.info("対話が十分な長さになりました。終了して評価を受けましょう。");
    } catch (e: any) { toast.error(e.message || "送信に失敗しました"); }
  };

  const handleEnd = async () => {
    if (!activeSessionId) return;
    try {
      await endMutation.mutateAsync({ sessionId: activeSessionId });
      toast.success("ロールプレイが完了しました。評価結果をご確認ください。");
      sessionDetail.refetch();
      history.refetch();
    } catch (e: any) { toast.error(e.message || "終了に失敗しました"); }
  };

  const detail = sessionDetail.data as any;
  const evaluation = detail?.evaluation;
  const radarData = evaluation?.scores ? Object.entries(evaluation.scores).map(([key, val]) => ({ subject: SCORE_LABELS[key] || key, score: val as number })) : [];

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Drama className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">ロールプレイ・トレーニング</h1>
            <p className="text-sm text-muted-foreground">仮想相手との練習でツインのスキルを強化</p>
          </div>
        </div>

        <Tabs defaultValue="practice">
          <TabsList>
            <TabsTrigger value="practice">練習</TabsTrigger>
            <TabsTrigger value="history">履歴</TabsTrigger>
          </TabsList>

          <TabsContent value="practice" className="space-y-4 mt-4">
            {!activeSessionId && (
              <Card>
                <CardHeader><CardTitle>シーン設定</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Select value={scene} onValueChange={setScene}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(SCENE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Select value={difficulty} onValueChange={setDifficulty}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(DIFFICULTY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button onClick={handleStart} disabled={startMutation.isPending} className="w-full">
                    {startMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />準備中...</> : "ロールプレイ開始"}
                  </Button>
                </CardContent>
              </Card>
            )}

            {detail && (
              <>
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>{SCENE_LABELS[detail.scene]} ({DIFFICULTY_LABELS[detail.difficulty]})</CardTitle>
                      <div className="flex gap-2">
                        <Badge>{detail.roleName}</Badge>
                        <Badge variant={detail.status === "completed" ? "default" : "secondary"}>{detail.status === "completed" ? "完了" : "進行中"}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(detail.dialogue || []).map((d: any, i: number) => {
                      const hint = (detail.coachingHints || []).find((h: any) => h.turn === d.turn);
                      return (
                        <div key={i}>
                          <div className={`p-3 rounded-lg ${d.isRole ? "bg-muted/50 border-l-4 border-amber-500" : "bg-primary/5 border-l-4 border-primary"}`}>
                            <p className="text-xs font-medium mb-1">{d.speaker}</p>
                            <p className="text-sm">{d.content}</p>
                          </div>
                          {hint?.hint && d.isRole && (
                            <div className="ml-4 mt-1 flex items-start gap-1 text-xs text-amber-600">
                              <Lightbulb className="h-3 w-3 mt-0.5 shrink-0" />
                              <span>{hint.hint}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {detail.status === "active" && (
                      <div className="flex gap-2 mt-4">
                        <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="応答を入力..." onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }} />
                        <Button size="icon" onClick={handleSend} disabled={respondMutation.isPending}>
                          {respondMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Button>
                        <Button variant="destructive" size="icon" onClick={handleEnd} disabled={endMutation.isPending}>
                          <Square className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {evaluation && (
                  <>
                    <Card>
                      <CardHeader><CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5 text-yellow-500" />評価結果: {evaluation.overallScore}点</CardTitle></CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={250}>
                          <RadarChart data={radarData}>
                            <PolarGrid />
                            <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12 }} />
                            <PolarRadiusAxis domain={[0, 100]} />
                            <Radar name="スコア" dataKey="score" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.3} />
                          </RadarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {(evaluation.strengths || []).length > 0 && (
                        <Card>
                          <CardHeader><CardTitle className="text-green-500 text-sm">強み</CardTitle></CardHeader>
                          <CardContent><ul className="list-disc list-inside text-sm space-y-1">{evaluation.strengths.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></CardContent>
                        </Card>
                      )}
                      {(evaluation.improvements || []).length > 0 && (
                        <Card>
                          <CardHeader><CardTitle className="text-amber-500 text-sm">改善点</CardTitle></CardHeader>
                          <CardContent><ul className="list-disc list-inside text-sm space-y-1">{evaluation.improvements.map((im: string, i: number) => <li key={i}>{im}</li>)}</ul></CardContent>
                        </Card>
                      )}
                    </div>

                    {evaluation.modelAnswer && (
                      <Card>
                        <CardHeader><CardTitle className="text-sm">模範回答</CardTitle></CardHeader>
                        <CardContent><p className="text-sm whitespace-pre-wrap">{evaluation.modelAnswer}</p></CardContent>
                      </Card>
                    )}
                    {evaluation.summary && (
                      <Card>
                        <CardHeader><CardTitle className="text-sm">総評</CardTitle></CardHeader>
                        <CardContent><p className="text-sm whitespace-pre-wrap">{evaluation.summary}</p></CardContent>
                      </Card>
                    )}

                    <Button variant="outline" onClick={() => { setActiveSessionId(null); }}>新しい練習を開始</Button>
                  </>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-4 mt-4">
            {((history.data || []) as any[]).length === 0 && <p className="text-center text-muted-foreground py-8">練習履歴がまだありません</p>}
            {((history.data || []) as any[]).map((h: any) => (
              <Card key={h.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setActiveSessionId(h.id)}>
                <CardContent className="flex items-center gap-4 p-4">
                  <MessageSquare className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">{SCENE_LABELS[h.scene]} ({DIFFICULTY_LABELS[h.difficulty]})</p>
                    <p className="text-xs text-muted-foreground">{h.roleName} • {new Date(h.createdAt).toLocaleDateString("ja-JP")}</p>
                  </div>
                  <Badge variant={h.status === "completed" ? "default" : "secondary"}>{h.status === "completed" ? "完了" : "進行中"}</Badge>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
