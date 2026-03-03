import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Grid3x3, Loader2, RefreshCw, AlertTriangle, Lightbulb, Layers } from "lucide-react";

const dimensions = ["スキル", "価値観", "コミュニケーション", "革新性", "信頼", "人格互換"];

function heatmapColor(score: number): string {
  if (score <= 5) {
    const r = 239;
    const g = Math.round(68 + (score / 5) * (163 - 68));
    const b = 68;
    return `rgb(${r}, ${g}, ${b})`;
  } else if (score <= 10) {
    const t = (score - 5) / 5;
    const r = Math.round(239 - t * (239 - 234));
    const g = Math.round(163 + t * (179 - 163));
    const b = Math.round(8 + t * (68 - 8));
    return `rgb(${r}, ${g}, ${b})`;
  } else if (score <= 15) {
    const t = (score - 10) / 5;
    const r = Math.round(234 - t * (234 - 34));
    const g = Math.round(179 + t * (197 - 179));
    const b = Math.round(8 + t * (94 - 8));
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const t = (score - 15) / 5;
    const r = Math.round(34 - t * (34 - 22));
    const g = Math.round(197 - t * (197 - 163));
    const b = Math.round(94 - t * (94 - 74));
    return `rgb(${r}, ${g}, ${b})`;
  }
}

function textColorForBg(score: number): string {
  return score >= 12 ? "#fff" : "#000";
}

const priorityColors: Record<string, string> = {
  high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

export default function MatchingHeatmap() {
  usePageMeta({ title: "ヒートマップ分析", description: "マッチングデータの多次元分析", path: "/heatmap" });

  const { data: heatmapRaw, isLoading, refetch } = trpc.matching.getHeatmap.useQuery();
  const heatmap = heatmapRaw as any;

  const generateMut = trpc.matching.generateHeatmap.useMutation({
    onSuccess: () => {
      toast.success("ヒートマップを生成しました");
      refetch();
    },
    onError: (err: any) => toast.error(err.message || "生成に失敗しました"),
  });

  const rows = heatmap?.heatmapData || heatmap?.rows || heatmap?.friends || [];
  const clusters = heatmap?.clusters || [];
  const weaknesses = heatmap?.weaknesses || [];
  const suggestions = heatmap?.suggestions || [];
  const summary = heatmap?.summary || "";
  const hasData = rows.length > 0;

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <Grid3x3 className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold">ヒートマップ分析</h1>
        </div>

        <Tabs defaultValue="heatmap">
          <TabsList>
            <TabsTrigger value="heatmap">ヒートマップ</TabsTrigger>
            <TabsTrigger value="analysis">分析結果</TabsTrigger>
          </TabsList>

          {/* ヒートマップタブ */}
          <TabsContent value="heatmap" className="space-y-4 mt-4">
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            )}

            {!isLoading && !hasData && (
              <Card>
                <CardContent className="py-8 text-center space-y-4">
                  <Grid3x3 className="h-12 w-12 mx-auto opacity-40" />
                  <p className="text-muted-foreground">ヒートマップデータがありません。</p>
                  <Button
                    onClick={() => generateMut.mutate()}
                    disabled={generateMut.isPending}
                  >
                    {generateMut.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        生成中...
                      </>
                    ) : (
                      "ヒートマップを生成"
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}

            {!isLoading && hasData && (
              <>
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => generateMut.mutate()}
                    disabled={generateMut.isPending}
                  >
                    {generateMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-1" />
                    )}
                    再分析
                  </Button>
                </div>

                {/* Heatmap grid */}
                <Card>
                  <CardContent className="py-4 overflow-x-auto">
                    <TooltipProvider>
                      <div className="inline-grid" style={{ gridTemplateColumns: `150px repeat(${dimensions.length}, 80px)` }}>
                        {/* Header row */}
                        <div className="font-medium text-sm p-2 border-b" />
                        {dimensions.map((dim) => (
                          <div key={dim} className="font-medium text-xs text-center p-2 border-b">
                            {dim}
                          </div>
                        ))}

                        {/* Data rows */}
                        {rows.map((row: any, rIdx: number) => {
                          const scores = row.scores || row.dimensions || [];
                          return (
                            <div key={rIdx} className="contents">
                              <div className="text-sm font-medium p-2 border-b flex items-center truncate">
                                {row.name || row.friendName || `Friend ${rIdx + 1}`}
                              </div>
                              {dimensions.map((dim, dIdx) => {
                                const score = typeof scores[dIdx] === "number" ? scores[dIdx] : (scores[dIdx]?.score ?? 0);
                                return (
                                  <Tooltip key={dIdx}>
                                    <TooltipTrigger asChild>
                                      <div
                                        className="text-center text-sm font-bold p-2 border-b cursor-default transition-transform hover:scale-110"
                                        style={{
                                          backgroundColor: heatmapColor(score),
                                          color: textColorForBg(score),
                                        }}
                                      >
                                        {score}
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>{row.name || row.friendName} - {dim}: {score}/20</p>
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </TooltipProvider>
                  </CardContent>
                </Card>

                {/* Color legend */}
                <Card>
                  <CardContent className="py-3">
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground">スコア凡例:</span>
                      <div className="flex items-center gap-1">
                        <div className="w-5 h-5 rounded" style={{ backgroundColor: heatmapColor(0) }} />
                        <span>0</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-5 h-5 rounded" style={{ backgroundColor: heatmapColor(5) }} />
                        <span>5</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-5 h-5 rounded" style={{ backgroundColor: heatmapColor(10) }} />
                        <span>10</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-5 h-5 rounded" style={{ backgroundColor: heatmapColor(15) }} />
                        <span>15</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-5 h-5 rounded" style={{ backgroundColor: heatmapColor(20) }} />
                        <span>20</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* 分析結果タブ */}
          <TabsContent value="analysis" className="space-y-6 mt-4">
            {!hasData && (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <p>まだヒートマップデータがありません。先にヒートマップを生成してください。</p>
                </CardContent>
              </Card>
            )}

            {/* Clusters */}
            {clusters.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Layers className="h-5 w-5" />
                  クラスター
                </h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {clusters.map((cluster: any, idx: number) => (
                    <Card key={idx}>
                      <CardContent className="py-4">
                        <h3 className="font-semibold">{cluster.name || `クラスター ${idx + 1}`}</h3>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {(cluster.members || []).map((m: string, mIdx: number) => (
                            <Badge key={mIdx} variant="secondary">{m}</Badge>
                          ))}
                        </div>
                        {cluster.characteristic && (
                          <p className="text-sm text-muted-foreground mt-2">{cluster.characteristic}</p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Weaknesses */}
            {weaknesses.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                  弱点分析
                </h2>
                <div className="space-y-3">
                  {weaknesses.map((w: any, idx: number) => (
                    <Card key={idx} className="border-red-200 dark:border-red-800">
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-red-600 dark:text-red-400">{w.dimension || w.name}</h3>
                          <Badge variant="destructive">平均: {w.avgScore ?? w.score}</Badge>
                        </div>
                        {w.affectedFriends && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {(Array.isArray(w.affectedFriends) ? w.affectedFriends : []).map((f: string, fIdx: number) => (
                              <Badge key={fIdx} variant="outline">{f}</Badge>
                            ))}
                          </div>
                        )}
                        {w.reason && (
                          <p className="text-sm text-muted-foreground mt-2">{w.reason}</p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Suggestions */}
            {suggestions.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-yellow-500" />
                  改善提案
                </h2>
                <div className="space-y-3">
                  {suggestions.map((s: any, idx: number) => (
                    <Card key={idx}>
                      <CardContent className="py-4">
                        <div className="flex items-start justify-between">
                          <h3 className="font-semibold">{s.title}</h3>
                          <div className="flex gap-2">
                            {s.targetDimension && (
                              <Badge variant="outline">{s.targetDimension}</Badge>
                            )}
                            {s.priority && (
                              <Badge className={priorityColors[s.priority] || priorityColors.medium}>
                                {s.priority === "high" ? "高" : s.priority === "medium" ? "中" : "低"}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {s.description && (
                          <p className="text-sm text-muted-foreground mt-2">{s.description}</p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Summary */}
            {summary && (
              <Card className="bg-muted/50">
                <CardHeader>
                  <CardTitle className="text-base">サマリー</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{summary}</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
