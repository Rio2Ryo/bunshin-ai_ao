import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Swords, Loader2, Plus, Play, Trophy, Users, Crown, Shield, Zap } from "lucide-react";

const ROLE_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  leader: { label: "リーダー", icon: Crown, color: "text-yellow-500" },
  supporter: { label: "サポーター", icon: Shield, color: "text-blue-500" },
  specialist: { label: "スペシャリスト", icon: Zap, color: "text-purple-500" },
};

export default function TeamBattle() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [theme, setTheme] = useState("");
  const [selectedBattleId, setSelectedBattleId] = useState<number | null>(null);

  const friends = trpc.friends.list.useQuery();
  const battles = trpc.matching.listTeamBattles.useQuery();
  const battleDetail = trpc.matching.getTeamBattle.useQuery(
    { battleId: selectedBattleId! },
    { enabled: !!selectedBattleId }
  );
  const createMutation = trpc.matching.createTeamBattle.useMutation();
  const runMutation = trpc.matching.runTeamBattle.useMutation();

  const [teamAIds, setTeamAIds] = useState<number[]>([]);
  const [teamBIds, setTeamBIds] = useState<number[]>([]);

  const friendList = (friends.data || []).filter((f: any) => f.status === "accepted");

  const toggleTeam = (userId: number, team: "A" | "B") => {
    if (team === "A") {
      setTeamBIds(prev => prev.filter(id => id !== userId));
      setTeamAIds(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);
    } else {
      setTeamAIds(prev => prev.filter(id => id !== userId));
      setTeamBIds(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);
    }
  };

  const handleCreate = async () => {
    if (!theme.trim() || teamAIds.length === 0 || teamBIds.length === 0) {
      toast.error("テーマと両チームのメンバーを設定してください");
      return;
    }
    try {
      const result = await createMutation.mutateAsync({
        theme: theme.trim(),
        teamAUserIds: teamAIds,
        teamBUserIds: teamBIds,
      });
      toast.success("チーム対抗戦を作成しました");
      setDialogOpen(false);
      setTheme("");
      setTeamAIds([]);
      setTeamBIds([]);
      if (result.id) setSelectedBattleId(Number(result.id));
      battles.refetch();
    } catch (e: any) { toast.error(e.message || "作成に失敗しました"); }
  };

  const handleRun = async (battleId: number) => {
    try {
      await runMutation.mutateAsync({ battleId });
      toast.success("チーム対抗戦が完了しました");
      battleDetail.refetch();
      battles.refetch();
    } catch (e: any) { toast.error(e.message || "実行に失敗しました"); }
  };

  const detail = battleDetail.data;
  const resultData = detail?.result || {};

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Swords className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">チーム対抗戦</h1>
              <p className="text-sm text-muted-foreground">ツインチームで白熱のディスカッション</p>
            </div>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />対抗戦を作成</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>新しいチーム対抗戦</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>テーマ</Label>
                  <Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="ディスカッションテーマ" />
                </div>
                <div>
                  <Label>メンバー選択（友達をチームに振り分け）</Label>
                  <div className="space-y-2 mt-2 max-h-60 overflow-y-auto">
                    {friendList.map((f: any) => {
                      const inA = teamAIds.includes(f.friendUserId);
                      const inB = teamBIds.includes(f.friendUserId);
                      return (
                        <div key={f.id} className="flex items-center gap-2 p-2 rounded border">
                          <span className="flex-1 text-sm">{f.friendName || `Friend#${f.friendUserId}`}</span>
                          <Button size="sm" variant={inA ? "default" : "outline"} onClick={() => toggleTeam(f.friendUserId, "A")} className="text-xs h-7">
                            チームA
                          </Button>
                          <Button size="sm" variant={inB ? "default" : "outline"} onClick={() => toggleTeam(f.friendUserId, "B")} className="text-xs h-7">
                            チームB
                          </Button>
                        </div>
                      );
                    })}
                    {friendList.length === 0 && <p className="text-sm text-muted-foreground">友達がいません</p>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">チームA: {teamAIds.length}人 / チームB: {teamBIds.length}人</p>
                </div>
                <Button onClick={handleCreate} disabled={createMutation.isPending} className="w-full">
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Swords className="h-4 w-4 mr-2" />}作成
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="battles">
          <TabsList>
            <TabsTrigger value="battles">対抗戦一覧</TabsTrigger>
            <TabsTrigger value="detail">詳細・結果</TabsTrigger>
          </TabsList>

          <TabsContent value="battles" className="space-y-4 mt-4">
            {(battles.data || []).length === 0 && <p className="text-center text-muted-foreground py-8">対抗戦がまだありません</p>}
            {(battles.data || []).map((b: any) => (
              <Card key={b.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelectedBattleId(b.id)}>
                <CardContent className="flex items-center gap-4 p-4">
                  <Swords className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">{b.theme}</p>
                    <p className="text-sm text-muted-foreground">
                      チームA({(b.teamAMembers || []).length}人) vs チームB({(b.teamBMembers || []).length}人)
                    </p>
                  </div>
                  <Badge variant={b.status === "completed" ? "default" : b.status === "in_progress" ? "secondary" : "outline"}>
                    {b.status === "completed" ? "完了" : b.status === "in_progress" ? "進行中" : "未開始"}
                  </Badge>
                  {b.status === "pending" && (
                    <Button size="sm" onClick={(e) => { e.stopPropagation(); handleRun(b.id); }} disabled={runMutation.isPending}>
                      {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="detail" className="space-y-4 mt-4">
            {!selectedBattleId && <p className="text-center text-muted-foreground py-8">対抗戦を選択してください</p>}
            {detail && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>{detail.theme}</CardTitle>
                    <CardDescription>
                      チームA({(detail.teamAMembers || []).length}人) vs チームB({(detail.teamBMembers || []).length}人)
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-4 flex-wrap">
                      {(detail.members || []).map((m: any) => {
                        const roleCfg = ROLE_CONFIG[m.role] || ROLE_CONFIG.supporter;
                        const Icon = roleCfg.icon;
                        return (
                          <div key={m.id} className="flex items-center gap-2 p-2 rounded border">
                            <Badge variant={m.team === "A" ? "default" : "secondary"}>チーム{m.team}</Badge>
                            <Icon className={`h-4 w-4 ${roleCfg.color}`} />
                            <span className="text-sm">{m.userName}</span>
                            <span className="text-xs text-muted-foreground">({roleCfg.label})</span>
                          </div>
                        );
                      })}
                    </div>
                    {detail.status === "pending" && (
                      <Button className="mt-4" onClick={() => handleRun(detail.id)} disabled={runMutation.isPending}>
                        {runMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />実行中...</> : <><Play className="h-4 w-4 mr-2" />対抗戦を開始</>}
                      </Button>
                    )}
                  </CardContent>
                </Card>

                {(detail.dialogue || []).length > 0 && (
                  <Card>
                    <CardHeader><CardTitle>対話</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {detail.dialogue.map((d: any, i: number) => (
                        <div key={i} className={`p-3 rounded-lg ${d.team === "A" ? "bg-blue-500/10 border-l-4 border-blue-500" : "bg-red-500/10 border-l-4 border-red-500"}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant={d.team === "A" ? "default" : "secondary"} className="text-xs">チーム{d.team}</Badge>
                            <span className="text-sm font-medium">{d.speaker}</span>
                            <span className="text-xs text-muted-foreground">ターン {d.turn}</span>
                          </div>
                          <p className="text-sm">{d.content}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {resultData.teamAScore && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card className="border-blue-500/30">
                      <CardHeader><CardTitle className="text-blue-500">チームA スコア</CardTitle></CardHeader>
                      <CardContent className="space-y-2">
                        <div className="flex justify-between"><span className="text-sm">協調性</span><span className="font-bold">{resultData.teamAScore.cooperation}</span></div>
                        <div className="flex justify-between"><span className="text-sm">論証力</span><span className="font-bold">{resultData.teamAScore.argumentation}</span></div>
                        <div className="flex justify-between"><span className="text-sm">創造性</span><span className="font-bold">{resultData.teamAScore.creativity}</span></div>
                        <div className="flex justify-between border-t pt-2"><span className="text-sm font-medium">総合</span><span className="text-lg font-bold">{resultData.teamAScore.overall}</span></div>
                      </CardContent>
                    </Card>
                    <Card className="border-red-500/30">
                      <CardHeader><CardTitle className="text-red-500">チームB スコア</CardTitle></CardHeader>
                      <CardContent className="space-y-2">
                        <div className="flex justify-between"><span className="text-sm">協調性</span><span className="font-bold">{resultData.teamBScore?.cooperation}</span></div>
                        <div className="flex justify-between"><span className="text-sm">論証力</span><span className="font-bold">{resultData.teamBScore?.argumentation}</span></div>
                        <div className="flex justify-between"><span className="text-sm">創造性</span><span className="font-bold">{resultData.teamBScore?.creativity}</span></div>
                        <div className="flex justify-between border-t pt-2"><span className="text-sm font-medium">総合</span><span className="text-lg font-bold">{resultData.teamBScore?.overall}</span></div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {resultData.mvp && (
                  <Card className="border-yellow-500/30">
                    <CardContent className="flex items-center gap-4 p-4">
                      <Trophy className="h-8 w-8 text-yellow-500" />
                      <div>
                        <p className="font-bold text-lg">MVP: {resultData.mvp.name}</p>
                        <p className="text-sm text-muted-foreground">チーム{resultData.mvp.team} - {resultData.mvp.reason}</p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {resultData.summary && (
                  <Card>
                    <CardHeader><CardTitle>総評</CardTitle></CardHeader>
                    <CardContent><p className="text-sm whitespace-pre-wrap">{resultData.summary}</p></CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
