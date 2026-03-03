import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Flame, Trophy, Star, Crown, Target, Zap, Gift, TrendingUp, Loader2 } from "lucide-react";
import { usePageMeta } from "@/hooks/usePageMeta";

export default function MatchingStreaks() {
  usePageMeta({ title: "マッチングストリーク", description: "連続マッチング記録とアチーブメント", path: "/streaks" });
  const { data, isLoading, refetch } = trpc.matching.getStreak.useQuery();
  const claimMutation = trpc.matching.claimAchievement.useMutation({
    onSuccess: (result) => {
      toast.success(`${result.pointsAwarded}pt 獲得しました！`);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  const streakIcon = (streak: number) => {
    if (streak >= 30) return <Crown className="h-8 w-8 text-yellow-400" />;
    if (streak >= 7) return <Flame className="h-8 w-8 text-orange-500" />;
    if (streak >= 3) return <Flame className="h-8 w-8 text-orange-400" />;
    return <Target className="h-8 w-8 text-muted-foreground" />;
  };

  const streakBadgeColor = (streak: number) => {
    if (streak >= 30) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    if (streak >= 7) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    if (streak >= 3) return "bg-red-500/20 text-red-400 border-red-500/30";
    return "bg-muted text-muted-foreground";
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold">マッチングストリーク</h1>
          <p className="text-muted-foreground mt-1">連続マッチングで追加ポイントをゲット</p>
        </div>

        {/* Streak Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-2 border-primary/20">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                {streakIcon(data?.currentStreak ?? 0)}
                <div>
                  <p className="text-sm text-muted-foreground">現在のストリーク</p>
                  <p className="text-3xl font-bold">{data?.currentStreak ?? 0}<span className="text-lg text-muted-foreground ml-1">日</span></p>
                </div>
              </div>
              {(data?.currentStreak ?? 0) > 0 && (
                <Badge className={`mt-3 ${streakBadgeColor(data?.currentStreak ?? 0)}`}>
                  {(data?.currentStreak ?? 0) >= 30 ? "🌟 レジェンド" : (data?.currentStreak ?? 0) >= 7 ? "💪 アクティブ" : (data?.currentStreak ?? 0) >= 3 ? "🔥 がんばってる" : "スタート"}
                </Badge>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <Trophy className="h-8 w-8 text-amber-500" />
                <div>
                  <p className="text-sm text-muted-foreground">最長ストリーク</p>
                  <p className="text-3xl font-bold">{data?.longestStreak ?? 0}<span className="text-lg text-muted-foreground ml-1">日</span></p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <TrendingUp className="h-8 w-8 text-green-500" />
                <div>
                  <p className="text-sm text-muted-foreground">合計マッチング</p>
                  <p className="text-3xl font-bold">{data?.totalMatchings ?? 0}<span className="text-lg text-muted-foreground ml-1">回</span></p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Next Bonus */}
        {data?.nextBonus && (
          <Card className="bg-gradient-to-r from-orange-500/10 to-yellow-500/10 border-orange-500/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Zap className="h-6 w-6 text-orange-500" />
                  <div>
                    <p className="font-semibold">次のストリークボーナス</p>
                    <p className="text-sm text-muted-foreground">
                      {data.nextBonus.days}日連続で <span className="font-bold text-orange-400">+{data.nextBonus.bonus}pt</span>
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">あと{data.nextBonus.days - (data?.currentStreak ?? 0)}日</p>
                  <Progress 
                    value={((data?.currentStreak ?? 0) / data.nextBonus.days) * 100} 
                    className="w-32 mt-1 h-2"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Streak Bonus Milestones */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="h-5 w-5" />
              ストリークボーナス
            </CardTitle>
            <CardDescription>連続マッチングでポイントが自動付与されます</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(data?.streakBonuses ?? []).map((bonus: { days: number; bonus: number }) => {
                const reached = (data?.currentStreak ?? 0) >= bonus.days;
                return (
                  <div key={bonus.days} className={`flex items-center justify-between p-3 rounded-lg border ${reached ? "bg-green-500/10 border-green-500/30" : "bg-muted/30"}`}>
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{bonus.days >= 30 ? "🌟" : bonus.days >= 7 ? "💪" : "🔥"}</span>
                      <div>
                        <p className="font-medium">{bonus.days}日連続</p>
                        <p className="text-sm text-muted-foreground">+{bonus.bonus}pt ボーナス</p>
                      </div>
                    </div>
                    {reached ? (
                      <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30">達成済み</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">あと{bonus.days - (data?.currentStreak ?? 0)}日</span>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Achievements */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5" />
              マッチングアチーブメント
            </CardTitle>
            <CardDescription>マッチング回数に応じた実績と報酬</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(data?.achievements ?? []).map((a: any) => (
                <div key={a.key} className={`flex items-center justify-between p-4 rounded-lg border ${a.unlocked ? "bg-primary/5 border-primary/20" : "bg-muted/20 opacity-60"}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{a.icon}</span>
                    <div>
                      <p className="font-medium">{a.label}</p>
                      <p className="text-xs text-muted-foreground">{a.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Progress value={(a.progress / a.threshold) * 100} className="w-20 h-1.5" />
                        <span className="text-xs text-muted-foreground">{a.progress}/{a.threshold}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="outline" className="text-xs">
                      <Gift className="h-3 w-3 mr-1" />{a.points}pt
                    </Badge>
                    {a.unlocked && !a.claimed && (
                      <Button 
                        size="sm" 
                        variant="default"
                        className="h-7 text-xs"
                        onClick={() => claimMutation.mutate({ achievementKey: a.key })}
                        disabled={claimMutation.isPending}
                      >
                        {claimMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "報酬を受け取る"}
                      </Button>
                    )}
                    {a.claimed && (
                      <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">受取済み</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Total Bonus */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Gift className="h-6 w-6 text-primary" />
                <div>
                  <p className="font-semibold">累計獲得ボーナス</p>
                  <p className="text-sm text-muted-foreground">ストリークボーナスで獲得したポイント</p>
                </div>
              </div>
              <p className="text-2xl font-bold text-primary">{data?.totalBonusEarned ?? 0}<span className="text-sm text-muted-foreground ml-1">pt</span></p>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
