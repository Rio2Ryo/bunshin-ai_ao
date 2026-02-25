import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { BarChart3, MessageSquare, Users, TrendingUp, Target, UserPlus, Shield, Loader2 } from "lucide-react";

function MiniBar({ value, max, color = "bg-primary" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-full w-full flex items-end">
      <div className={`w-full rounded-t ${color} transition-all`} style={{ height: `${Math.max(pct, 4)}%` }} />
    </div>
  );
}

export default function Analytics() {
  usePageMeta({ title: "分析ダッシュボード", description: "マッチング成功率やエンゲージメントの推移を確認", path: "/analytics" });
  const { data, isLoading } = trpc.analytics.dashboard.useQuery(undefined, { staleTime: 60_000 });

  if (isLoading || !data) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  const { matching, scoreDist, monthlyTrend, engagement, weeklyMessages } = data;
  const maxMonthly = Math.max(...monthlyTrend.map((m: any) => m.count), 1);
  const maxWeekly = Math.max(...weeklyMessages.map((w: any) => w.count), 1);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">分析ダッシュボード</h1>
          <p className="text-muted-foreground text-sm mt-1">マッチング成功率とエンゲージメントの推移</p>
        </div>

        {/* KPI Cards */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <KPICard icon={Target} label="マッチング数" value={matching.total} sub={`${matching.completed}件完了`} />
          <KPICard icon={TrendingUp} label="成功率" value={`${matching.successRate}%`} sub={`スコア70+: ${matching.highScoreCount}件`} />
          <KPICard icon={BarChart3} label="平均スコア" value={`${matching.avgScore}`} sub="相性スコア平均" />
          <KPICard icon={MessageSquare} label="メッセージ" value={engagement.totalMessages} sub={`${engagement.totalChats}チャット`} />
        </div>

        {/* Charts Row */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Monthly Matching Trend */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                月別マッチング数
              </CardTitle>
              <CardDescription>過去6ヶ月の推移</CardDescription>
            </CardHeader>
            <CardContent>
              {monthlyTrend.length > 0 ? (
                <div className="flex items-end gap-2 h-40">
                  {monthlyTrend.map((m: any) => (
                    <div key={m.month} className="flex-1 flex flex-col items-center gap-1 h-full">
                      <span className="text-[10px] text-muted-foreground font-medium">{m.count}</span>
                      <div className="flex-1 w-full">
                        <MiniBar value={m.count} max={maxMonthly} />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{m.month.slice(5)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">データなし</p>
              )}
            </CardContent>
          </Card>

          {/* Score Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                スコア分布
              </CardTitle>
              <CardDescription>相性スコアの分布</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <DistBar label="80-100 (優秀)" value={scoreDist.excellent} total={matching.completed} color="bg-green-500" />
                <DistBar label="60-79 (良好)" value={scoreDist.good} total={matching.completed} color="bg-blue-500" />
                <DistBar label="40-59 (普通)" value={scoreDist.fair} total={matching.completed} color="bg-yellow-500" />
                <DistBar label="0-39 (低い)" value={scoreDist.low} total={matching.completed} color="bg-red-400" />
              </div>
            </CardContent>
          </Card>

          {/* Weekly Messages */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" />
                週別メッセージ数
              </CardTitle>
              <CardDescription>過去8週間のチャット活動</CardDescription>
            </CardHeader>
            <CardContent>
              {weeklyMessages.length > 0 ? (
                <div className="flex items-end gap-2 h-40">
                  {weeklyMessages.map((w: any) => (
                    <div key={w.week} className="flex-1 flex flex-col items-center gap-1 h-full">
                      <span className="text-[10px] text-muted-foreground font-medium">{w.count}</span>
                      <div className="flex-1 w-full">
                        <MiniBar value={w.count} max={maxWeekly} color="bg-indigo-500" />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{w.week.slice(-3)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">データなし</p>
              )}
            </CardContent>
          </Card>

          {/* Engagement Overview */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                エンゲージメント
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <UserPlus className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                  <p className="text-2xl font-bold">{engagement.friendCount}</p>
                  <p className="text-xs text-muted-foreground">友達数</p>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <Shield className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                  <p className="text-2xl font-bold">{engagement.trustScore}</p>
                  <p className="text-xs text-muted-foreground">信頼スコア</p>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <MessageSquare className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                  <p className="text-2xl font-bold">{engagement.totalChats}</p>
                  <p className="text-xs text-muted-foreground">チャット数</p>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <TrendingUp className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                  <p className="text-2xl font-bold">{matching.avgScore || "-"}</p>
                  <p className="text-xs text-muted-foreground">平均相性</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

function KPICard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string | number; sub: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
      </CardContent>
    </Card>
  );
}

function DistBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span className="text-muted-foreground">{value}件 ({pct}%)</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
