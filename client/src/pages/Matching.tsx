import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { useState } from "react";
import { toast } from "sonner";
import { Users, Plus, Loader2, Play, CheckCircle, XCircle, Clock, UserPlus, Bot } from "lucide-react";

export default function Matching() {
  const { data: myTwin } = trpc.myTwin.get.useQuery();
  const { data: friends } = trpc.friends.list.useQuery();
  const { data: sessions, isLoading, refetch } = trpc.matching.sessions.useQuery();

  const createSession = trpc.matching.create.useMutation();
  const runDialogue = trpc.matching.runDialogue.useMutation();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedFriendId, setSelectedFriendId] = useState("");
  const [theme, setTheme] = useState("");

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
      toast.info("分身AI同士の対話を開始しています...これには数分かかる場合があります");
      
      // 作成と同時に対話・分析も自動実行
      await createSession.mutateAsync({
        friendId: friend.friend.id,
        theme: theme,
        turns: 5,
      });

      toast.success("対話と分析が完了しました！");
      setIsCreateOpen(false);
      setSelectedFriendId("");
      setTheme("");
      refetch();
    } catch (error) {
      toast.error("作成に失敗しました");
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
            <DialogContent>
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
                <p className="font-medium">友達を追加しましょう</p>
                <p className="text-sm text-muted-foreground">
                  マッチングするには、分身AIを持つ友達が必要です
                </p>
              </div>
              <Link href="/friends">
                <Button variant="outline">友達を追加</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="pt-6">
                  <div className="h-32 bg-muted rounded-lg" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : sessions && sessions.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sessions.map((session) => (
              <Card key={session.id} className="hover:border-primary/50 transition-colors">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{session.theme}</CardTitle>
                    {getStatusIcon(session.status)}
                  </div>
                  <CardDescription>
                    {getStatusText(session.status)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex items-center gap-1 text-sm">
                      <Users className="h-4 w-4" />
                      <span>{session.twin1?.name}</span>
                    </div>
                    <span className="text-muted-foreground">×</span>
                    <span className="text-sm">{session.twin2?.name}</span>
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/matching/${session.id}`} className="flex-1">
                      <Button variant="outline" className="w-full" size="sm">
                        詳細を見る
                      </Button>
                    </Link>
                    {session.status === "pending" && (
                      <Button
                        size="sm"
                        onClick={() => handleRunDialogue(session.id)}
                        disabled={runDialogue.isPending}
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-16">
              <div className="text-center">
                <Users className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">マッチングセッションがありません</h3>
                <p className="text-muted-foreground mb-6">
                  友達の分身AIと対話して、ビジネスの可能性を探りましょう
                </p>
                {myTwin && friendsWithTwin.length > 0 && (
                  <Button onClick={() => setIsCreateOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    新規マッチング
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
