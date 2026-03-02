import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { FlaskConical, Play, Loader2, Trophy, ArrowRight, BarChart3 } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function ABTest() {
  const { data: friends } = trpc.friends.list.useQuery();
  const { data: abTests, isLoading } = trpc.matching.abTestList.useQuery();
  const createMut = trpc.matching.abTestCreate.useMutation({
    onSuccess: (data) => {
      toast.success("A/Bテストを作成しました");
      setOpen(false);
      toast.info(`セッションA: #${data.sessionIdA}, セッションB: #${data.sessionIdB} — マッチングページから実行してください`);
      utils.matching.abTestList.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const utils = trpc.useUtils();

  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState("");
  const [friendId, setFriendId] = useState("");
  const [personalityA, setPersonalityA] = useState("");
  const [personalityB, setPersonalityB] = useState("");
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");

  const { data: comparison } = trpc.matching.abTestResults.useQuery(
    { sessionIdA: parseInt(compareA), sessionIdB: parseInt(compareB) },
    { enabled: !!compareA && !!compareB },
  );

  // Group abTests into A/B pairs
  const testPairs: { a: any; b: any }[] = [];
  const tests = abTests ?? [];
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i] as any;
    if (t.settings?.variant === "A") {
      const bTest = tests.find((x: any, j: number) => j > i && (x as any).settings?.variant === "B" && (x as any).theme === t.theme);
      if (bTest) testPairs.push({ a: t, b: bTest as any });
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><FlaskConical className="h-6 w-6" />ツインA/Bテスト</h1>
            <p className="text-muted-foreground">異なる人格設定のツインを比較してスコアを分析</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Play className="h-4 w-4 mr-2" />新規テスト</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>A/Bテスト作成</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <Input placeholder="対話テーマ" value={theme} onChange={e => setTheme(e.target.value)} />
                <Select value={friendId} onValueChange={setFriendId}>
                  <SelectTrigger><SelectValue placeholder="対話相手を選択" /></SelectTrigger>
                  <SelectContent>
                    {(friends as any)?.map((f: any) => (
                      <SelectItem key={f.friendId} value={String(f.friendId)}>{f.friendName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-sm font-medium mb-1">パターンA</p>
                    <Textarea placeholder="例: 積極的で外向的、リーダーシップ重視" value={personalityA} onChange={e => setPersonalityA(e.target.value)} rows={3} />
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-1">パターンB</p>
                    <Textarea placeholder="例: 慎重で分析的、データ重視" value={personalityB} onChange={e => setPersonalityB(e.target.value)} rows={3} />
                  </div>
                </div>
                <Button className="w-full" onClick={() => createMut.mutate({ theme, friendId: parseInt(friendId), personalityA, personalityB })}
                  disabled={!theme || !friendId || !personalityA || !personalityB || createMut.isPending}>
                  {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}テスト作成
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Comparison viewer */}
        {comparison && (
          <Card className="border-primary">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" />比較結果</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-sm text-muted-foreground">パターンA</p>
                  <p className="text-3xl font-bold">{comparison.comparison.scoreA}%</p>
                  <p className="text-xs text-muted-foreground">{comparison.a.session.settings?.personality?.slice(0, 30)}</p>
                </div>
                <div className="flex flex-col items-center justify-center">
                  <Trophy className={`h-8 w-8 ${comparison.comparison.winner === "tie" ? "text-yellow-500" : "text-green-500"}`} />
                  <p className="text-lg font-bold mt-1">
                    {comparison.comparison.winner === "tie" ? "引き分け" : `${comparison.comparison.winner}の勝ち`}
                  </p>
                  <p className="text-sm text-muted-foreground">差: {comparison.comparison.scoreDiff}pt</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">パターンB</p>
                  <p className="text-3xl font-bold">{comparison.comparison.scoreB}%</p>
                  <p className="text-xs text-muted-foreground">{comparison.b.session.settings?.personality?.slice(0, 30)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Test list */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : !testPairs.length ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <FlaskConical className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>A/Bテストがありません</p>
            <p className="text-sm">「新規テスト」から異なる人格設定を比較しましょう</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {testPairs.map((pair, i) => (
              <Card key={i}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{pair.a.theme}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline">A: {pair.a.compatibilityScore ?? "未実行"}%</Badge>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <Badge variant="outline">B: {pair.b.compatibilityScore ?? "未実行"}%</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {pair.a.status === "completed" && pair.b.status === "completed" && (
                        <Button size="sm" variant="outline" onClick={() => { setCompareA(String(pair.a.id)); setCompareB(String(pair.b.id)); }}>
                          <BarChart3 className="h-4 w-4 mr-1" />比較
                        </Button>
                      )}
                      <Link href={`/matching/${pair.a.id}`}><Button size="sm" variant="ghost">A実行</Button></Link>
                      <Link href={`/matching/${pair.b.id}`}><Button size="sm" variant="ghost">B実行</Button></Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
