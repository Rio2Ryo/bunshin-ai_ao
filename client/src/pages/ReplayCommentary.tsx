import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Captions, Loader2, Play, Share2, MessageSquare, Sparkles, Copy } from "lucide-react";

export default function ReplayCommentary() {
  usePageMeta({ title: "リプレイ解説", description: "AIコメンタリー付きリプレイ", path: "/replay-commentary" });

  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [commentaryVisible, setCommentaryVisible] = useState(true);
  const [shareCode, setShareCode] = useState<string | null>(null);

  const { data: sessionsRaw } = trpc.matching.sessions.useQuery();
  const sessions = (sessionsRaw as any[]) || [];
  const completedSessions = sessions.filter((s: any) => s.status === "completed" || s.matchingResults);

  const { data: commentaryRaw, isLoading: commentaryLoading } = trpc.matching.getReplayCommentary.useQuery(
    { sessionId: selectedSessionId! },
    { enabled: selectedSessionId !== null }
  );
  const commentary = commentaryRaw as any;

  const generateMut = trpc.matching.generateCommentaryForReplay.useMutation({
    onSuccess: () => {
      toast.success("解説を生成しました");
    },
    onError: (err: any) => {
      toast.error(err.message || "解説の生成に失敗しました");
    },
  });

  const shareMut = trpc.matching.shareReplayCommentary.useMutation({
    onSuccess: (data: any) => {
      const code = data?.shareCode || data?.code || "SHARED";
      setShareCode(code);
      toast.success("シェアコードを生成しました");
    },
    onError: (err: any) => {
      toast.error(err.message || "シェアに失敗しました");
    },
  });

  const scoreColor = (score: number) => {
    if (score >= 8) return "bg-green-500";
    if (score >= 5) return "bg-yellow-500";
    return "bg-red-500";
  };

  const dialogues = commentary?.dialogues || commentary?.dialogue || [];
  const commentaryItems = commentary?.commentary || [];

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <Captions className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold">リプレイ解説</h1>
        </div>

        <Tabs defaultValue="generate">
          <TabsList>
            <TabsTrigger value="generate">解説生成</TabsTrigger>
            <TabsTrigger value="replay">解説付きリプレイ</TabsTrigger>
          </TabsList>

          {/* 解説生成タブ */}
          <TabsContent value="generate" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Play className="h-5 w-5" />
                  セッション選択
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Select
                  value={selectedSessionId !== null ? String(selectedSessionId) : ""}
                  onValueChange={(v) => setSelectedSessionId(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="完了済みのマッチングを選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {completedSessions.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        #{s.id} — {s.twinAName || "Twin A"} vs {s.twinBName || "Twin B"}
                        {s.createdAt ? ` (${s.createdAt.substring(0, 10)})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {completedSessions.length === 0 && (
                  <p className="text-sm text-muted-foreground">完了済みのマッチングセッションがありません。</p>
                )}

                <Button
                  onClick={() => {
                    if (selectedSessionId === null) {
                      toast.error("セッションを選択してください");
                      return;
                    }
                    generateMut.mutate({ sessionId: selectedSessionId });
                  }}
                  disabled={selectedSessionId === null || generateMut.isPending}
                >
                  {generateMut.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      生成中...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      解説を生成
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 解説付きリプレイタブ */}
          <TabsContent value="replay" className="space-y-4 mt-4">
            {/* Session selector */}
            <div className="flex items-center gap-4 flex-wrap">
              <Select
                value={selectedSessionId !== null ? String(selectedSessionId) : ""}
                onValueChange={(v) => setSelectedSessionId(Number(v))}
              >
                <SelectTrigger className="w-[300px]">
                  <SelectValue placeholder="セッションを選択" />
                </SelectTrigger>
                <SelectContent>
                  {completedSessions.map((s: any) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      #{s.id} — {s.twinAName || "Twin A"} vs {s.twinBName || "Twin B"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2">
                <Switch checked={commentaryVisible} onCheckedChange={setCommentaryVisible} id="commentary-toggle" />
                <Label htmlFor="commentary-toggle">解説ON/OFF</Label>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (selectedSessionId === null) return;
                  shareMut.mutate({ sessionId: selectedSessionId });
                }}
                disabled={selectedSessionId === null || shareMut.isPending}
              >
                <Share2 className="h-4 w-4 mr-1" />
                解説をシェア
              </Button>
            </div>

            {shareCode && (
              <Card className="border-green-300 bg-green-50 dark:bg-green-950">
                <CardContent className="py-3 flex items-center gap-3">
                  <Badge variant="secondary" className="text-lg px-3 py-1 font-mono">{shareCode}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(shareCode);
                      toast.success("コピーしました");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">このコードを相手に共有してください</span>
                </CardContent>
              </Card>
            )}

            {commentaryLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            )}

            {!commentaryLoading && selectedSessionId !== null && (!commentary || (dialogues.length === 0 && commentaryItems.length === 0)) && (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-40" />
                  <p>まだ解説が生成されていません。</p>
                  <p className="text-sm mt-1">「解説生成」タブからAI解説を生成してください。</p>
                </CardContent>
              </Card>
            )}

            {!commentaryLoading && dialogues.length > 0 && (
              <div className="space-y-4">
                {dialogues.map((turn: any, idx: number) => {
                  const commentItem = commentaryItems[idx];
                  return (
                    <div key={idx} className="space-y-2">
                      {/* Turn content */}
                      <Card>
                        <CardContent className="py-3">
                          <div className="flex items-start gap-3">
                            <Badge variant={turn.speaker === "twinA" || turn.role === "twinA" ? "default" : "secondary"}>
                              {turn.speakerName || turn.speaker || `ターン${idx + 1}`}
                            </Badge>
                            <p className="text-sm leading-relaxed flex-1">{turn.text || turn.content || turn.message}</p>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Commentary card */}
                      {commentaryVisible && commentItem && (
                        <Card className="ml-8 border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30">
                          <CardContent className="py-3 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              {commentItem.technique && (
                                <Badge variant="outline" className="border-blue-400 text-blue-700 dark:text-blue-300">
                                  {commentItem.technique}
                                </Badge>
                              )}
                              {commentItem.pattern && (
                                <Badge variant="outline" className="border-purple-400 text-purple-700 dark:text-purple-300">
                                  {commentItem.pattern}
                                </Badge>
                              )}
                              {typeof commentItem.score === "number" && (
                                <div className="flex items-center gap-1 ml-auto">
                                  <span className="text-xs text-muted-foreground">スコア:</span>
                                  <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${scoreColor(commentItem.score)}`}
                                      style={{ width: `${(commentItem.score / 10) * 100}%` }}
                                    />
                                  </div>
                                  <span className="text-xs font-bold">{commentItem.score}/10</span>
                                </div>
                              )}
                            </div>
                            {commentItem.improvement && (
                              <p className="text-xs text-muted-foreground">
                                <span className="font-medium text-orange-600 dark:text-orange-400">改善点: </span>
                                {commentItem.improvement}
                              </p>
                            )}
                            {commentItem.insight && (
                              <p className="text-xs text-muted-foreground">
                                <span className="font-medium text-green-600 dark:text-green-400">洞察: </span>
                                {commentItem.insight}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
