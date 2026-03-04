import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { RadarChart } from "@/components/RadarChart";
import { Loader2, ArrowUpDown, TrendingUp, TrendingDown, Minus, Target, Users } from "lucide-react";

function DiffBadge({ diff }: { diff: number }) {
  if (Math.abs(diff) < 5) return <Badge variant="outline" className="text-xs"><Minus className="h-3 w-3 mr-1" />同等</Badge>;
  if (diff > 0) return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs"><TrendingUp className="h-3 w-3 mr-1" />+{diff}</Badge>;
  return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs"><TrendingDown className="h-3 w-3 mr-1" />{diff}</Badge>;
}

export default function TwinCompare() {
  usePageMeta({ title: "ツイン比較", description: "ツイン同士のレーダーチャート比較", path: "/twin-compare" });
  const [friendId, setFriendId] = useState<number | null>(null);

  const { data: friends, isLoading: loadingFriends } = trpc.friends.list.useQuery();
  const { data: comparison, isLoading: loadingComparison } = trpc.myTwin.twinComparison.useQuery(
    { friendId: friendId! },
    { enabled: !!friendId },
  );

  const friendList = (friends ?? []).filter((f: any) => f.friendship?.status === "accepted");

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ArrowUpDown className="h-6 w-6 text-primary" />
            ツイン比較
          </h1>
          <p className="text-muted-foreground mt-1">自分と友達のツインを6軸レーダーチャートで比較</p>
        </div>

        {/* Friend Selector */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <Users className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium mb-2">比較する友達を選択</p>
                {loadingFriends ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Select
                    value={friendId?.toString() ?? ""}
                    onValueChange={(v) => setFriendId(parseInt(v))}
                  >
                    <SelectTrigger className="w-full max-w-sm">
                      <SelectValue placeholder="友達を選択..." />
                    </SelectTrigger>
                    <SelectContent>
                      {friendList.map((f: any) => (
                        <SelectItem key={f.friend.id} value={f.friend.id.toString()}>
                          {f.friend.name || f.friend.email || `User #${f.friend.id}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {!friendId && (
          <Card>
            <CardContent className="py-12 text-center">
              <ArrowUpDown className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">友達を選択するとレーダーチャートが表示されます</p>
            </CardContent>
          </Card>
        )}

        {friendId && loadingComparison && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {comparison && (
          <>
            {/* Compatibility Score */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="border-2 border-primary/20">
                <CardContent className="pt-6 text-center">
                  <Target className="h-8 w-8 mx-auto mb-2 text-primary" />
                  <p className="text-sm text-muted-foreground">予測相性スコア</p>
                  <p className="text-4xl font-bold text-primary">{comparison.compatibilityScore}%</p>
                  <p className="text-xs text-muted-foreground mt-1">6軸の類似度に基づく予測</p>
                </CardContent>
              </Card>
              {comparison.actualMatchScore !== null && (
                <Card className="border-2 border-green-500/20">
                  <CardContent className="pt-6 text-center">
                    <Target className="h-8 w-8 mx-auto mb-2 text-green-500" />
                    <p className="text-sm text-muted-foreground">実際のマッチングスコア</p>
                    <p className="text-4xl font-bold text-green-500">{comparison.actualMatchScore}%</p>
                    <p className="text-xs text-muted-foreground mt-1">直近のマッチング結果</p>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Radar Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">6軸レーダーチャート</CardTitle>
                <CardDescription>{comparison.myTwin.name} vs {comparison.friendTwin.displayName || comparison.friendTwin.name}</CardDescription>
              </CardHeader>
              <CardContent>
                <RadarChart
                  data={comparison.axes.map((a: any) => ({
                    trait: a.label,
                    value: comparison.myTwin.scores[a.key],
                    fullMark: 100,
                  }))}
                  compareData={comparison.axes.map((a: any) => ({
                    trait: a.label,
                    value: comparison.friendTwin.scores[a.key],
                  }))}
                  userName={comparison.myTwin.name}
                  compareName={comparison.friendTwin.displayName || comparison.friendTwin.name}
                />
              </CardContent>
            </Card>

            {/* Diff Highlights */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">差分ハイライト</CardTitle>
                <CardDescription>各軸のスコア差（自分 - 友達）</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  {comparison.diffs.map((d: any) => (
                    <div key={d.key} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                      <div className="flex-1">
                        <p className="font-medium text-sm">{d.label}</p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                          <span>自分: {d.myScore}</span>
                          <span>友達: {d.friendScore}</span>
                        </div>
                      </div>
                      <DiffBadge diff={d.diff} />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
