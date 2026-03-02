import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc, API_BASE } from "@/lib/trpc";
import { Link } from "wouter";
import { ArrowLeft, BarChart3, Loader2, TrendingUp, Users, Flame, Star } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

// Heatmap color helper: 0 = red, 20 = green
function heatColor(score: number): string {
  const clamped = Math.max(0, Math.min(20, score));
  const ratio = clamped / 20;
  // red → yellow → green
  const r = Math.round(255 * (1 - ratio));
  const g = Math.round(200 * ratio);
  return `rgb(${r},${g},80)`;
}

const DIMENSION_LABELS: Record<string, string> = {
  skillMatch: "スキル",
  valueAlignment: "価値観",
  communicationStyle: "コミュ力",
  businessGoalFit: "目標適合",
  complementaryStrengths: "補完性",
  personalityCompatibility: "人格互換",
};

export default function MatchingAnalytics() {
  usePageMeta({
    title: "マッチング分析",
    description: "マッチングスコアの推移、互換性ヒートマップ、友達別相性サマリー",
    path: "/matching/analytics",
  });

  const { data: scoreHistory, isLoading: loadingHistory } = trpc.matching.getScoreHistory.useQuery();
  const { data: heatmapData, isLoading: loadingHeatmap } = trpc.matching.getPersonalityHeatmap.useQuery();
  const { data: friendSummary, isLoading: loadingSummary } = trpc.matching.getFriendCompatibilitySummary.useQuery();

  const isLoading = loadingHistory || loadingHeatmap || loadingSummary;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/matching">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-primary" />
              マッチング分析ダッシュボード
            </h1>
            <p className="text-muted-foreground">スコア推移・互換性ヒートマップ・友達別相性</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Section 1: Score History Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  スコア推移グラフ
                </CardTitle>
                <CardDescription>マッチングスコアの時系列変化</CardDescription>
              </CardHeader>
              <CardContent>
                {scoreHistory && scoreHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={scoreHistory}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="bg-popover border rounded-lg shadow-lg p-3 text-sm">
                              <p className="font-medium">{d.theme}</p>
                              <p className="text-primary font-bold">{d.score}%</p>
                              <p className="text-muted-foreground text-xs">{d.date}</p>
                            </div>
                          );
                        }}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="score"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                        name="相性スコア (%)"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>マッチング結果がまだありません</p>
                    <Link href="/matching">
                      <Button variant="outline" size="sm" className="mt-3">マッチングを開始</Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Section 2: Personality Compatibility Heatmap */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Flame className="h-5 w-5 text-orange-500" />
                  人格互換性ヒートマップ
                </CardTitle>
                <CardDescription>友達ごとの6次元スコアマトリクス（各20点満点）</CardDescription>
              </CardHeader>
              <CardContent>
                {heatmapData && heatmapData.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th className="text-left p-2 font-medium">友達</th>
                          {Object.keys(DIMENSION_LABELS).map((key) => (
                            <th key={key} className="p-2 text-center font-medium text-xs">
                              {DIMENSION_LABELS[key]}
                            </th>
                          ))}
                          <th className="p-2 text-center font-medium">合計</th>
                        </tr>
                      </thead>
                      <tbody>
                        {heatmapData.map((row: any) => (
                          <tr key={row.friendId} className="border-t">
                            <td className="p-2 font-medium whitespace-nowrap">
                              <Link href={`/users/${row.friendId}`}>
                                <span className="text-primary hover:underline cursor-pointer">{row.friendName}</span>
                              </Link>
                            </td>
                            {Object.keys(DIMENSION_LABELS).map((key) => {
                              const val = row.dimensions[key] ?? 0;
                              return (
                                <td key={key} className="p-1 text-center">
                                  <span
                                    className="inline-block rounded px-2 py-1 text-xs font-bold text-white min-w-[2.5rem]"
                                    style={{ backgroundColor: heatColor(val) }}
                                  >
                                    {val}
                                  </span>
                                </td>
                              );
                            })}
                            <td className="p-2 text-center font-bold text-primary">
                              {row.totalScore}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Flame className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>ヒートマップデータがまだありません</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Section 3: Friend Compatibility Summary Cards */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-blue-500" />
                  友達別相性サマリー
                </CardTitle>
                <CardDescription>友達ごとのマッチング統計</CardDescription>
              </CardHeader>
              <CardContent>
                {friendSummary && friendSummary.length > 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {friendSummary.map((friend: any) => (
                      <Card key={friend.friendId} className="border">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-3 mb-3">
                            <Avatar className="h-10 w-10">
                              {friend.avatarUrl ? (
                                <AvatarImage src={`${API_BASE}${friend.avatarUrl}`} alt={friend.friendName} />
                              ) : null}
                              <AvatarFallback>{(friend.friendName || "?").slice(0, 2)}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <Link href={`/users/${friend.friendId}`}>
                                <p className="font-medium text-sm truncate text-primary hover:underline cursor-pointer">
                                  {friend.friendName}
                                </p>
                              </Link>
                              <p className="text-xs text-muted-foreground truncate">{friend.latestTheme}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div>
                              <p className="text-lg font-bold text-primary">{friend.avgScore}%</p>
                              <p className="text-xs text-muted-foreground">平均</p>
                            </div>
                            <div>
                              <p className="text-lg font-bold text-green-600">{friend.maxScore}%</p>
                              <p className="text-xs text-muted-foreground">最高</p>
                            </div>
                            <div>
                              <p className="text-lg font-bold">{friend.matchCount}</p>
                              <p className="text-xs text-muted-foreground">回数</p>
                            </div>
                          </div>
                          <Link href={`/matching`}>
                            <Button variant="outline" size="sm" className="w-full mt-3">
                              <Star className="h-3 w-3 mr-1" />
                              マッチングを見る
                            </Button>
                          </Link>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>友達とのマッチングデータがまだありません</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
