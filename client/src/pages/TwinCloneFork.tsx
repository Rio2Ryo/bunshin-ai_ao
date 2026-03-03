import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Copy, GitFork, History, MessageSquare, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function TwinCloneFork() {
  const [tab, setTab] = useState("clone");
  const [selectedCloneId, setSelectedCloneId] = useState<number | null>(null);
  const [feedbackText, setFeedbackText] = useState("");

  const myTwin = trpc.myTwin.get.useQuery();
  const publicTwins = trpc.myTwin.searchPublic.useQuery();
  const cloneHistory = trpc.myTwin.getCloneHistory.useQuery();
  const cloneDiff = trpc.myTwin.getCloneDiff.useQuery({ cloneId: selectedCloneId! }, { enabled: !!selectedCloneId });
  const forkFeedback = trpc.myTwin.listForkFeedback.useQuery();

  const cloneMutation = trpc.myTwin.cloneTwin.useMutation();
  const forkMutation = trpc.myTwin.forkTwin.useMutation();
  const feedbackMutation = trpc.myTwin.sendForkFeedback.useMutation();
  const utils = trpc.useUtils();

  const handleClone = async (twinId: number) => {
    try {
      const res = await cloneMutation.mutateAsync({ twinId });
      utils.myTwin.getCloneHistory.invalidate();
      toast.success(`「${res.name}」を作成しました`);
    } catch { toast.error("クローンに失敗しました"); }
  };

  const handleFork = async (twinId: number) => {
    try {
      const res = await forkMutation.mutateAsync({ twinId });
      utils.myTwin.getCloneHistory.invalidate();
      toast.success(`「${res.name}」をフォークしました`);
    } catch (e: any) { toast.error(e.message || "フォークに失敗しました"); }
  };

  const handleSendFeedback = async (cloneId: number) => {
    if (!feedbackText.trim()) return;
    try {
      await feedbackMutation.mutateAsync({ cloneId, message: feedbackText });
      setFeedbackText("");
      toast.success("フィードバックを送信しました");
    } catch { toast.error("送信に失敗しました"); }
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">クローン＆フォーク</h1>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="clone"><Copy className="h-4 w-4 mr-1" />クローン/フォーク</TabsTrigger>
            <TabsTrigger value="history"><History className="h-4 w-4 mr-1" />履歴</TabsTrigger>
            <TabsTrigger value="feedback"><MessageSquare className="h-4 w-4 mr-1" />フィードバック</TabsTrigger>
          </TabsList>

          <TabsContent value="clone">
            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle>自分のツインをクローン</CardTitle><CardDescription>同じパラメータで複製し、異なる設定で並行運用</CardDescription></CardHeader>
                <CardContent>
                  {myTwin.data ? (
                    <div className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium">{myTwin.data.name}</p>
                        <p className="text-sm text-muted-foreground">{myTwin.data.description?.substring(0, 80)}</p>
                      </div>
                      <Button onClick={() => handleClone(myTwin.data!.id)} disabled={cloneMutation.isPending}>
                        {cloneMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                        クローン
                      </Button>
                    </div>
                  ) : <p className="text-muted-foreground">ツインが見つかりません</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>公開ツインをフォーク</CardTitle><CardDescription>他のユーザーのツインをベースに自分流にカスタマイズ</CardDescription></CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(publicTwins.data ?? []).slice(0, 10).map((item: any) => {
                      const t = item.twin;
                      return (
                        <div key={t.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div>
                            <p className="font-medium">{t.name}</p>
                            <p className="text-sm text-muted-foreground">{t.description?.substring(0, 80)}</p>
                            {t.tags && <div className="flex gap-1 mt-1">{String(t.tags).split(",").filter(Boolean).slice(0, 3).map((tag: string, i: number) => <Badge key={i} variant="secondary" className="text-xs">{tag.trim()}</Badge>)}</div>}
                          </div>
                          <Button onClick={() => handleFork(t.id)} disabled={forkMutation.isPending} variant="outline">
                            <GitFork className="h-4 w-4 mr-1" />フォーク
                          </Button>
                        </div>
                      );
                    })}
                    {!publicTwins.data?.length && <p className="text-muted-foreground">公開ツインがありません</p>}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <div className="space-y-3">
              {(cloneHistory.data ?? []).map((c: any) => (
                <Card key={c.id} className={selectedCloneId === c.id ? "ring-2 ring-primary" : ""}>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant={c.sourceType === "clone" ? "default" : "secondary"}>{c.sourceType === "clone" ? "クローン" : "フォーク"}</Badge>
                        <span className="text-sm">{c.sourceName}</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{c.cloneName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString("ja-JP")}</span>
                        <Button size="sm" variant="outline" onClick={() => setSelectedCloneId(c.id)}>差分</Button>
                      </div>
                    </div>
                    {selectedCloneId === c.id && cloneDiff.data && (
                      <div className="mt-3 space-y-2 border-t pt-3">
                        {cloneDiff.data.diffs?.length ? cloneDiff.data.diffs.map((d: any, i: number) => (
                          <div key={i} className="text-xs">
                            <Badge variant="outline" className="mb-1">{d.field}</Badge>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="p-2 bg-red-500/10 rounded"><span className="text-red-500">元:</span> {d.source}</div>
                              <div className="p-2 bg-green-500/10 rounded"><span className="text-green-500">現:</span> {d.cloned}</div>
                            </div>
                          </div>
                        )) : <p className="text-sm text-muted-foreground">差分なし（同一パラメータ）</p>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              {!cloneHistory.data?.length && <p className="text-muted-foreground">履歴がありません</p>}
            </div>
          </TabsContent>

          <TabsContent value="feedback">
            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle>フォーク元へフィードバック送信</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(cloneHistory.data ?? []).filter((c: any) => c.sourceType === "fork").map((c: any) => (
                      <div key={c.id} className="p-3 border rounded-lg space-y-2">
                        <p className="text-sm"><span className="font-medium">{c.sourceName}</span> → {c.cloneName} (by {c.sourceUserName})</p>
                        <Textarea placeholder="フィードバックメッセージ..." value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} rows={2} />
                        <Button size="sm" onClick={() => handleSendFeedback(c.id)} disabled={feedbackMutation.isPending}>送信</Button>
                      </div>
                    ))}
                    {!(cloneHistory.data ?? []).some((c: any) => c.sourceType === "fork") && <p className="text-muted-foreground">フォーク履歴がありません</p>}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>受け取ったフィードバック</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(forkFeedback.data ?? []).map((f: any) => (
                      <div key={f.id} className="p-3 border rounded-lg">
                        <p className="text-sm font-medium">{f.forkerName}さんから</p>
                        <p className="text-sm mt-1">{f.feedbackMessage}</p>
                        <p className="text-xs text-muted-foreground mt-1">{new Date(f.createdAt).toLocaleDateString("ja-JP")}</p>
                      </div>
                    ))}
                    {!forkFeedback.data?.length && <p className="text-muted-foreground">フィードバックなし</p>}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
