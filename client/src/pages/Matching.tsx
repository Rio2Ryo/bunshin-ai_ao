import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/_core/hooks/useAuth";
import { Users, Plus, Loader2, Play, CheckCircle, XCircle, Clock, UserPlus, Bot, MessageSquare, Shield } from "lucide-react";

export default function Matching() {
  usePageMeta({ title: "ビジネスマッチング", description: "分身AI同士の対話を通じて、最適なビジネスパートナーを発見しましょう。", ogImage: "https://bunshin-ai.pages.dev/og/matching.svg", path: "/matching" });
  const { user } = useAuth();
  const { data: myTwin } = trpc.myTwin.get.useQuery();
  const { data: friends } = trpc.friends.list.useQuery();
  const { data: sessions, isLoading, refetch } = trpc.matching.sessions.useQuery();
  const { data: trustData } = trpc.trust.getScore.useQuery();

  const createSession = trpc.matching.create.useMutation();
  const runDialogue = trpc.matching.runDialogue.useMutation();

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

    // 選択した友達の分身AIを取得
    const friend = friends?.find(f => f.friend.id === parseInt(selectedFriendId));
    if (!friend?.twin) {
      toast.error("この友達はまだ分身AIを作成していません");
      return;
    }

    try {
      toast.info(`分身AI同士の対話を開始しています（${turns}ターン）...これには数分かかる場合があります`);
      
      // 作成と同時に対話・分析も自動実行
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
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "running":
        return <Loader2 className="h-5 w-5 animate-spin text-yellow-500" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "completed":
        return "完了";
      case "running":
        return "実行中";
      case "failed":
        return "失敗";
      default:
        return "待機中";
    }
  };

  // 友達の中で分身AIを持っている人だけフィルタ
  const friendsWithTwin = friends?.filter(f => f.twin) || [];

  // Filter NPC sessions: hide when tutorial_completed=true
  const me = user as any;
  const tutorialDone = me?.tutorialCompleted === 1;

  const displayedSessions = tutorialDone
    ? sessions?.filter((s: any) => !s.isNpcSession) || []
    : sessions || [];

  const trustScore = trustData?.score ?? 0;
  const canMatch = trustScore >= 30;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">ビジネスマッチング</h1>
            <p className="text-muted-foreground mt-2">
              友達の分身AIとあなたの分身AIが対話して、ビジネスの可能性を探ります
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
                  <p className="text-xs text-muted-foreground">
                    ターン数が多いほど具体的な結論が出るまで議論できます（15ターン以上推奨）
                  </p>
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

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : displayedSessions.length > 0 ? (
          <div className="grid gap-4">
            {displayedSessions.map((session: any) => (
              <Card key={session.id} className="hover:border-primary/50 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">{session.theme}</CardTitle>
                      {session.isNpcSession && (
                        <Badge variant="secondary" className="text-xs">チュートリアル</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(session.status)}
                      <span className="text-sm text-muted-foreground">
                        {getStatusText(session.status)}
                      </span>
                    </div>
                  </div>
                  <CardDescription>
                    {session.twin1?.name || `Twin #${session.twin1Id}`} × {session.twin2?.name || `Twin #${session.twin2Id}`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {new Date(session.createdAt).toLocaleDateString("ja-JP", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <div className="flex gap-2">
                      {session.status === "pending" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRunDialogue(session.id)}
                          disabled={runDialogue.isPending}
                        >
                          <Play className="h-4 w-4 mr-1" />
                          対話開始
                        </Button>
                      )}
                      <Link href={`/matching/${session.id}`}>
                        <Button size="sm">詳細を見る</Button>
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Users className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">マッチングセッションがありません</h3>
              <p className="text-muted-foreground text-center mb-4">
                友達の分身AIとマッチングして、ビジネスの可能性を探りましょう
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
    </DashboardLayout>
  );
}
