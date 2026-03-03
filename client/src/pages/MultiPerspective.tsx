import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Eye, Loader2, User, Users, Glasses, AlertCircle, Lightbulb } from "lucide-react";

type Perspective = "myTwin" | "opponentTwin" | "observer";

export default function MultiPerspective() {
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [activePerspective, setActivePerspective] = useState<Perspective>("myTwin");
  const sessions = trpc.matching.sessions.useQuery();
  const generateMutation = trpc.matching.generateMultiPerspective.useMutation();
  const savedData = trpc.matching.getMultiPerspective.useQuery(
    { sessionId: Number(selectedSessionId) },
    { enabled: !!selectedSessionId }
  );

  const handleGenerate = async () => {
    if (!selectedSessionId) return;
    try {
      await generateMutation.mutateAsync({ sessionId: Number(selectedSessionId) });
      toast.success("マルチ視点分析が完了しました");
      savedData.refetch();
    } catch (e: any) { toast.error(e.message || "分析に失敗しました"); }
  };

  const data = generateMutation.data || savedData.data;
  const perspectives = data?.perspectives || {};
  const gap = data?.perspectiveGap || {};

  const perspectiveConfig: Record<Perspective, { label: string; icon: any; color: string }> = {
    myTwin: { label: perspectives.myTwin?.name || "自分のツイン", icon: User, color: "text-blue-500" },
    opponentTwin: { label: perspectives.opponentTwin?.name || "相手のツイン", icon: Users, color: "text-red-500" },
    observer: { label: "中立オブザーバー", icon: Glasses, color: "text-green-500" },
  };

  const currentTurns = activePerspective === "observer"
    ? perspectives.observer?.turns || []
    : perspectives[activePerspective]?.turns || [];

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Eye className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">マルチ視点リプレイ</h1>
            <p className="text-sm text-muted-foreground">同じ対話を3つの異なる視点から分析</p>
          </div>
        </div>

        <Card>
          <CardContent className="flex gap-3 p-4">
            <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="マッチングセッションを選択" /></SelectTrigger>
              <SelectContent>
                {(sessions.data || []).filter((s: any) => s.status === "completed").map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.theme} (#{s.id})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleGenerate} disabled={!selectedSessionId || generateMutation.isPending}>
              {generateMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />分析中...</> : "3視点分析"}
            </Button>
          </CardContent>
        </Card>

        {data && (
          <Tabs defaultValue="perspectives">
            <TabsList>
              <TabsTrigger value="perspectives">視点分析</TabsTrigger>
              <TabsTrigger value="gap">ギャップ分析</TabsTrigger>
            </TabsList>

            <TabsContent value="perspectives" className="space-y-4 mt-4">
              <div className="flex gap-2">
                {(Object.keys(perspectiveConfig) as Perspective[]).map((key) => {
                  const cfg = perspectiveConfig[key];
                  const Icon = cfg.icon;
                  return (
                    <Button key={key} variant={activePerspective === key ? "default" : "outline"} size="sm" onClick={() => setActivePerspective(key)}>
                      <Icon className={`h-4 w-4 mr-1 ${activePerspective === key ? "" : cfg.color}`} />
                      {cfg.label}
                    </Button>
                  );
                })}
              </div>

              {currentTurns.length === 0 && <p className="text-center text-muted-foreground py-4">データがありません</p>}
              {currentTurns.map((turn: any, i: number) => (
                <Card key={i}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">ターン {turn.turnNumber}</Badge>
                    </div>
                    {activePerspective !== "observer" ? (
                      <>
                        <div className="p-3 rounded-lg bg-muted/50">
                          <p className="text-xs font-medium text-muted-foreground mb-1">内心モノローグ</p>
                          <p className="text-sm">{turn.innerMonologue}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-blue-500/5">
                          <p className="text-xs font-medium text-blue-500 mb-1">戦略意図</p>
                          <p className="text-sm">{turn.strategicIntent}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-pink-500/5">
                          <p className="text-xs font-medium text-pink-500 mb-1">感情変化</p>
                          <p className="text-sm">{turn.emotionChange}</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="p-3 rounded-lg bg-muted/50">
                          <p className="text-xs font-medium text-muted-foreground mb-1">分析</p>
                          <p className="text-sm">{turn.analysis}</p>
                        </div>
                        {turn.technique && (
                          <div className="p-3 rounded-lg bg-green-500/5">
                            <p className="text-xs font-medium text-green-500 mb-1">テクニック</p>
                            <p className="text-sm">{turn.technique}</p>
                          </div>
                        )}
                        {turn.suggestion && (
                          <div className="p-3 rounded-lg bg-amber-500/5">
                            <p className="text-xs font-medium text-amber-500 mb-1">提案</p>
                            <p className="text-sm">{turn.suggestion}</p>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="gap" className="space-y-4 mt-4">
              {gap.summary && (
                <Card>
                  <CardHeader><CardTitle>視点間ギャップ要約</CardTitle></CardHeader>
                  <CardContent><p className="text-sm whitespace-pre-wrap">{gap.summary}</p></CardContent>
                </Card>
              )}
              {(gap.keyDifferences || []).length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><AlertCircle className="h-5 w-5 text-amber-500" />主要な相違点</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {gap.keyDifferences.map((d: string, i: number) => (
                      <div key={i} className="flex items-start gap-2 p-2 rounded border">
                        <Badge variant="outline" className="shrink-0">{i + 1}</Badge>
                        <p className="text-sm">{d}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              {(gap.insights || []).length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><Lightbulb className="h-5 w-5 text-yellow-500" />インサイト</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {gap.insights.map((ins: string, i: number) => (
                      <div key={i} className="flex items-start gap-2 p-2 rounded border">
                        <Lightbulb className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
                        <p className="text-sm">{ins}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  );
}
