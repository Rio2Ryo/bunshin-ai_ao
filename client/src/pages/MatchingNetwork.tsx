import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Network, Users, GitBranch, Lightbulb, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";

export default function MatchingNetwork() {
  usePageMeta({ title: "マッチングネットワーク", description: "友達+マッチング関係をネットワークグラフで可視化", path: "/network" });

  const { data: networkData, refetch } = trpc.matching.getNetworkGraph.useQuery();
  const generateMut = trpc.matching.generateNetworkGraph.useMutation({
    onSuccess: () => { refetch(); toast.success("ネットワークグラフを生成しました"); },
    onError: (e) => toast.error(e.message),
  });

  const graph = networkData?.graphData;
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const communities = networkData?.communities ?? [];
  const bridgeUsers = networkData?.bridgeUsers ?? [];
  const suggestions = networkData?.suggestions ?? [];
  const stats = graph?.stats;

  // SVG layout
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);

  const nodePositions = useMemo(() => {
    if (!nodes.length) return new Map();
    const positions = new Map<number, { x: number; y: number }>();
    const centerX = 400, centerY = 300;
    const selfNode = nodes.find((n: any) => n.type === "self");
    if (selfNode) positions.set(selfNode.id, { x: centerX, y: centerY });
    const others = nodes.filter((n: any) => n.type !== "self");
    others.forEach((n: any, i: number) => {
      const angle = (2 * Math.PI * i) / others.length;
      const radius = 180 + Math.random() * 40;
      positions.set(n.id, { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) });
    });
    return positions;
  }, [nodes]);

  const communityColors = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899"];

  const getNodeCommunity = (nodeId: number) => {
    const idx = communities.findIndex((c: any) => c.members?.includes(nodeId));
    return idx >= 0 ? idx : -1;
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Network className="h-6 w-6" /> マッチングネットワーク</h1>
            <p className="text-muted-foreground text-sm mt-1">友達+マッチング関係をネットワークグラフで可視化</p>
          </div>
          <Button onClick={() => generateMut.mutate()} disabled={generateMut.isPending}>
            {generateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            {networkData ? "更新" : "生成"}
          </Button>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-primary">{stats.totalNodes}</div><div className="text-xs text-muted-foreground">ノード数</div></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-primary">{stats.totalEdges}</div><div className="text-xs text-muted-foreground">エッジ数</div></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-primary">{stats.communityCount}</div><div className="text-xs text-muted-foreground">コミュニティ</div></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-primary">{stats.bridgeCount}</div><div className="text-xs text-muted-foreground">ブリッジユーザー</div></CardContent></Card>
          </div>
        )}

        {nodes.length > 0 ? (
          <Card>
            <CardHeader><CardTitle className="text-base">ネットワークグラフ</CardTitle></CardHeader>
            <CardContent>
              <svg viewBox="0 0 800 600" className="w-full h-auto border rounded-lg bg-background" style={{ minHeight: 400 }}>
                {/* Edges */}
                {edges.map((e: any, i: number) => {
                  const from = nodePositions.get(e.source);
                  const to = nodePositions.get(e.target);
                  if (!from || !to) return null;
                  const isMatching = e.type === "matching";
                  const opacity = hoveredNode != null ? (e.source === hoveredNode || e.target === hoveredNode ? 0.8 : 0.1) : 0.4;
                  return (
                    <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                      stroke={isMatching ? "#6366f1" : "#94a3b8"} strokeWidth={isMatching ? Math.max(1, (e.weight || 50) / 30) : 1}
                      strokeDasharray={isMatching ? undefined : "4 4"} opacity={opacity} />
                  );
                })}
                {/* Nodes */}
                {nodes.map((n: any) => {
                  const pos = nodePositions.get(n.id);
                  if (!pos) return null;
                  const isSelf = n.type === "self";
                  const communityIdx = getNodeCommunity(n.id);
                  const color = isSelf ? "#6366f1" : communityIdx >= 0 ? communityColors[communityIdx % communityColors.length] : "#94a3b8";
                  const isBridge = bridgeUsers.some((b: any) => b.id === n.id);
                  const radius = isSelf ? 20 : isBridge ? 16 : 12;
                  const isHovered = hoveredNode === n.id;
                  return (
                    <g key={n.id} onMouseEnter={() => setHoveredNode(n.id)} onMouseLeave={() => setHoveredNode(null)} style={{ cursor: "pointer" }}>
                      <circle cx={pos.x} cy={pos.y} r={radius + (isHovered ? 4 : 0)} fill={color} opacity={hoveredNode != null && !isHovered ? 0.3 : 0.9}
                        stroke={isBridge ? "#f59e0b" : "transparent"} strokeWidth={isBridge ? 3 : 0} />
                      <text x={pos.x} y={pos.y + radius + 14} textAnchor="middle" fontSize={isSelf ? 12 : 10} fill="currentColor" opacity={hoveredNode != null && !isHovered ? 0.3 : 1}>
                        {n.name?.slice(0, 6)}
                      </text>
                      {isHovered && (
                        <text x={pos.x} y={pos.y - radius - 8} textAnchor="middle" fontSize={11} fill="currentColor" fontWeight="bold">
                          {n.name} ({n.matchCount ?? 0}回)
                        </text>
                      )}
                    </g>
                  );
                })}
                {/* Legend */}
                <g transform="translate(10, 560)">
                  <line x1={0} y1={5} x2={20} y2={5} stroke="#6366f1" strokeWidth={2} />
                  <text x={25} y={9} fontSize={10} fill="currentColor">マッチング</text>
                  <line x1={100} y1={5} x2={120} y2={5} stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 4" />
                  <text x={125} y={9} fontSize={10} fill="currentColor">友達関係</text>
                  <circle cx={210} cy={5} r={5} fill="#f59e0b" />
                  <text x={220} y={9} fontSize={10} fill="currentColor">ブリッジ</text>
                </g>
              </svg>
            </CardContent>
          </Card>
        ) : !networkData ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">「生成」ボタンでネットワークグラフを作成しましょう</CardContent></Card>
        ) : null}

        <div className="grid md:grid-cols-2 gap-4">
          {communities.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><GitBranch className="h-4 w-4" /> コミュニティ</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {communities.map((c: any, i: number) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: communityColors[i % communityColors.length] }} />
                    <span className="text-sm font-medium">{c.label}</span>
                    <Badge variant="outline">{c.size}人</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {bridgeUsers.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> ブリッジユーザー</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {bridgeUsers.map((b: any, i: number) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-sm">{b.name}</span>
                    <Badge>{b.communitiesCount}コミュニティ</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {suggestions.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Lightbulb className="h-4 w-4 text-yellow-500" /> ネットワーク拡大提案</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2">{suggestions.map((s: string, i: number) => <li key={i} className="text-sm flex items-start gap-2"><span className="text-primary mt-0.5">•</span>{s}</li>)}</ul>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
