import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { BookOpen, Loader2, MessageCircle, Send, ArrowUpCircle, CheckCircle2, XCircle, Lightbulb, FileText } from "lucide-react";

export default function LearningJournal() {
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [commentText, setCommentText] = useState("");

  const sessions = trpc.matching.sessions.useQuery();
  const entries = trpc.myTwin.listJournalEntries.useQuery();
  const comments = trpc.myTwin.getJournalComments.useQuery(
    { journalEntryId: selectedEntryId! },
    { enabled: !!selectedEntryId }
  );
  const generateMutation = trpc.myTwin.generateJournalEntry.useMutation();
  const addCommentMutation = trpc.myTwin.addJournalComment.useMutation();
  const applyFeedbackMutation = trpc.myTwin.applyJournalFeedback.useMutation();
  const monthlyReportMutation = trpc.myTwin.generateMonthlyReport.useMutation();

  const handleGenerate = async () => {
    if (!selectedSessionId) return;
    try {
      const result = await generateMutation.mutateAsync({ sessionId: Number(selectedSessionId) });
      toast.success("振り返り日記を生成しました");
      if (result.id) setSelectedEntryId(Number(result.id));
      entries.refetch();
    } catch (e: any) { toast.error(e.message || "生成に失敗しました"); }
  };

  const handleAddComment = async () => {
    if (!selectedEntryId || !commentText.trim()) return;
    try {
      await addCommentMutation.mutateAsync({ journalEntryId: selectedEntryId, comment: commentText.trim() });
      toast.success("コメントを追加しました");
      setCommentText("");
      comments.refetch();
    } catch (e: any) { toast.error(e.message || "コメント追加に失敗しました"); }
  };

  const handleApplyFeedback = async () => {
    if (!selectedEntryId) return;
    try {
      const result = await applyFeedbackMutation.mutateAsync({ journalEntryId: selectedEntryId });
      toast.success(`フィードバックをツインに反映しました: ${result.addition}`);
    } catch (e: any) { toast.error(e.message || "反映に失敗しました"); }
  };

  const handleMonthlyReport = async () => {
    try {
      await monthlyReportMutation.mutateAsync();
      toast.success("月次成長レポートを生成しました");
      entries.refetch();
    } catch (e: any) { toast.error(e.message || "レポート生成に失敗しました"); }
  };

  const selectedEntry = (entries.data || []).find((e: any) => e.id === selectedEntryId);

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <BookOpen className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">自律学習ジャーナル</h1>
            <p className="text-sm text-muted-foreground">ツインの成長を自動記録し、フィードバックで改善</p>
          </div>
        </div>

        <Tabs defaultValue="generate">
          <TabsList>
            <TabsTrigger value="generate">日記生成</TabsTrigger>
            <TabsTrigger value="timeline">タイムライン</TabsTrigger>
            <TabsTrigger value="detail">詳細・コメント</TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>マッチング振り返り日記を生成</CardTitle>
                <CardDescription>完了したマッチングセッションを選んで、ツインの自動振り返りを生成します</CardDescription>
              </CardHeader>
              <CardContent className="flex gap-3">
                <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="セッションを選択" /></SelectTrigger>
                  <SelectContent>
                    {(sessions.data || []).filter((s: any) => s.status === "completed").map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.theme} (#{s.id})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleGenerate} disabled={!selectedSessionId || generateMutation.isPending}>
                  {generateMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : "日記を生成"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>月次成長レポート</CardTitle>
                <CardDescription>過去30日間の学習ジャーナルを統合分析</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" onClick={handleMonthlyReport} disabled={monthlyReportMutation.isPending}>
                  {monthlyReportMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><FileText className="h-4 w-4 mr-2" />月次レポート生成</>}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="timeline" className="space-y-4 mt-4">
            {(entries.data || []).length === 0 && <p className="text-center text-muted-foreground py-8">日記がまだありません</p>}
            {(entries.data || []).map((entry: any) => (
              <Card key={entry.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelectedEntryId(entry.id)}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <Badge variant={entry.entryType === "monthly_report" ? "default" : "secondary"}>
                      {entry.entryType === "monthly_report" ? "月次レポート" : entry.entryType === "milestone" ? "マイルストーン" : "振り返り"}
                    </Badge>
                    {entry.sessionTheme && <span className="text-xs text-muted-foreground">{entry.sessionTheme}</span>}
                    <span className="text-xs text-muted-foreground ml-auto">{new Date(entry.createdAt).toLocaleDateString("ja-JP")}</span>
                  </div>
                  <p className="font-medium">{entry.title}</p>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{typeof entry.content === "string" ? entry.content : ""}</p>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {(entry.lessons || []).slice(0, 2).map((l: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs"><CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />{l}</Badge>
                    ))}
                    {(entry.failures || []).slice(0, 1).map((f: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs"><XCircle className="h-3 w-3 mr-1 text-red-500" />{f}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="detail" className="space-y-4 mt-4">
            {!selectedEntry && <p className="text-center text-muted-foreground py-8">タイムラインから日記を選択してください</p>}
            {selectedEntry && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>{selectedEntry.title}</CardTitle>
                    <CardDescription>{new Date(selectedEntry.createdAt).toLocaleString("ja-JP")}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm whitespace-pre-wrap">{typeof selectedEntry.content === "string" ? selectedEntry.content : JSON.stringify(selectedEntry.content, null, 2)}</p>
                    {(selectedEntry.lessons || []).length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-1 flex items-center gap-1"><Lightbulb className="h-4 w-4 text-yellow-500" />学んだこと</p>
                        <ul className="list-disc list-inside text-sm space-y-1">{selectedEntry.lessons.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul>
                      </div>
                    )}
                    {(selectedEntry.failures || []).length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-1 flex items-center gap-1"><XCircle className="h-4 w-4 text-red-500" />失敗</p>
                        <ul className="list-disc list-inside text-sm space-y-1">{selectedEntry.failures.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
                      </div>
                    )}
                    {(selectedEntry.improvements || []).length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-1 flex items-center gap-1"><ArrowUpCircle className="h-4 w-4 text-blue-500" />改善点</p>
                        <ul className="list-disc list-inside text-sm space-y-1">{selectedEntry.improvements.map((im: string, i: number) => <li key={i}>{im}</li>)}</ul>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5" />コメント</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    {(comments.data || []).map((c: any) => (
                      <div key={c.id} className="p-3 rounded-lg bg-muted/50">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium">{c.userName}</span>
                          <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString("ja-JP")}</span>
                          {c.appliedToTwin === 1 && <Badge variant="outline" className="text-xs">反映済み</Badge>}
                        </div>
                        <p className="text-sm">{c.comment}</p>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="コメントを追加..." onKeyDown={(e) => { if (e.key === "Enter") handleAddComment(); }} />
                      <Button size="icon" onClick={handleAddComment} disabled={addCommentMutation.isPending}>
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleApplyFeedback} disabled={applyFeedbackMutation.isPending}>
                      {applyFeedbackMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ArrowUpCircle className="h-4 w-4 mr-1" />}
                      フィードバックをツインに反映
                    </Button>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
