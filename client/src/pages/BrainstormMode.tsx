import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Zap, History, Loader2, Lightbulb, ArrowRight, Star } from "lucide-react";
import { toast } from "sonner";

export default function BrainstormMode() {
  const [tab, setTab] = useState("brainstorm");
  const [theme, setTheme] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const activeSession = trpc.matching.getBrainstorm.useQuery({ sessionId: activeId! }, { enabled: !!activeId });
  const _detail = trpc.matching.getBrainstorm.useQuery({ sessionId: selectedId! }, { enabled: !!selectedId });
  void _detail;
  const brainstorms = trpc.matching.listBrainstorms.useQuery();
  const startMutation = trpc.matching.startBrainstorm.useMutation();
  const convergeMutation = trpc.matching.convergeBrainstorm.useMutation();
  const utils = trpc.useUtils();

  const handleStart = async () => {
    if (!theme.trim()) return;
    try {
      const res = await startMutation.mutateAsync({ theme });
      setActiveId(res.sessionId as number);
      toast.success(`${res.ideas.length}個のアイデアが生成されました`);
    } catch { toast.error("開始に失敗しました"); }
  };

  const handleConverge = async () => {
    if (!activeId) return;
    try {
      await convergeMutation.mutateAsync({ sessionId: activeId });
      utils.matching.getBrainstorm.invalidate({ sessionId: activeId });
      utils.matching.listBrainstorms.invalidate();
      toast.success("収束フェーズが完了しました");
    } catch { toast.error("収束に失敗しました"); }
  };

  const session = activeSession.data;
  const PHASE_LABELS: Record<string, string> = { diverge: "発散", converge: "収束中", complete: "完了" };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">ブレインストーミング</h1>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="brainstorm"><Zap className="h-4 w-4 mr-1" />ブレスト</TabsTrigger>
            <TabsTrigger value="history"><History className="h-4 w-4 mr-1" />履歴</TabsTrigger>
          </TabsList>

          <TabsContent value="brainstorm">
            {!activeId || session?.phase === "complete" ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader><CardTitle>新しいブレスト</CardTitle><CardDescription>ツイン同士がアイデアを出し合い、最適プランを生成</CardDescription></CardHeader>
                  <CardContent className="space-y-3">
                    <Input placeholder="テーマを入力" value={theme} onChange={e => setTheme(e.target.value)} onKeyDown={e => e.key === "Enter" && handleStart()} />
                    <Button onClick={handleStart} disabled={startMutation.isPending || !theme.trim()}>
                      {startMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
                      ブレスト開始
                    </Button>
                  </CardContent>
                </Card>

                {session?.phase === "complete" && (
                  <>
                    {session.evaluation && (
                      <Card className="border-primary">
                        <CardHeader><CardTitle>評価結果</CardTitle></CardHeader>
                        <CardContent>
                          <p className="text-sm">{session.evaluation.overallQuality}</p>
                          {session.evaluation.bestIdea && <p className="text-sm mt-2 text-muted-foreground">最も革新的: {session.evaluation.bestIdea}</p>}
                        </CardContent>
                      </Card>
                    )}
                    {(session.topPlans ?? []).map((p: any) => (
                      <Card key={p.rank}>
                        <CardHeader><CardTitle className="flex items-center gap-2"><Star className="h-5 w-5 text-yellow-500" />#{p.rank} {p.title}</CardTitle></CardHeader>
                        <CardContent className="space-y-2">
                          <p className="text-sm">{p.description}</p>
                          <div className="grid grid-cols-3 gap-2">
                            <div><p className="text-xs text-muted-foreground">独自性</p><Progress value={p.originality} className="h-2" /><span className="text-xs">{p.originality}</span></div>
                            <div><p className="text-xs text-muted-foreground">実現性</p><Progress value={p.feasibility} className="h-2" /><span className="text-xs">{p.feasibility}</span></div>
                            <div><p className="text-xs text-muted-foreground">インパクト</p><Progress value={p.impact} className="h-2" /><span className="text-xs">{p.impact}</span></div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge>{session?.theme}</Badge>
                    <Badge variant="secondary">{PHASE_LABELS[session?.phase || "diverge"]}</Badge>
                  </div>
                  {session?.phase === "diverge" && (
                    <Button onClick={handleConverge} disabled={convergeMutation.isPending}>
                      {convergeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                      収束フェーズへ
                    </Button>
                  )}
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  {(session?.ideas ?? []).map((idea: any) => (
                    <Card key={idea.id}>
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-1">
                          <Lightbulb className="h-4 w-4 text-yellow-500" />
                          <Badge variant="outline">{idea.author}</Badge>
                          {idea.category && <Badge variant="secondary" className="text-xs">{idea.category}</Badge>}
                        </div>
                        <p className="text-sm">{idea.idea}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {session?.clusters?.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle>クラスター</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      {session.clusters.map((c: any, i: number) => (
                        <div key={i} className="p-2 border rounded"><p className="font-medium text-sm">{c.name}</p><p className="text-xs text-muted-foreground">{c.summary}</p></div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history">
            <div className="space-y-2">
              {(brainstorms.data ?? []).map((b: any) => (
                <Card key={b.id} className={selectedId === b.id ? "ring-2 ring-primary" : "cursor-pointer hover:border-primary"} onClick={() => { setSelectedId(b.id); setActiveId(b.id); }}>
                  <CardContent className="pt-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{b.theme}</p>
                      <p className="text-xs text-muted-foreground">{new Date(b.createdAt).toLocaleDateString("ja-JP")}</p>
                    </div>
                    <Badge variant={b.phase === "complete" ? "default" : "secondary"}>{PHASE_LABELS[b.phase] || b.phase}</Badge>
                  </CardContent>
                </Card>
              ))}
              {!brainstorms.data?.length && <p className="text-muted-foreground">履歴がありません</p>}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
