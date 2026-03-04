import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Network, RefreshCw, Loader2, Search, Zap, Circle, X, ArrowRight, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  skill: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300", border: "border-blue-300 dark:border-blue-700" },
  experience: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-300", border: "border-green-300 dark:border-green-700" },
  knowledge: { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-300", border: "border-purple-300 dark:border-purple-700" },
  interest: { bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-300", border: "border-amber-300 dark:border-amber-700" },
  project: { bg: "bg-rose-100 dark:bg-rose-900/30", text: "text-rose-700 dark:text-rose-300", border: "border-rose-300 dark:border-rose-700" },
  default: { bg: "bg-gray-100 dark:bg-gray-900/30", text: "text-gray-700 dark:text-gray-300", border: "border-gray-300 dark:border-gray-700" },
};

function getCategoryStyle(category: string) {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.default;
}

const CLUSTER_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

interface GraphNode {
  id: string;
  label: string;
  category: string;
  size: number;
  cluster?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
  strength: number;
}

interface GraphCluster {
  id: number;
  label: string;
  nodeIds: string[];
}

export default function KnowledgeGraph() {
  usePageMeta({ title: "ナレッジグラフ", description: "ツインのナレッジベースの関連性を可視化", path: "/knowledge-graph" });

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch existing graph
  const { data: graphData, isLoading: graphLoading, refetch: refetchGraph } = trpc.myTwin.getKnowledgeGraph.useQuery();

  // Generate graph mutation
  const generateMut = trpc.myTwin.generateKnowledgeGraph.useMutation({
    onSuccess: () => {
      toast.success("ナレッジグラフを生成しました");
      refetchGraph();
    },
    onError: (err: any) => {
      toast.error(err.message || "グラフの生成に失敗しました");
    },
  });

  // Fetch related knowledge for selected node
  const { data: relatedData, isLoading: relatedLoading } = trpc.myTwin.getRelatedKnowledge.useQuery(
    { entryId: selectedNodeId! },
    { enabled: !!selectedNodeId }
  );

  const graph = graphData as { nodes: GraphNode[]; edges: GraphEdge[]; clusters: GraphCluster[] } | undefined;
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const clusters = graph?.clusters ?? [];
  const related = (relatedData as any[]) ?? [];

  // Filter nodes by search
  const filteredNodes = searchQuery
    ? nodes.filter((n) => n.label.toLowerCase().includes(searchQuery.toLowerCase()) || n.category.toLowerCase().includes(searchQuery.toLowerCase()))
    : nodes;

  // Get edges involving filtered nodes
  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter((e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target));

  // Cluster grouping
  const clusterMap = new Map<number, GraphCluster>();
  clusters.forEach((c) => clusterMap.set(c.id, c));

  const handleGenerate = () => {
    generateMut.mutate({});
  };

  // Calculate simple circular layout positions for SVG visualization
  const nodePositions = useCallback(() => {
    const positions = new Map<string, { x: number; y: number }>();
    const count = filteredNodes.length;
    if (count === 0) return positions;

    // Group by cluster for better visual grouping
    const clusterGroups = new Map<number, GraphNode[]>();
    filteredNodes.forEach((n) => {
      const cid = n.cluster ?? -1;
      if (!clusterGroups.has(cid)) clusterGroups.set(cid, []);
      clusterGroups.get(cid)!.push(n);
    });

    const centerX = 300;
    const centerY = 250;
    const clusterKeys = Array.from(clusterGroups.keys());
    const clusterCount = clusterKeys.length;

    clusterKeys.forEach((cid, ci) => {
      const groupNodes = clusterGroups.get(cid)!;
      const clusterAngle = (2 * Math.PI * ci) / Math.max(clusterCount, 1);
      const clusterRadius = clusterCount > 1 ? 120 : 0;
      const cx = centerX + Math.cos(clusterAngle) * clusterRadius;
      const cy = centerY + Math.sin(clusterAngle) * clusterRadius;

      groupNodes.forEach((node, ni) => {
        const nodeAngle = (2 * Math.PI * ni) / Math.max(groupNodes.length, 1);
        const nodeRadius = Math.min(30 + groupNodes.length * 12, 90);
        positions.set(node.id, {
          x: cx + Math.cos(nodeAngle) * nodeRadius,
          y: cy + Math.sin(nodeAngle) * nodeRadius,
        });
      });
    });

    return positions;
  }, [filteredNodes]);

  const positions = nodePositions();

  return (
    <DashboardLayout>
      <main id="main-content" className="flex-1 overflow-auto">
        <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <Network className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">ナレッジグラフ</h1>
                <p className="text-sm text-muted-foreground">ツインのナレッジベースの関連性を可視化</p>
              </div>
            </div>
            <Button onClick={handleGenerate} disabled={generateMut.isPending}>
              {generateMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              グラフを生成
            </Button>
          </div>

          {/* Search */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="ノードを検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {graphLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : nodes.length === 0 ? (
            <Card>
              <CardContent className="py-16">
                <div className="text-center space-y-3">
                  <Network className="h-12 w-12 text-muted-foreground/40 mx-auto" />
                  <p className="text-muted-foreground">ナレッジグラフがまだありません</p>
                  <p className="text-sm text-muted-foreground">「グラフを生成」ボタンでナレッジベースから関連性を抽出します</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Main graph area */}
              <div className="lg:col-span-2 space-y-4">
                {/* SVG Graph Visualization */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">グラフビュー</CardTitle>
                    <CardDescription>ノードをクリックして関連ナレッジを表示</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-auto rounded-lg border bg-muted/20">
                      <svg viewBox="0 0 600 500" className="w-full h-auto min-h-[400px]">
                        {/* Edges */}
                        {filteredEdges.map((edge, i) => {
                          const sourcePos = positions.get(edge.source);
                          const targetPos = positions.get(edge.target);
                          if (!sourcePos || !targetPos) return null;
                          return (
                            <line
                              key={`edge-${i}`}
                              x1={sourcePos.x}
                              y1={sourcePos.y}
                              x2={targetPos.x}
                              y2={targetPos.y}
                              stroke="currentColor"
                              strokeWidth={Math.max(1, edge.strength * 3)}
                              opacity={Math.max(0.15, edge.strength * 0.6)}
                              className="text-muted-foreground"
                            />
                          );
                        })}

                        {/* Nodes */}
                        {filteredNodes.map((node) => {
                          const pos = positions.get(node.id);
                          if (!pos) return null;
                          const isSelected = selectedNodeId === node.id;
                          const radius = Math.max(12, Math.min(node.size * 4, 28));
                          const clusterColor = node.cluster != null
                            ? CLUSTER_COLORS[node.cluster % CLUSTER_COLORS.length]
                            : "#6b7280";

                          return (
                            <g
                              key={node.id}
                              onClick={() => setSelectedNodeId(isSelected ? null : node.id)}
                              className="cursor-pointer"
                            >
                              <circle
                                cx={pos.x}
                                cy={pos.y}
                                r={radius}
                                fill={clusterColor}
                                fillOpacity={isSelected ? 0.9 : 0.6}
                                stroke={isSelected ? "#fff" : clusterColor}
                                strokeWidth={isSelected ? 3 : 1}
                              />
                              <text
                                x={pos.x}
                                y={pos.y + radius + 14}
                                textAnchor="middle"
                                className="fill-foreground"
                                fontSize="10"
                                fontWeight={isSelected ? "bold" : "normal"}
                              >
                                {node.label.length > 10 ? node.label.slice(0, 10) + "..." : node.label}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  </CardContent>
                </Card>

                {/* Node list */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">ノード一覧</CardTitle>
                    <CardDescription>{filteredNodes.length}件のナレッジエントリ</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {filteredNodes.map((node) => {
                        const style = getCategoryStyle(node.category);
                        const isSelected = selectedNodeId === node.id;
                        return (
                          <button
                            key={node.id}
                            onClick={() => setSelectedNodeId(isSelected ? null : node.id)}
                            className={`p-3 rounded-lg border text-left transition-all hover:shadow-sm ${
                              isSelected
                                ? "ring-2 ring-primary border-primary bg-primary/5"
                                : "hover:bg-accent/50"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <Circle
                                className={`h-3 w-3 shrink-0 ${style.text}`}
                                fill="currentColor"
                              />
                              <span className="text-sm font-medium truncate">{node.label}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1.5">
                              <Badge variant="outline" className={`text-[10px] ${style.text}`}>
                                {node.category}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground">
                                サイズ: {node.size}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {filteredNodes.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        {searchQuery ? "検索結果がありません" : "ノードがありません"}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Edge list */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">関連性一覧</CardTitle>
                    <CardDescription>{filteredEdges.length}件の接続</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-[300px] overflow-auto">
                      {filteredEdges.map((edge, i) => {
                        const sourceNode = nodes.find((n) => n.id === edge.source);
                        const targetNode = nodes.find((n) => n.id === edge.target);
                        return (
                          <div key={i} className="flex items-center gap-2 text-sm p-2 rounded-md hover:bg-accent/50">
                            <span className="font-medium truncate max-w-[120px]">
                              {sourceNode?.label ?? edge.source}
                            </span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="font-medium truncate max-w-[120px]">
                              {targetNode?.label ?? edge.target}
                            </span>
                            <span className="text-muted-foreground text-xs ml-auto shrink-0">
                              {edge.relationship}
                            </span>
                            <div className="w-16 h-1.5 bg-muted rounded-full shrink-0">
                              <div
                                className="h-full bg-primary rounded-full"
                                style={{ width: `${Math.min(edge.strength * 100, 100)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                      {filteredEdges.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          関連性データがありません
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Side panel: clusters + related knowledge */}
              <div className="space-y-4">
                {/* Clusters */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Zap className="h-4 w-4 text-amber-500" />
                      クラスター
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {clusters.length > 0 ? (
                      <div className="space-y-3">
                        {clusters.map((cluster) => (
                          <div key={cluster.id} className="p-3 rounded-lg border">
                            <div className="flex items-center gap-2 mb-1.5">
                              <div
                                className="h-3 w-3 rounded-full"
                                style={{ backgroundColor: CLUSTER_COLORS[cluster.id % CLUSTER_COLORS.length] }}
                              />
                              <span className="text-sm font-medium">{cluster.label}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {cluster.nodeIds.length}件のノード
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-2">
                        クラスターデータなし
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Related knowledge (when node selected) */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">関連ナレッジ</CardTitle>
                      {selectedNodeId && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => setSelectedNodeId(null)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    <CardDescription>
                      {selectedNodeId
                        ? `「${nodes.find((n) => n.id === selectedNodeId)?.label ?? ""}」の関連エントリ`
                        : "ノードを選択すると表示されます"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!selectedNodeId ? (
                      <div className="text-center py-6">
                        <Search className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                          ノードをクリックしてください
                        </p>
                      </div>
                    ) : relatedLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : related.length > 0 ? (
                      <div className="space-y-3">
                        {related.map((entry: any, i: number) => (
                          <div key={i} className="p-3 rounded-lg border hover:bg-accent/50 transition-colors">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium">{entry.title}</span>
                              {entry.relationship && (
                                <Badge variant="outline" className="text-[10px]">
                                  {entry.relationship}
                                </Badge>
                              )}
                            </div>
                            {entry.strength != null && (
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className="text-[10px] text-muted-foreground">関連度</span>
                                <div className="flex-1 h-1.5 bg-muted rounded-full">
                                  <div
                                    className="h-full bg-primary rounded-full transition-all"
                                    style={{ width: `${Math.min(entry.strength * 100, 100)}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-muted-foreground">
                                  {Math.round((entry.strength ?? 0) * 100)}%
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        関連エントリが見つかりません
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      </main>
    </DashboardLayout>
  );
}
