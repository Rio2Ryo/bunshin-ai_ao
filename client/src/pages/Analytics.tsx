import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { BarChart3, MessageSquare, Users, TrendingUp, Target, UserPlus, Shield, Loader2 } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";

export default function Analytics() {
  const { t } = useTranslation();
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

  const scoreDistData = [
    { name: `80-100 (${t("analytics.excellent")})`, value: scoreDist.excellent, fill: "#22c55e" },
    { name: `60-79 (${t("analytics.good")})`, value: scoreDist.good, fill: "#3b82f6" },
    { name: `40-59 (${t("analytics.fair")})`, value: scoreDist.fair, fill: "#eab308" },
    { name: `0-39 (${t("analytics.low")})`, value: scoreDist.low, fill: "#f87171" },
  ].filter((d) => d.value > 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{t("analytics.title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("analytics.subtitle")}</p>
        </div>

        {/* KPI Cards */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <KPICard icon={Target} label={t("analytics.matchingCount")} value={matching.total} sub={`${matching.completed}件完了`} />
          <KPICard icon={TrendingUp} label={t("analytics.successRate")} value={`${matching.successRate}%`} sub={`スコア70+: ${matching.highScoreCount}件`} />
          <KPICard icon={BarChart3} label={t("analytics.avgScore")} value={`${matching.avgScore}`} sub={t("analytics.scoreAvgDesc")} />
          <KPICard icon={MessageSquare} label={t("analytics.messages")} value={engagement.totalMessages} sub={`${engagement.totalChats}チャット`} />
        </div>

        {/* Charts Row */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Monthly Matching Trend */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                {t("analytics.monthlyTrend")}
              </CardTitle>
              <CardDescription>{t("analytics.last6months")}</CardDescription>
            </CardHeader>
            <CardContent>
              {monthlyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      labelFormatter={(v) => `${v}`}
                      formatter={(v: number, name: string) => [v, name === "count" ? "マッチング数" : "平均スコア"]}
                    />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">{t("analytics.noData")}</p>
              )}
            </CardContent>
          </Card>

          {/* Score Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                {t("analytics.scoreDist")}
              </CardTitle>
              <CardDescription>{t("analytics.scoreDistDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {scoreDistData.length > 0 ? (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="50%" height={200}>
                    <PieChart>
                      <Pie
                        data={scoreDistData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        innerRadius={40}
                      >
                        {scoreDistData.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number, name: string) => [`${v}件`, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2 text-sm flex-1">
                    {scoreDistData.map((d) => (
                      <div key={d.name} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: d.fill }} />
                        <span className="text-muted-foreground">{d.name}</span>
                        <span className="ml-auto font-medium">{d.value}件</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">{t("analytics.noData")}</p>
              )}
            </CardContent>
          </Card>

          {/* Weekly Messages */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" />
                {t("analytics.weeklyMessages")}
              </CardTitle>
              <CardDescription>{t("analytics.weeklyDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {weeklyMessages.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={weeklyMessages}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="week" tick={{ fontSize: 11 }} tickFormatter={(v) => v.replace(/^\d{4}-/, "")} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      labelFormatter={(v) => `週: ${v}`}
                      formatter={(v: number) => [`${v}件`, "メッセージ"]}
                    />
                    <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={{ r: 3, fill: "#6366f1" }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">{t("analytics.noData")}</p>
              )}
            </CardContent>
          </Card>

          {/* Engagement Overview */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                {t("analytics.engagement")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <UserPlus className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                  <p className="text-2xl font-bold">{engagement.friendCount}</p>
                  <p className="text-xs text-muted-foreground">{t("analytics.friendCount")}</p>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <Shield className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                  <p className="text-2xl font-bold">{engagement.trustScore}</p>
                  <p className="text-xs text-muted-foreground">{t("analytics.trustScore")}</p>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <MessageSquare className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                  <p className="text-2xl font-bold">{engagement.totalChats}</p>
                  <p className="text-xs text-muted-foreground">{t("analytics.chatCount")}</p>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <TrendingUp className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                  <p className="text-2xl font-bold">{matching.avgScore || "-"}</p>
                  <p className="text-xs text-muted-foreground">{t("analytics.avgCompat")}</p>
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
