import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Lightbulb, Star, BarChart3, Rocket, TrendingUp, ArrowRight, Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useLocation } from "wouter";

const CATEGORY_COLORS: Record<string, string> = {
  "業界トレンド": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "スキル活用": "bg-green-500/20 text-green-400 border-green-500/30",
  "弱点克服": "bg-red-500/20 text-red-400 border-red-500/30",
  "新規開拓": "bg-purple-500/20 text-purple-400 border-purple-500/30",
  "深掘り": "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

function DifficultyStars({ level }: { level: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i <= level ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground/30"}`}
        />
      ))}
    </div>
  );
}

export default function ThemeRecommender() {
  usePageMeta({ title: "テーマ推薦", description: "AIによるマッチングテーマの提案と分析", path: "/theme-recommender" });

  const [, navigate] = useLocation();
  const [selectedFriendId, setSelectedFriendId] = useState<string>("");

  const { data: friends } = trpc.friends.list.useQuery();
  const friendsList = (friends as any[]) || [];

  const friendIdNum = selectedFriendId && selectedFriendId !== "none" ? Number(selectedFriendId) : undefined;

  const { data: recommendationsRaw } = trpc.matching.getThemeRecommendations.useQuery(
    { friendId: friendIdNum }
  );
  const recData = recommendationsRaw as any;
  const recommendations = recData?.recommendations || [];

  const { data: rankingsRaw } = trpc.matching.getThemeRankings.useQuery();
  const rankings = (rankingsRaw as any[]) || [];

  const recommendMut = trpc.matching.recommendThemes.useMutation({
    onSuccess: () => toast.success("テーマを提案しました"),
    onError: (err: any) => toast.error(err.message || "テーマ提案に失敗しました"),
  });

  const startMut = trpc.matching.startFromRecommendation.useMutation({
    onSuccess: (data: any) => {
      toast.success("マッチングを開始しました");
      if (data?.sessionId) navigate(`/matching/${data.sessionId}`);
    },
    onError: (err: any) => toast.error(err.message || "開始に失敗しました"),
  });

  const handleRecommend = () => {
    recommendMut.mutate({ friendId: friendIdNum });
  };

  const handleStart = (theme: any) => {
    if (!friendIdNum) {
      toast.error("テーマ開始には友達を選択してください");
      return;
    }
    startMut.mutate({ theme: theme.name || theme.theme || "テーマ", friendId: friendIdNum });
  };

  const rankingChartData = rankings
    .sort((a: any, b: any) => (b.avgScore ?? 0) - (a.avgScore ?? 0))
    .slice(0, 10)
    .map((r: any) => ({
      theme: (r.theme as string)?.length > 10 ? (r.theme as string).slice(0, 10) + "…" : r.theme,
      avgScore: Math.round(r.avgScore ?? 0),
    }));

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Lightbulb className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">テーマ推薦</h1>
            <p className="text-sm text-muted-foreground">AIがあなたに最適なマッチングテーマを提案します</p>
          </div>
        </div>

        <Tabs defaultValue="recommend" className="space-y-4">
          <TabsList>
            <TabsTrigger value="recommend">
              <Lightbulb className="h-4 w-4 mr-1.5" />テーマ提案
            </TabsTrigger>
            <TabsTrigger value="ranking">
              <BarChart3 className="h-4 w-4 mr-1.5" />テーマ別ランキング
            </TabsTrigger>
            <TabsTrigger value="history">
              <TrendingUp className="h-4 w-4 mr-1.5" />履歴
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: テーマ提案 */}
          <TabsContent value="recommend" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Rocket className="h-5 w-5" />
                  テーマを生成
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <Select value={selectedFriendId} onValueChange={setSelectedFriendId}>
                    <SelectTrigger className="w-full sm:w-64">
                      <SelectValue placeholder="友達を選択（任意）" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">指定なし</SelectItem>
                      {friendsList.map((f: any) => (
                        <SelectItem key={f.friendId ?? f.id} value={String(f.friendId ?? f.id)}>
                          {f.friendName ?? f.displayName ?? `Friend #${f.friendId ?? f.id}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={handleRecommend} disabled={recommendMut.isPending}>
                    {recommendMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Lightbulb className="h-4 w-4 mr-1.5" />}
                    テーマを提案してもらう
                  </Button>
                </div>
              </CardContent>
            </Card>

            {recommendMut.data && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {((recommendMut.data as any)?.themes || []).map((theme: any, idx: number) => (
                  <Card key={idx} className="hover:border-primary/50 transition-colors">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base leading-tight">{theme.name}</CardTitle>
                        <div className="flex gap-1.5 flex-shrink-0">
                          {theme.novelty && (
                            <Badge variant="outline" className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
                              新規
                            </Badge>
                          )}
                          {theme.category && (
                            <Badge variant="outline" className={`text-xs ${CATEGORY_COLORS[theme.category] || "bg-muted"}`}>
                              {theme.category}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">予想スコア</span>
                          <span className="font-medium">{theme.expectedScore ?? 0}点</span>
                        </div>
                        <Progress value={theme.expectedScore ?? 0} className="h-2" />
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">難易度</span>
                        <DifficultyStars level={theme.difficulty ?? 3} />
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">{theme.reason}</p>
                      <Button
                        className="w-full"
                        size="sm"
                        onClick={() => handleStart(theme)}
                        disabled={startMut.isPending}
                      >
                        このテーマで開始
                        <ArrowRight className="h-4 w-4 ml-1.5" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {!recommendMut.data && !recommendMut.isPending && (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Lightbulb className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <p className="text-muted-foreground">「テーマを提案してもらう」ボタンでAIがテーマを生成します</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Tab 2: テーマ別ランキング */}
          <TabsContent value="ranking" className="space-y-4">
            {rankingChartData.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    テーマ別平均スコア
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={rankingChartData} layout="vertical" margin={{ left: 20, right: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                        <XAxis type="number" domain={[0, 100]} />
                        <YAxis type="category" dataKey="theme" width={100} tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Bar dataKey="avgScore" fill="#6366f1" radius={[0, 4, 4, 0]} name="平均スコア" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <BarChart3 className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <p className="text-muted-foreground">ランキングデータがまだありません</p>
                </CardContent>
              </Card>
            )}

            {rankings.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">テーマ別詳細</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>テーマ</TableHead>
                        <TableHead className="text-center">セッション数</TableHead>
                        <TableHead className="text-center">平均スコア</TableHead>
                        <TableHead className="text-center">最高スコア</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rankings.map((r: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{r.theme}</TableCell>
                          <TableCell className="text-center">{r.sessionCount ?? 0}</TableCell>
                          <TableCell className="text-center">{Math.round(r.avgScore ?? 0)}</TableCell>
                          <TableCell className="text-center">{r.maxScore ?? 0}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Tab 3: 履歴 */}
          <TabsContent value="history" className="space-y-4">
            {recommendations.length > 0 ? (
              <div className="space-y-3">
                {recommendations.map((rec: any, idx: number) => (
                  <Card key={idx}>
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground">
                            {recData?.createdAt ? new Date(recData.createdAt).toLocaleDateString("ja-JP") : "日付不明"}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="secondary">{typeof rec === "string" ? rec : rec.name || rec.theme}</Badge>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <TrendingUp className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <p className="text-muted-foreground">テーマ提案の履歴がまだありません</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
