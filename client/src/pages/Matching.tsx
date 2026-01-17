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
import { Users, Plus, Loader2, Play, CheckCircle, XCircle, Clock } from "lucide-react";

export default function Matching() {
  const { data: twins } = trpc.twins.list.useQuery();
  const { data: sessions, isLoading, refetch } = trpc.matching.sessions.useQuery();

  const createSession = trpc.matching.create.useMutation();
  const runDialogue = trpc.matching.runDialogue.useMutation();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newSession, setNewSession] = useState({
    twin1Id: "",
    twin2Id: "",
    theme: "",
  });

  const handleCreate = async () => {
    if (!newSession.twin1Id || !newSession.twin2Id || !newSession.theme.trim()) {
      toast.error("すべての項目を入力してください");
      return;
    }

    if (newSession.twin1Id === newSession.twin2Id) {
      toast.error("異なる分身AIを選択してください");
      return;
    }

    try {
      const result = await createSession.mutateAsync({
        twin1Id: parseInt(newSession.twin1Id),
        twin2Id: parseInt(newSession.twin2Id),
        theme: newSession.theme,
      });

      toast.success("マッチングセッションを作成しました");
      setIsCreateOpen(false);
      setNewSession({ twin1Id: "", twin2Id: "", theme: "" });
      refetch();

      // 自動的に対話を開始
      toast.info("対話を開始しています...");
      await runDialogue.mutateAsync({ sessionId: result.id, turns: 5 });
      toast.success("対話が完了しました");
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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">ビジネスマッチング</h1>
            <p className="text-muted-foreground mt-2">
              分身AI同士が対話し、ビジネスの協業可能性を探ります。
            </p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                新規マッチング
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>新規マッチング</DialogTitle>
                <DialogDescription>
                  2つの分身AIを選択し、対話テーマを設定してください。
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>分身AI 1（あなた）</Label>
                  <Select
                    value={newSession.twin1Id}
                    onValueChange={(value) => setNewSession({ ...newSession, twin1Id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="分身AIを選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {twins?.map((twin) => (
                        <SelectItem key={twin.id} value={String(twin.id)}>
                          {twin.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>分身AI 2（相手）</Label>
                  <Select
                    value={newSession.twin2Id}
                    onValueChange={(value) => setNewSession({ ...newSession, twin2Id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="分身AIを選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {twins?.map((twin) => (
                        <SelectItem key={twin.id} value={String(twin.id)}>
                          {twin.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    ※ 将来的には他のユーザーの分身AIも選択可能になります
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>対話テーマ</Label>
                  <Input
                    value={newSession.theme}
                    onChange={(e) => setNewSession({ ...newSession, theme: e.target.value })}
                    placeholder="例: AI技術を活用した新規事業の可能性"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                    キャンセル
                  </Button>
                  <Button
                    onClick={handleCreate}
                    disabled={createSession.isPending || runDialogue.isPending}
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

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[1, 2].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="pt-6">
                  <div className="h-32 bg-muted rounded-lg" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : sessions && sessions.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {sessions.map((session) => (
              <Card key={session.id} className="hover:border-primary/50 transition-colors">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg line-clamp-1">{session.theme}</CardTitle>
                      <CardDescription className="flex items-center gap-2 mt-1">
                        {getStatusIcon(session.status)}
                        {getStatusText(session.status)}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" />
                      <span>Twin #{session.twin1Id}</span>
                      <span>×</span>
                      <span>Twin #{session.twin2Id}</span>
                    </div>
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
                        {runDialogue.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
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
                <h3 className="text-xl font-semibold mb-2">マッチング履歴がありません</h3>
                <p className="text-muted-foreground mb-6">
                  分身AI同士の対話を開始して、ビジネスマッチングを行いましょう。
                </p>
                <Button onClick={() => setIsCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  新規マッチング
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
