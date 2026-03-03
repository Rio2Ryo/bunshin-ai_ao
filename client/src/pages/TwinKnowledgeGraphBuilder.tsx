import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Network, AlertCircle, GitCompareArrows, Loader2 } from "lucide-react";
import { toast } from "sonner";

const NODE_COLORS: Record<string, string> = { concept: "#3b82f6", person: "#ec4899", skill: "#10b981", industry: "#f59e0b", topic: "#8b5cf6" };
const SEVERITY_COLORS: Record<string, string> = { high: "destructive", medium: "default", low: "secondary" };

export default function TwinKnowledgeGraphBuilder() {
  const [tab, setTab] = useState("graph");
  const [friendId, setFriendId] = useState<number | null>(null);

  const graphData = trpc.myTwin.getKnowledgeGraphData.useQuery();
  const gaps = trpc.myTwin.getKnowledgeGaps.useQuery();
  const stats = trpc.myTwin.getKnowledgeGraphStats.useQuery();
  const friends = trpc.friends.list.useQuery();
  const buildMutation = trpc.myTwin.buildKnowledgeGraph.useMutation();
  const compareMutation = trpc.myTwin.compareKnowledgeGraphs.useMutation();
  const utils = trpc.useUtils();

  const handleBuild = async () => {
    try {
      await buildMutation.mutateAsync();
      utils.myTwin.getKnowledgeGraphData.invalidate();
      utils.myTwin.getKnowledgeGaps.invalidate();
      utils.myTwin.getKnowledgeGraphStats.invalidate();
      toast.success("ナレッジグラフを構築しました");
    } catch {
      toast.error("構築に失敗しました");
    }
  };

  const handleCompare = async () => {
    if (!friendId) return;
    try {
      await compareMutation.mutateAsync({ friendId });
    } catch (e: any) {
      toast.error(e.message || "比較に失敗しました");
    }
  };

  const nodes = graphData.data?.nodes ?? [];
  const edges = graphData.data?.edges ?? [];

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">知識グラフ</h1>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="graph"><Network className="h-4 w-4 mr-1" />グラフ構築</TabsTrigger>
            <TabsTrigger value="gaps"><AlertCircle className="h-4 w-4 mr-1" />知識の穴</TabsTrigger>
            <TabsTrigger value="compare"><GitCompareArrows className="h-4 w-4 mr-1" />比較</TabsTrigger>
          </TabsList>

          <TabsContent value="graph">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Button onClick={handleBuild} disabled={buildMutation.isPending}>
                  {buildMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Network className="h-4 w-4 mr-2" />}
                  グラフを構築
                </Button>
                {stats.data && <span className="text-xs text-muted-foreground">最終更新: {stats.data.updatedAt ? new Date(stats.data.updatedAt).toLocaleDateString("ja-JP") : "なし"}</span>}
              </div>

              {stats.data && (
                <div className="grid grid-cols-4 gap-3">
                  <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold">{stats.data.totalNodes || nodes.length}</p><p className="text-xs text-muted-foreground">ノード数</p></CardContent></Card>
                  <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold">{stats.data.totalEdges || edges.length}</p><p className="text-xs text-muted-foreground">エッジ数</p></CardContent></Card>
                  <Card><CardContent className="pt-4 text-center"><p className="text-sm font-medium">{stats.data.densestArea || "-"}</p><p className="text-xs text-muted-foreground">最も密な領域</p></CardContent></Card>
                  <Card><CardContent className="pt-4 text-center"><p className="text-sm font-medium">{stats.data.sparsestArea || "-"}</p><p className="text-xs text-muted-foreground">最も疎な領域</p></CardContent></Card>
                </div>
              )}

              {nodes.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>ナレッジグラフ</CardTitle></CardHeader>
                  <CardContent>
                    <svg viewBox="0 0 600 400" className="w-full h-80 bg-muted/30 rounded-lg">
                      {edges.map((e: any, i: number) => {
                        const src = nodes.findIndex((n: any) => n.id === e.source);
                        const tgt = nodes.findIndex((n: any) => n.id === e.target);
                        if (src < 0 || tgt < 0) return null;
                        const x1 = 60 + (src % 8) * 70;
                        const y1 = 50 + Math.floor(src / 8) * 80;
                        const x2 = 60 + (tgt % 8) * 70;
                        const y2 = 50 + Math.floor(tgt / 8) * 80;
                        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="hsl(var(--muted-foreground))" strokeWidth={Math.max(1, (e.strength || 1) / 3)} opacity={0.3} />;
                      })}
                      {nodes.map((n: any, i: number) => {
                        const x = 60 + (i % 8) * 70;
                        const y = 50 + Math.floor(i / 8) * 80;
                        return (
                          <g key={n.id}>
                            <circle cx={x} cy={y} r={10 + (n.weight || 1) * 2} fill={NODE_COLORS[n.type] || "#666"} opacity={0.8} />
                            <text x={x} y={y + 22} textAnchor="middle" fontSize={9} fill="currentColor">{n.label?.substring(0, 8)}</text>
                          </g>
                        );
                      })}
                    </svg>
                    <div className="flex gap-3 mt-2 flex-wrap">
                      {Object.entries(NODE_COLORS).map(([type, color]) => (
                        <div key={type} className="flex items-center gap-1 text-xs"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />{type}</div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="gaps">
            <div className="space-y-3">
              {(gaps.data ?? []).map((g: any, i: number) => (
                <Card key={i}>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="h-4 w-4 text-yellow-500" />
                      <Badge variant={(SEVERITY_COLORS[g.severity] || "secondary") as any}>{g.severity?.toUpperCase()}</Badge>
                      <span className="font-medium text-sm">{g.area}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{g.recommendation}</p>
                  </CardContent>
                </Card>
              ))}
              {!gaps.data?.length && <p className="text-muted-foreground">知識の穴が検出されていません。まずグラフを構築してください。</p>}
            </div>
          </TabsContent>

          <TabsContent value="compare">
            <Card>
              <CardHeader><CardTitle>友達との知識グラフ比較</CardTitle><CardDescription>共通の専門領域と独自領域を発見</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Select onValueChange={(v) => setFriendId(Number(v))}>
                    <SelectTrigger className="w-60"><SelectValue placeholder="友達を選択" /></SelectTrigger>
                    <SelectContent>
                      {(friends.data ?? []).filter((f: any) => f.status === "accepted").map((f: any) => (
                        <SelectItem key={f.friendId} value={String(f.friendId)}>{f.friendName || `友達 #${f.friendId}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={handleCompare} disabled={compareMutation.isPending || !friendId}>
                    {compareMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <GitCompareArrows className="h-4 w-4 mr-1" />}
                    比較
                  </Button>
                </div>
                {compareMutation.data && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <Card><CardContent className="pt-4"><p className="text-2xl font-bold">{compareMutation.data.myNodeCount}</p><p className="text-xs text-muted-foreground">自分のノード</p></CardContent></Card>
                      <Card className="border-primary"><CardContent className="pt-4"><p className="text-2xl font-bold text-primary">{compareMutation.data.overlapRate}%</p><p className="text-xs text-muted-foreground">重なり率</p></CardContent></Card>
                      <Card><CardContent className="pt-4"><p className="text-2xl font-bold">{compareMutation.data.friendNodeCount}</p><p className="text-xs text-muted-foreground">友達のノード</p></CardContent></Card>
                    </div>
                    <div className="grid md:grid-cols-3 gap-3">
                      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">共通領域 ({compareMutation.data.common?.length})</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-1">{(compareMutation.data.common ?? []).map((c: string, i: number) => <Badge key={i} variant="default" className="text-xs">{c}</Badge>)}</div></CardContent></Card>
                      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">自分のみ ({compareMutation.data.myOnly?.length})</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-1">{(compareMutation.data.myOnly ?? []).slice(0, 10).map((c: string, i: number) => <Badge key={i} variant="outline" className="text-xs">{c}</Badge>)}</div></CardContent></Card>
                      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">友達のみ ({compareMutation.data.friendOnly?.length})</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-1">{(compareMutation.data.friendOnly ?? []).slice(0, 10).map((c: string, i: number) => <Badge key={i} variant="secondary" className="text-xs">{c}</Badge>)}</div></CardContent></Card>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
