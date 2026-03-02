import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, FileText, Mail, Download, CheckCircle, AlertTriangle, ArrowRight, ListTodo } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";

export default function MatchingMinutes() {
  usePageMeta({ title: "議事録", description: "マッチング自動議事録", path: "/minutes" });
  const [selectedSession, setSelectedSession] = useState<string>("");

  const { data: sessions } = trpc.matching.sessions.useQuery();
  const { data: minutesList } = trpc.matching.listMinutes.useQuery();
  const { data: currentMinutes } = trpc.matching.getMinutes.useQuery(
    { sessionId: Number(selectedSession) }, { enabled: !!selectedSession }
  );
  const generateMut = trpc.matching.generateMinutes.useMutation({
    onSuccess: () => { toast.success("議事録を生成しました"); },
    onError: (e) => toast.error(e.message),
  });
  const emailMut = trpc.matching.sendMinutesEmail.useMutation({
    onSuccess: (d) => toast[d.sent ? "success" : "error"](d.sent ? "議事録をメール送信しました" : (d as any).reason || "送信失敗"),
  });

  const completedSessions = (sessions ?? []).filter((s: any) => s.status === "completed");
  const displayMinutes = generateMut.data || currentMinutes;

  const handleDownloadMd = () => {
    if (!displayMinutes?.markdownContent) return;
    const blob = new Blob([displayMinutes.markdownContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `minutes-${selectedSession}.md`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="h-6 w-6" /> マッチング議事録</h1>
          <p className="text-muted-foreground text-sm mt-1">対話からAIが自動で議事録を生成</p>
        </div>

        <Tabs defaultValue="generate">
          <TabsList>
            <TabsTrigger value="generate">議事録生成</TabsTrigger>
            <TabsTrigger value="history">履歴</TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-4 mt-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">セッションを選択</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <Select value={selectedSession} onValueChange={setSelectedSession}>
                  <SelectTrigger><SelectValue placeholder="マッチングセッションを選択" /></SelectTrigger>
                  <SelectContent>
                    {completedSessions.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.theme || `セッション #${s.id}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Button onClick={() => { if (selectedSession) generateMut.mutate({ sessionId: Number(selectedSession) }); }} disabled={!selectedSession || generateMut.isPending} className="flex-1">
                    {generateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
                    議事録を生成
                  </Button>
                </div>
              </CardContent>
            </Card>

            {displayMinutes && (
              <div className="space-y-4">
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={handleDownloadMd}><Download className="h-4 w-4 mr-1" /> Markdown</Button>
                  <Button variant="outline" size="sm" onClick={() => { if (selectedSession) emailMut.mutate({ sessionId: Number(selectedSession) }); }} disabled={emailMut.isPending}>
                    {emailMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Mail className="h-4 w-4 mr-1" />} メール送信
                  </Button>
                </div>

                {displayMinutes.summary && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base">概要</CardTitle></CardHeader>
                    <CardContent><p className="text-sm">{displayMinutes.summary}</p></CardContent>
                  </Card>
                )}

                {displayMinutes.decisions?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" /> 決定事項</CardTitle></CardHeader>
                    <CardContent><ul className="space-y-1">{displayMinutes.decisions.map((d: string, i: number) => <li key={i} className="text-sm flex items-start gap-2"><span className="text-green-500 mt-0.5">-</span>{d}</li>)}</ul></CardContent>
                  </Card>
                )}

                {displayMinutes.actionItems?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ListTodo className="h-4 w-4 text-blue-500" /> アクションアイテム</CardTitle></CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {displayMinutes.actionItems.map((a: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 text-sm p-2 rounded bg-muted/50">
                            <Badge variant={a.priority === "high" ? "destructive" : a.priority === "low" ? "outline" : "secondary"} className="text-xs">{a.priority}</Badge>
                            <span className="flex-1">{a.task}</span>
                            {a.owner && <Badge variant="outline" className="text-xs">{a.owner}</Badge>}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {displayMinutes.nextAgenda?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ArrowRight className="h-4 w-4 text-primary" /> 次回アジェンダ</CardTitle></CardHeader>
                    <CardContent><ul className="space-y-1">{displayMinutes.nextAgenda.map((n: string, i: number) => <li key={i} className="text-sm flex items-start gap-2"><span className="text-primary mt-0.5">-</span>{n}</li>)}</ul></CardContent>
                  </Card>
                )}

                {(displayMinutes as any).openIssues?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-yellow-500" /> 未解決課題</CardTitle></CardHeader>
                    <CardContent><ul className="space-y-1">{(displayMinutes as any).openIssues.map((o: string, i: number) => <li key={i} className="text-sm flex items-start gap-2"><span className="text-yellow-500 mt-0.5">-</span>{o}</li>)}</ul></CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-4 mt-4">
            {(minutesList ?? []).length === 0 && <p className="text-center text-muted-foreground py-8">議事録がまだありません</p>}
            {(minutesList ?? []).map((m: any) => (
              <Card key={m.id} className="cursor-pointer hover:bg-muted/50" onClick={() => { setSelectedSession(String(m.sessionId)); }}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-sm">{m.theme || `セッション #${m.sessionId}`}</span>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{m.summary}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {m.actionItems?.length > 0 && <Badge variant="outline">{m.actionItems.length}アクション</Badge>}
                      <span className="text-xs text-muted-foreground">{m.createdAt?.slice(0, 10)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
