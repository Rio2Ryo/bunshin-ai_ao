import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Users, BarChart3, TrendingUp, MessageSquare, UserPlus, Target, Loader2 } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

export default function AdminAnalytics() {
  usePageMeta({ title: "管理者分析", description: "DAU/MAU推移、ユーザーリテンション、マッチング成功率", path: "/admin/analytics" });
  const { data, isLoading } = trpc.analytics.adminDashboard.useQuery(undefined, { staleTime: 120_000 });

  if (isLoading || !data) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  const { overview, dau, mau, signups, retention, matchingSuccess } = data;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">管理者分析ダッシュボード</h1>
          <p className="text-muted-foreground text-sm mt-1">プラットフォーム全体の利用状況とトレンド</p>
        </div>

        {/* Overview KPI Cards */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <KPICard icon={Users} label="総ユーザー数" value={overview.totalUsers} />
          <KPICard icon={UserPlus} label="今日のDAU" value={overview.activeToday} />
          <KPICard icon={TrendingUp} label="今月のMAU" value={overview.activeMonth} />
          <KPICard icon={Target} label="総マッチング" value={overview.totalMatchings} />
          <KPICard icon={MessageSquare} label="総チャット" value={overview.totalChats} />
          <KPICard icon={BarChart3} label="総メッセージ" value={overview.totalMessages} />
        </div>

        {/* DAU Line Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">DAU（日別アクティブユーザー数）</CardTitle>
            <CardDescription>過去30日間の推移</CardDescription>
          </CardHeader>
          <CardContent>
            {dau.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={dau}>
                  <defs>
                    <linearGradient id="dauGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip labelFormatter={(v) => `日付: ${v}`} formatter={(v: number) => [`${v}人`, "DAU"]} />
                  <Area type="monotone" dataKey="count" stroke="hsl(var(--primary))" fill="url(#dauGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-12">データなし</p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          {/* MAU Bar Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">MAU（月別アクティブユーザー数）</CardTitle>
              <CardDescription>過去12ヶ月</CardDescription>
            </CardHeader>
            <CardContent>
              {mau.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={mau}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip labelFormatter={(v) => `${v}`} formatter={(v: number) => [`${v}人`, "MAU"]} />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-12">データなし</p>
              )}
            </CardContent>
          </Card>

          {/* New Signups */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">新規登録数</CardTitle>
              <CardDescription>過去30日間</CardDescription>
            </CardHeader>
            <CardContent>
              {signups.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={signups}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip labelFormatter={(v) => `日付: ${v}`} formatter={(v: number) => [`${v}人`, "新規登録"]} />
                    <Bar dataKey="count" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-12">データなし</p>
              )}
            </CardContent>
          </Card>

          {/* Retention */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">ユーザーリテンション率</CardTitle>
              <CardDescription>週別コホート (7日/30日)</CardDescription>
            </CardHeader>
            <CardContent>
              {retention.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={retention}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="cohort" tick={{ fontSize: 11 }} tickFormatter={(v) => v.replace(/^\d{4}-/, "")} />
                    <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                    <Tooltip
                      formatter={(v: number, name: string) => [`${v}%`, name === "rate7d" ? "7日リテンション" : "30日リテンション"]}
                      labelFormatter={(v) => `コホート: ${v}`}
                    />
                    <Legend formatter={(v) => (v === "rate7d" ? "7日" : "30日")} />
                    <Line type="monotone" dataKey="rate7d" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="rate30d" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-12">データなし</p>
              )}
            </CardContent>
          </Card>

          {/* Matching Success Rate */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">マッチング成功率</CardTitle>
              <CardDescription>月別推移 (スコア70+)</CardDescription>
            </CardHeader>
            <CardContent>
              {matchingSuccess.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={matchingSuccess}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                    <Tooltip
                      formatter={(v: number, name: string) => {
                        const labels: Record<string, string> = { total: "総数", successRate: "成功率(%)", avgScore: "平均スコア" };
                        return [name === "successRate" ? `${v}%` : v, labels[name] || name];
                      }}
                    />
                    <Legend formatter={(v: string) => {
                      const m: Record<string, string> = { total: "マッチング数", successRate: "成功率", avgScore: "平均スコア" };
                      return m[v] || v;
                    }} />
                    <Bar yAxisId="left" dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} opacity={0.7} />
                    <Line yAxisId="right" type="monotone" dataKey="successRate" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-12">データなし</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Retention Table */}
        {retention.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">リテンション詳細テーブル</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2 pr-4">コホート</th>
                      <th className="text-right py-2 px-3">登録数</th>
                      <th className="text-right py-2 px-3">7日後</th>
                      <th className="text-right py-2 px-3">7日率</th>
                      <th className="text-right py-2 px-3">30日後</th>
                      <th className="text-right py-2 px-3">30日率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retention.map((r: any) => (
                      <tr key={r.cohort} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-medium">{r.cohort}</td>
                        <td className="text-right py-2 px-3">{r.cohortSize}</td>
                        <td className="text-right py-2 px-3">{r.retained7d}</td>
                        <td className="text-right py-2 px-3">
                          <span className={r.rate7d >= 50 ? "text-green-600" : r.rate7d >= 25 ? "text-amber-600" : "text-red-500"}>
                            {r.rate7d}%
                          </span>
                        </td>
                        <td className="text-right py-2 px-3">{r.retained30d}</td>
                        <td className="text-right py-2 px-3">
                          <span className={r.rate30d >= 30 ? "text-green-600" : r.rate30d >= 15 ? "text-amber-600" : "text-red-500"}>
                            {r.rate30d}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

function KPICard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <p className="text-2xl font-bold">{value.toLocaleString()}</p>
      </CardContent>
    </Card>
  );
}
