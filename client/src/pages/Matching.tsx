import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/_core/hooks/useAuth";
import { Users, Plus, Loader2, Play, CheckCircle, XCircle, Clock, UserPlus, Bot, MessageSquare, Shield, Star, TrendingUp, ArrowRight, Sparkles } from "lucide-react";

function ScoreCircle({ score, size = "md", source }: { score: number; size?: "sm" | "md" | "lg"; source?: string }) {
  const sizeMap = { sm: "w-10 h-10 text-xs", md: "w-14 h-14 text-sm", lg: "w-20 h-20 text-lg" };
  const color = score >= 80 ? "text-green-500 border-green-500/40" :
                score >= 60 ? "text-blue-500 border-blue-500/40" :
                score >= 40 ? "text-yellow-500 border-yellow-500/40" :
                "text-muted-foreground border-muted";
  return (
    <div className={`${sizeMap[size]} rounded-full border-2 ${color} flex flex-col items-center justify-center shrink-0`}>
      <span className="font-bold leading-none">{score}%</span>
      {source === "estimated" && size !== "sm" && (
        <span className="text-[9px] text-muted-foreground leading-none mt-0.5">推定</span>
      )}
    </div>
  );
}

export default function Matching() {
  usePageMeta({ title: "ビジネスマッチング", description: "分身AI同士の対話を通じて、最適なビジネスパートナーを発見しましょう。", ogImage: "https://bunshin-ai.pages.dev/og/matching.svg", path: "/matching" });
  const { user } = useAuth();
  const { data: myTwin } = trpc.myTwin.get.useQuery();
  const { data: friends } = trpc.friends.list.useQuery();
  const { data: sessions, isLoading, refetch } = trpc.matching.sessions.useQuery();
  const { data: trustData } = trpc.trust.getScore.useQuery();
  const { data: candidates, isLoading: candidatesLoading } = trpc.matching.suggestedCandidates.useQuery();

  const createSession = trpc.matching.create.useMutation();
  const runDialogue = trpc.matching.runDialogue.useMutation();
  const completeTutorial = trpc.onboarding.completeTutorial.useMutation();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedFriendId, setSelectedFriendId] = useState("");
  const [theme, setTheme] = useState("");
  const [turns, setTurns] = useState(5);

  const handleCreate = async () => {
    if (!selectedFriendId || !theme.trim()) {
      toast.error("友達とテーマを選択してください");
      return;
    }

    if (!myTwin) {
      toast.error("まず自分の分身AIを作成してください");
      return;
    }

    const friend = friends?.find(f => f.friend.id === parseInt(selectedFriendId));
    if (!friend?.twin) {
      toast.error("この友達はまだ分身AIを作成していません");
      return;
    }

    try {
      toast.info(`分身AI同士の対話を開始しています（${turns}ターン）...`);

      await createSession.mutateAsync({
        friendId: friend.friend.id,
        theme: theme,
        turns: turns,
      });

      toast.success("対話と分析が完了しました！");
      setIsCreateOpen(false);
      setSelectedFriendId("");
      setTheme("");
      setTurns(5);
      refetch();
    } catch (error: any) {
      toast.error(error?.message || "作成に失敗しました");
    }
  };

  const handleQuickMatch = (friendId: number, friendName: string) => {
    setSelectedFriendId(friendId.toString());
    setTheme(`${friendName}とのビジネス協業の可能性`);
    setIsCreateOpen(true);
  };

  const handleRunDialogue = async (sessionId: number) => {
    try {
      toast.info("対話を開始しています...");
      await runDialogue.mutateAsync({ sessionId, turns: 5 });
      toast.success("対話が完了しました");
      refetch();
    } catch (error) {
      toast.error("対話の実行に失敗しました");
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "running":
        return <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "completed": return "完了";
      case "running": return "実行中";
      case "failed": return "失敗";
      default: return "待機中";
    }
  };

  const friendsWithTwin = friends?.filter(f => f.twin) || [];

  const me = user as any;
  const tutorialDone = me?.tutorialCompleted === 1;

  const displayedSessions = tutorialDone
    ? sessions?.filter((s: any) => !s.isNpcSession) || []
    : sessions || [];

  const npcSessions = sessions?.filter((s: any) => s.isNpcSession) || [];
  const hasNpcSessions = npcSessions.length > 0;

  const handleCompleteTutorial = async () => {
    try {
      await completeTutorial.mutateAsync();
      toast.success("チュートリアルを完了しました");
      window.location.reload();
    } catch {
      toast.error("チュートリアル完了に失敗しました");
    }
  };

  const trustScore = trustData?.score ?? 0;
  const canMatch = trustScore >= 30;

  // Sort sessions: completed with score first, then by date
  const sortedSessions = [...(displayedSessions || [])].sort((a: any, b: any) => {
    if (a.status === "completed" && b.status !== "completed") return -1;
    if (a.status !== "completed" && b.status === "completed") return 1;
    if (a.compatibilityScore != null && b.compatibilityScore != null) {
      return b.compatibilityScore - a.compatibilityScore;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">ビジネスマッチング</h1>
            <p className="text-muted-foreground mt-2">
              スコアに基づいたおすすめ候補からマッチングを始めましょう
            </p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button disabled={!myTwin}>
                <Plus className="h-4 w-4 mr-2" />
                新規マッチング
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>新規マッチングセッション</DialogTitle>
                <DialogDescription>
                  友達の分身AIを選んで、ビジネステーマを設定してください
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="p-3 rounded-lg bg-muted/50 border">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Bot className="h-4 w-4" />
                    あなたの分身AI
                  </div>
                  <p className="font-medium">{myTwin?.name || "未作成"}</p>
                </div>

                <div className="space-y-2">
                  <Label>対話相手（友達の分身AI）</Label>
                  <Select value={selectedFriendId} onValueChange={setSelectedFriendId}>
                    <SelectTrigger>
                      <SelectValue placeholder="友達を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {friendsWithTwin.length > 0 ? (
                        friendsWithTwin.map((friend) => (
                          <SelectItem key={friend.friend.id} value={friend.friend.id.toString()}>
                            {friend.twin?.name} ({friend.friend.name})
                          </SelectItem>
                        ))
                      ) : (
                        <div className="p-2 text-sm text-muted-foreground text-center">
                          分身AIを持つ友達がいません
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="theme">対話テーマ</Label>
                  <Input
                    id="theme"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                    placeholder="例: AI活用した新規事業の可能性"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4" />
                      対話ターン数
                    </Label>
                    <span className="text-sm font-medium text-primary">{turns}ターン</span>
                  </div>
                  <Slider
                    value={[turns]}
                    onValueChange={(value) => setTurns(value[0])}
                    min={3}
                    max={30}
                    step={1}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>3（簡潔）</span>
                    <span>15（標準）</span>
                    <span>30（徹底議論）</span>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                    キャンセル
                  </Button>
                  <Button
                    onClick={handleCreate}
                    disabled={createSession.isPending || runDialogue.isPending || friendsWithTwin.length === 0}
                  >
                    {(createSession.isPending || runDialogue.isPending) && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    作成して対話開始
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Warning banners */}
        {!myTwin && (
          <Card className="border-yellow-500/50 bg-yellow-500/10">
            <CardContent className="flex items-center gap-4 py-4">
              <Bot className="h-8 w-8 text-yellow-500" />
              <div className="flex-1">
                <p className="font-medium">まず分身AIを作成してください</p>
                <p className="text-sm text-muted-foreground">
                  マッチングを始めるには、自分の分身AIが必要です
                </p>
              </div>
              <Link href="/twins">
                <Button>分身AIを作成</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {friendsWithTwin.length === 0 && myTwin && (
          <Card className="border-blue-500/50 bg-blue-500/10">
            <CardContent className="flex items-center gap-4 py-4">
              <UserPlus className="h-8 w-8 text-blue-500" />
              <div className="flex-1">
                <p className="font-medium">分身AIを持つ友達を追加しましょう</p>
                <p className="text-sm text-muted-foreground">
                  マッチングするには、分身AIを作成した友達が必要です
                </p>
              </div>
              <Link href="/friends">
                <Button variant="outline">友達を追加</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Tutorial dismiss banner */}
        {!tutorialDone && hasNpcSessions && (
          <Card className="border-cyan-500/50 bg-cyan-500/10">
            <CardContent className="flex items-center gap-4 py-4">
              <Bot className="h-8 w-8 text-cyan-500" />
              <div className="flex-1">
                <p className="font-medium">チュートリアルセッション表示中</p>
                <p className="text-sm text-muted-foreground">
                  ガイドキャラクターとの練習マッチングが表示されています。非表示にするにはチュートリアルを完了してください。
                </p>
              </div>
              <Button variant="outline" onClick={handleCompleteTutorial} disabled={completeTutorial.isPending}>
                {completeTutorial.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                チュートリアル完了
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Trust score warning */}
        {!canMatch && myTwin && friendsWithTwin.length > 0 && (
          <Card className="border-yellow-500/50 bg-yellow-500/10">
            <CardContent className="flex items-center gap-4 py-4">
              <Shield className="h-8 w-8 text-yellow-500" />
              <div className="flex-1">
                <p className="font-medium">信頼度スコアが不足しています</p>
                <p className="text-sm text-muted-foreground">
                  実ユーザーとのマッチングには信頼度30以上が必要です（現在: {trustScore}）
                </p>
              </div>
              <Link href="/trust">
                <Button variant="outline">スコアを確認</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Suggested Candidates Section */}
        {myTwin && candidates && candidates.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-bold">おすすめマッチング候補</h2>
              <Badge variant="secondary" className="text-xs">{candidates.length}件</Badge>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {candidates.map((c: any) => (
                <Card key={c.friend.id} className="hover:border-primary/50 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {/* Score circle */}
                      <ScoreCircle score={c.score} size="md" source={c.scoreSource} />
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm truncate">{c.friend.name}</p>
                          {c.friend.isNpc && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">NPC</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{c.twin.name}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                          {c.twin.description?.slice(0, 80) || "プロフィール未設定"}
                        </p>
                        {/* Tags */}
                        {c.twin.tags && c.twin.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {c.twin.tags.slice(0, 3).map((tag: string, i: number) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                        {/* Past result summary */}
                        {c.bestResult && (
                          <div className="mt-2 p-2 rounded bg-muted/50 border border-muted">
                            <div className="flex items-center gap-1 mb-0.5">
                              <Star className="h-3 w-3 text-yellow-500" />
                              <span className="text-[10px] font-medium">過去ベスト: {c.bestResult.score}%</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground line-clamp-1">
                              {c.bestResult.summary}
                            </p>
                          </div>
                        )}
                        {c.matchCount > 0 && !c.bestResult && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {c.matchCount}回マッチング済み
                          </p>
                        )}
                      </div>
                    </div>
                    {/* Actions */}
                    <div className="flex gap-2 mt-3">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => handleQuickMatch(c.friend.id, c.friend.name)}
                        disabled={createSession.isPending}
                      >
                        <Play className="h-3 w-3 mr-1" />
                        マッチング開始
                      </Button>
                      {c.bestResult?.sessionId && (
                        <Link href={`/matching/${c.bestResult.sessionId}`}>
                          <Button size="sm" variant="outline">
                            <ArrowRight className="h-3 w-3" />
                          </Button>
                        </Link>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {candidatesLoading && myTwin && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              おすすめマッチング候補
            </h2>
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          </div>
        )}

        {/* Matching History Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-xl font-bold">マッチング履歴</h2>
            {sortedSessions.length > 0 && (
              <Badge variant="secondary" className="text-xs">{sortedSessions.length}件</Badge>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : sortedSessions.length > 0 ? (
            <div className="grid gap-3">
              {sortedSessions.map((session: any) => (
                <Card key={session.id} className="hover:border-primary/50 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      {/* Score */}
                      {session.compatibilityScore != null ? (
                        <ScoreCircle score={Math.round(session.compatibilityScore)} size="sm" />
                      ) : (
                        <div className="w-10 h-10 rounded-full border-2 border-muted flex items-center justify-center shrink-0">
                          {getStatusIcon(session.status)}
                        </div>
                      )}
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm truncate">{session.theme}</p>
                          {session.isNpcSession && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">チュートリアル</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {session.twin1?.name || `Twin #${session.twin1Id}`} × {session.twin2?.name || `Twin #${session.twin2Id}`}
                        </p>
                        {session.resultSummary && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                            {session.resultSummary}
                          </p>
                        )}
                      </div>
                      {/* Status + Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right hidden sm:block">
                          <div className="flex items-center gap-1 justify-end">
                            {getStatusIcon(session.status)}
                            <span className="text-xs text-muted-foreground">
                              {getStatusText(session.status)}
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(session.createdAt).toLocaleDateString("ja-JP", {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          {session.status === "pending" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRunDialogue(session.id)}
                              disabled={runDialogue.isPending}
                            >
                              <Play className="h-3 w-3" />
                            </Button>
                          )}
                          <Link href={`/matching/${session.id}`}>
                            <Button size="sm" variant="outline">
                              詳細
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Users className="h-12 w-12 text-muted-foreground mb-3" />
                <h3 className="text-base font-medium mb-1">マッチング履歴がありません</h3>
                <p className="text-muted-foreground text-sm text-center mb-4">
                  おすすめ候補からマッチングを始めましょう
                </p>
                {myTwin && friendsWithTwin.length > 0 && (
                  <Button onClick={() => setIsCreateOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    最初のマッチングを作成
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
