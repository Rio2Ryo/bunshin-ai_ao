import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Trophy, Swords, Loader2, Play, Crown, Medal, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useParams, Link } from "wouter";
import { toast } from "sonner";

function TournamentList() {
  const { data: workspaces } = trpc.workspace.list.useQuery();
  const [wsId, setWsId] = useState<string>("");
  const { data: tournaments, isLoading } = trpc.tournament.list.useQuery({ workspaceId: parseInt(wsId || "0") }, { enabled: !!wsId });
  const utils = trpc.useUtils();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [theme, setTheme] = useState("");
  const createMut = trpc.tournament.create.useMutation({
    onSuccess: (d) => { toast.success(`トーナメント作成 (${d.matchCount}試合)`); setCreateOpen(false); utils.tournament.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  // Get workspace members for participant selection
  const { data: wsDetail } = trpc.workspace.get.useQuery({ id: parseInt(wsId || "0") }, { enabled: !!wsId });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const toggleParticipant = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Trophy className="h-6 w-6" />マッチングトーナメント</h1>
            <p className="text-muted-foreground">ワークスペース内で総当たりマッチング</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Select value={wsId} onValueChange={setWsId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="ワークスペースを選択" /></SelectTrigger>
            <SelectContent>
              {workspaces?.map((w: any) => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {wsId && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild><Button><Swords className="h-4 w-4 mr-2" />新規トーナメント</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>トーナメント作成</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <Input placeholder="トーナメント名" value={name} onChange={e => setName(e.target.value)} />
                  <Input placeholder="対話テーマ" value={theme} onChange={e => setTheme(e.target.value)} />
                  <div>
                    <p className="text-sm font-medium mb-2">参加者を選択 (2人以上)</p>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {wsDetail?.members?.map((m: any) => (
                        <label key={m.userId} className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer">
                          <input type="checkbox" checked={selectedIds.includes(m.userId)} onChange={() => toggleParticipant(m.userId)} className="rounded" />
                          <span className="text-sm">{m.name || "ユーザー"}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{selectedIds.length}人選択 → {selectedIds.length > 1 ? `${(selectedIds.length * (selectedIds.length - 1)) / 2}試合` : "—"}</p>
                  </div>
                  <Button className="w-full" onClick={() => createMut.mutate({ workspaceId: parseInt(wsId), name, theme, participantIds: selectedIds })}
                    disabled={!name || !theme || selectedIds.length < 2 || createMut.isPending}>
                    {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}作成
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {!wsId ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">ワークスペースを選択してください</CardContent></Card>
        ) : isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : !tournaments?.length ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground"><Trophy className="h-12 w-12 mx-auto mb-4 opacity-50" /><p>トーナメントがありません</p></CardContent></Card>
        ) : (
          <div className="space-y-3">
            {tournaments.map((t: any) => (
              <Link key={t.id} href={`/tournament/${t.id}`}>
                <Card className="cursor-pointer hover:border-primary transition-colors">
                  <CardContent className="py-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{t.name}</p>
                      <p className="text-sm text-muted-foreground">{t.theme}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={t.status === "completed" ? "default" : "secondary"}>{t.status === "completed" ? "完了" : t.status === "running" ? "進行中" : "未開始"}</Badge>
                      {t.results?.mvpName && <Badge className="bg-yellow-500"><Crown className="h-3 w-3 mr-1" />MVP: {t.results.mvpName}</Badge>}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function TournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const tournamentId = parseInt(id || "0");
  const { data: t, isLoading } = trpc.tournament.get.useQuery({ id: tournamentId }, { enabled: !!tournamentId });
  const utils = trpc.useUtils();
  const runMatchMut = trpc.tournament.runMatch.useMutation({
    onSuccess: (d) => { toast.success(`試合完了: ${d.player1Score} vs ${d.player2Score}`); utils.tournament.get.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const runAllMut = trpc.tournament.runAll.useMutation({
    onSuccess: async (d) => {
      toast.info(`${d.totalCount}試合を順次実行中...`);
      for (const m of d.pendingMatches) {
        try { await runMatchMut.mutateAsync({ matchId: m.matchId }); } catch { /* continue */ }
      }
      toast.success("全試合完了！");
    },
  });

  if (isLoading) return <DashboardLayout><div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></DashboardLayout>;
  if (!t) return <DashboardLayout><div className="p-6 text-center">トーナメントが見つかりません</div></DashboardLayout>;

  const pendingMatches = (t.matches as any[])?.filter((m: any) => m.status === "pending") ?? [];

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/tournament"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{t.name}</h1>
            <p className="text-muted-foreground">{t.theme}</p>
          </div>
          {pendingMatches.length > 0 && (
            <Button onClick={() => runAllMut.mutate({ tournamentId })} disabled={runAllMut.isPending || runMatchMut.isPending}>
              {(runAllMut.isPending || runMatchMut.isPending) ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
              全試合実行 ({pendingMatches.length}試合)
            </Button>
          )}
        </div>

        {/* Standings */}
        {t.standings && (t.standings as any[]).length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Medal className="h-4 w-4" />順位表</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(t.standings as any[]).map((s: any, i: number) => (
                  <div key={s.userId} className={`flex items-center justify-between p-2 rounded ${i === 0 ? "bg-yellow-500/10 border border-yellow-500/30" : "bg-muted/50"}`}>
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold w-8">{i === 0 ? "\u{1F947}" : i === 1 ? "\u{1F948}" : i === 2 ? "\u{1F949}" : `${i + 1}.`}</span>
                      <span className="font-medium">{s.name}</span>
                      {i === 0 && t.status === "completed" && <Badge className="bg-yellow-500 text-xs">MVP</Badge>}
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-green-500">{s.wins}勝</span>
                      <span className="text-red-500">{s.losses}敗</span>
                      <span className="text-muted-foreground">{s.draws}分</span>
                      <span className="font-medium">合計: {s.totalScore}pt</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Match list */}
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Swords className="h-5 w-5" />試合一覧</h2>
          <div className="space-y-2">
            {(t.matches as any[])?.map((m: any) => (
              <Card key={m.id}>
                <CardContent className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`font-medium ${m.winnerId === m.player1UserId ? "text-green-500" : ""}`}>{m.player1Name}</span>
                    {m.status === "completed" ? (
                      <span className="text-sm font-bold">{m.player1Score} - {m.player2Score}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">vs</span>
                    )}
                    <span className={`font-medium ${m.winnerId === m.player2UserId ? "text-green-500" : ""}`}>{m.player2Name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.status === "completed" ? (
                      <Badge variant="outline">完了</Badge>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => runMatchMut.mutate({ matchId: m.id })} disabled={runMatchMut.isPending}>
                        <Play className="h-3 w-3 mr-1" />実行
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function Tournament() {
  const { id } = useParams<{ id: string }>();
  if (id) return <TournamentDetail />;
  return <TournamentList />;
}
