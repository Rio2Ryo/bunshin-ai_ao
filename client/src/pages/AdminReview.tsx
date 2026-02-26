import { useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { trpc } from "../lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ShieldAlert,
  Users,
  Bot,
  Handshake,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Trash2,
  Search,
  Loader2,
  Clock,
  Shield,
  DollarSign,
  TrendingUp,
  Activity,
  Store,
  Coins,
} from "lucide-react";

const TARGET_TYPE_LABELS: Record<string, string> = {
  twin: "分身AI",
  chat_message: "チャットメッセージ",
  persona_template: "ペルソナテンプレート",
  user_profile: "ユーザープロフィール",
};

const ACTION_LABELS: Record<string, string> = {
  approve: "承認",
  dismiss: "却下",
  delete_content: "コンテンツ削除",
  warn_user: "ユーザー警告",
  ban_user: "ユーザーBAN",
};

const ACTION_COLORS: Record<string, string> = {
  approve: "bg-green-500/10 text-green-500",
  dismiss: "bg-gray-500/10 text-gray-500",
  delete_content: "bg-red-500/10 text-red-500",
  warn_user: "bg-yellow-500/10 text-yellow-500",
  ban_user: "bg-red-700/10 text-red-700",
};

function AdminReview() {
  const [activeTab, setActiveTab] = useState("overview");
  const [reportFilter, setReportFilter] = useState<"pending" | "reviewed" | "dismissed">("pending");
  const [userSearch, setUserSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  // Queries
  const { data: overview, isLoading: overviewLoading } = trpc.admin.overview.useQuery(undefined, {
    staleTime: 30_000,
  });

  const { data: reports, isLoading: reportsLoading, refetch: refetchReports } = trpc.admin.reports.useQuery(
    { status: reportFilter },
    { staleTime: 15_000 }
  );

  const { data: usersData, isLoading: usersLoading } = trpc.admin.users.useQuery(
    { search: userSearch || undefined, limit: 50, offset: 0 },
    { staleTime: 30_000 }
  );

  const { data: moderationHistory, isLoading: historyLoading } = trpc.admin.moderationHistory.useQuery(undefined, {
    staleTime: 30_000,
  });

  const { data: revenueData, isLoading: revenueLoading } = trpc.admin.revenue.useQuery(undefined, {
    staleTime: 60_000,
  });

  // Mutations
  const reviewMutation = trpc.admin.reviewReport.useMutation({
    onSuccess: () => {
      toast.success("レポートを処理しました");
      refetchReports();
    },
    onError: (err) => {
      toast.error(`エラー: ${err.message}`);
    },
  });

  const handleReview = (reportId: number, action: "approve" | "dismiss" | "delete_content" | "warn_user" | "ban_user") => {
    reviewMutation.mutate({ reportId, action });
  };

  const handleUserSearch = () => {
    setUserSearch(searchInput);
  };

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-red-500/10 flex items-center justify-center">
            <ShieldAlert className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">コンテンツ審査</h1>
            <p className="text-sm text-muted-foreground">コンテンツレポートの確認とモデレーション管理</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">概要</TabsTrigger>
            <TabsTrigger value="reports" className="relative">
              レポート
              {overview?.stats?.pendingReports && overview.stats.pendingReports > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-[10px] text-white flex items-center justify-center">
                  {overview.stats.pendingReports}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="users">ユーザー</TabsTrigger>
            <TabsTrigger value="history">履歴</TabsTrigger>
            <TabsTrigger value="revenue">収益</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {overviewLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                          <Users className="h-5 w-5 text-blue-500" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{overview?.stats?.users ?? 0}</p>
                          <p className="text-xs text-muted-foreground">ユーザー数</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                          <Bot className="h-5 w-5 text-purple-500" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{overview?.stats?.twins ?? 0}</p>
                          <p className="text-xs text-muted-foreground">分身AI数</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                          <Handshake className="h-5 w-5 text-green-500" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{overview?.stats?.matchings ?? 0}</p>
                          <p className="text-xs text-muted-foreground">マッチング数</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                          <AlertTriangle className="h-5 w-5 text-red-500" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{overview?.stats?.pendingReports ?? 0}</p>
                          <p className="text-xs text-muted-foreground">未処理レポート</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Recent Activity */}
                <div className="grid md:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">最近のユーザー登録</CardTitle>
                      <CardDescription>直近10件</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {overview?.recentUsers && overview.recentUsers.length > 0 ? (
                        <div className="space-y-3">
                          {overview.recentUsers.map((u: any) => (
                            <div key={u.id} className="flex items-center justify-between text-sm">
                              <div>
                                <p className="font-medium">{u.name || "---"}</p>
                                <p className="text-xs text-muted-foreground">{u.email}</p>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {u.createdAt ? new Date(u.createdAt).toLocaleDateString("ja-JP") : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">まだユーザーがいません</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">最近のマッチング</CardTitle>
                      <CardDescription>直近10件</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {overview?.recentMatchings && overview.recentMatchings.length > 0 ? (
                        <div className="space-y-3">
                          {overview.recentMatchings.map((m: any) => (
                            <div key={m.id} className="flex items-center justify-between text-sm">
                              <div>
                                <p className="font-medium">{m.theme || "---"}</p>
                                <p className="text-xs text-muted-foreground">{m.initiatorName}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant={m.status === "completed" ? "default" : "secondary"} className="text-[10px]">
                                  {m.status}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {m.createdAt ? new Date(m.createdAt).toLocaleDateString("ja-JP") : ""}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">まだマッチングがありません</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </TabsContent>

          {/* Reports Tab */}
          <TabsContent value="reports" className="space-y-4">
            <div className="flex items-center gap-2">
              <Button
                variant={reportFilter === "pending" ? "default" : "outline"}
                size="sm"
                onClick={() => setReportFilter("pending")}
              >
                <Clock className="h-3.5 w-3.5 mr-1" />
                未処理
              </Button>
              <Button
                variant={reportFilter === "reviewed" ? "default" : "outline"}
                size="sm"
                onClick={() => setReportFilter("reviewed")}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                処理済み
              </Button>
              <Button
                variant={reportFilter === "dismissed" ? "default" : "outline"}
                size="sm"
                onClick={() => setReportFilter("dismissed")}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                却下済み
              </Button>
            </div>

            {reportsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : reports && reports.length > 0 ? (
              <div className="space-y-3">
                {reports.map((report: any) => (
                  <Card key={report.id}>
                    <CardContent className="pt-6">
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div className="space-y-2 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline">
                              {TARGET_TYPE_LABELS[report.targetType] || report.targetType}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px]">
                              ID: {report.targetId}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              報告者: {report.reporterName}
                            </span>
                          </div>
                          <p className="text-sm font-medium">{report.reason}</p>
                          {report.details && (
                            <p className="text-sm text-muted-foreground">{report.details}</p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {report.createdAt ? new Date(report.createdAt).toLocaleString("ja-JP") : ""}
                          </p>
                          {report.action && (
                            <Badge className={ACTION_COLORS[report.action] || ""}>
                              {ACTION_LABELS[report.action] || report.action}
                            </Badge>
                          )}
                        </div>
                        {reportFilter === "pending" && (
                          <div className="flex items-center gap-2 shrink-0 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleReview(report.id, "approve")}
                              disabled={reviewMutation.isPending}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                              承認
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleReview(report.id, "dismiss")}
                              disabled={reviewMutation.isPending}
                            >
                              <XCircle className="h-3.5 w-3.5 mr-1" />
                              却下
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleReview(report.id, "delete_content")}
                              disabled={reviewMutation.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-1" />
                              削除
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-8 text-muted-foreground">
                    <ShieldAlert className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">
                      {reportFilter === "pending" ? "未処理のレポートはありません" : "該当するレポートはありません"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="名前またはメールで検索..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleUserSearch()}
                  className="pl-9"
                />
              </div>
              <Button size="sm" onClick={handleUserSearch}>
                <Search className="h-3.5 w-3.5 mr-1" />
                検索
              </Button>
            </div>

            {usersLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  全 {usersData?.total ?? 0} 件中 {usersData?.users?.length ?? 0} 件表示
                </p>
                <div className="space-y-2">
                  {usersData?.users && usersData.users.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="py-2 px-3 font-medium text-muted-foreground">ID</th>
                            <th className="py-2 px-3 font-medium text-muted-foreground">名前</th>
                            <th className="py-2 px-3 font-medium text-muted-foreground">メール</th>
                            <th className="py-2 px-3 font-medium text-muted-foreground">ロール</th>
                            <th className="py-2 px-3 font-medium text-muted-foreground">プラン</th>
                            <th className="py-2 px-3 font-medium text-muted-foreground">信頼度</th>
                            <th className="py-2 px-3 font-medium text-muted-foreground">マッチング</th>
                            <th className="py-2 px-3 font-medium text-muted-foreground">登録日</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usersData.users.map((u: any) => (
                            <tr key={u.id} className="border-b hover:bg-muted/50 transition-colors">
                              <td className="py-2 px-3 text-muted-foreground">{u.id}</td>
                              <td className="py-2 px-3 font-medium">{u.name || "---"}</td>
                              <td className="py-2 px-3 text-muted-foreground">{u.email || "---"}</td>
                              <td className="py-2 px-3">
                                <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-[10px]">
                                  {u.role}
                                </Badge>
                              </td>
                              <td className="py-2 px-3">
                                <Badge variant="outline" className="text-[10px]">
                                  {u.plan}
                                </Badge>
                              </td>
                              <td className="py-2 px-3">
                                {u.trustScore != null ? (
                                  <div className="flex items-center gap-1">
                                    <Shield className="h-3 w-3 text-muted-foreground" />
                                    <span>{u.trustScore}</span>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-center">{u.matchingCount ?? 0}</td>
                              <td className="py-2 px-3 text-muted-foreground text-xs">
                                {u.createdAt ? new Date(u.createdAt).toLocaleDateString("ja-JP") : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-center py-8 text-muted-foreground">
                          <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">ユーザーが見つかりません</p>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </>
            )}
          </TabsContent>

          {/* Moderation History Tab */}
          <TabsContent value="history" className="space-y-4">
            {historyLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : moderationHistory && moderationHistory.length > 0 ? (
              <div className="space-y-3">
                {moderationHistory.map((action: any) => (
                  <Card key={action.id}>
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={ACTION_COLORS[action.action] || "bg-gray-500/10 text-gray-500"}>
                              {ACTION_LABELS[action.action] || action.action}
                            </Badge>
                            <Badge variant="outline">
                              {TARGET_TYPE_LABELS[action.targetType] || action.targetType}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px]">
                              ID: {action.targetId}
                            </Badge>
                          </div>
                          {action.reason && (
                            <p className="text-sm text-muted-foreground">{action.reason}</p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            管理者: {action.adminName} | {action.createdAt ? new Date(action.createdAt).toLocaleString("ja-JP") : ""}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">モデレーション履歴はありません</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Revenue Tab */}
          <TabsContent value="revenue" className="space-y-6">
            {revenueLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* KPI Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                          <Users className="h-5 w-5 text-blue-500" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{revenueData?.totalUsers ?? 0}</p>
                          <p className="text-xs text-muted-foreground">総ユーザー数</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                          <Activity className="h-5 w-5 text-green-500" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{revenueData?.activeUsers ?? 0}</p>
                          <p className="text-xs text-muted-foreground">アクティブ (30日)</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                          <DollarSign className="h-5 w-5 text-amber-500" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{"\u00A5"}{(revenueData?.monthlyRevenue ?? 0).toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">月間収益 (推定)</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                          <TrendingUp className="h-5 w-5 text-red-500" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{revenueData?.churnRate ?? 0}%</p>
                          <p className="text-xs text-muted-foreground">解約率 (30日)</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  {/* Plan Distribution */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">プラン別ユーザー分布</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {revenueData?.planDistribution && revenueData.planDistribution.length > 0 ? (
                        <div className="space-y-4">
                          {(() => {
                            const planLabels: Record<string, string> = { free: "フリー", premium: "プレミアム", enterprise: "エンタープライズ" };
                            const planColors: Record<string, string> = { free: "bg-gray-400", premium: "bg-amber-500", enterprise: "bg-purple-500" };
                            const total = revenueData.planDistribution.reduce((s: number, p: any) => s + (p.count || 0), 0);
                            return revenueData.planDistribution.map((p: any) => {
                              const pct = total > 0 ? Math.round((p.count / total) * 100) : 0;
                              return (
                                <div key={p.plan} className="space-y-1.5">
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="font-medium">{planLabels[p.plan] || p.plan}</span>
                                    <span className="text-muted-foreground">{p.count}人 ({pct}%)</span>
                                  </div>
                                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${planColors[p.plan] || "bg-blue-500"}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">データがありません</p>
                      )}
                    </CardContent>
                  </Card>

                  {/* Monthly Revenue Trend */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">月間収益トレンド</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {revenueData?.monthlyTrend && revenueData.monthlyTrend.length > 0 ? (
                        <div className="space-y-2">
                          {(() => {
                            const maxRevenue = Math.max(...revenueData.monthlyTrend.map((m: any) => m.revenue || 0), 1);
                            return revenueData.monthlyTrend.map((m: any) => {
                              const pct = Math.round(((m.revenue || 0) / maxRevenue) * 100);
                              return (
                                <div key={m.month} className="flex items-center gap-3 text-sm">
                                  <span className="w-16 text-muted-foreground text-xs shrink-0">{m.month}</span>
                                  <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                                    <div
                                      className="h-full bg-amber-500 rounded transition-all"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  <span className="w-20 text-right text-xs font-medium shrink-0">
                                    {"\u00A5"}{(m.revenue || 0).toLocaleString()}
                                  </span>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">データがありません</p>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  {/* DAU Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">日次アクティブユーザー (14日間)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {revenueData?.dailyActive && revenueData.dailyActive.length > 0 ? (
                        <div className="flex items-end gap-1 h-32">
                          {(() => {
                            const maxCount = Math.max(...revenueData.dailyActive.map((d: any) => d.count || 0), 1);
                            return revenueData.dailyActive.map((d: any) => {
                              const heightPct = Math.max(((d.count || 0) / maxCount) * 100, 4);
                              const dayLabel = d.day ? d.day.slice(5) : "";
                              return (
                                <div key={d.day} className="flex-1 flex flex-col items-center gap-1" title={`${d.day}: ${d.count}人`}>
                                  <span className="text-[10px] text-muted-foreground">{d.count}</span>
                                  <div className="w-full flex justify-center">
                                    <div
                                      className="w-full max-w-[24px] bg-blue-500 rounded-t transition-all"
                                      style={{ height: `${heightPct}%`, minHeight: "4px" }}
                                    />
                                  </div>
                                  <span className="text-[9px] text-muted-foreground">{dayLabel}</span>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">データがありません</p>
                      )}
                    </CardContent>
                  </Card>

                  {/* Marketplace & Points */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">マーケットプレイス & ポイント経済</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {/* Marketplace */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Store className="h-4 w-4 text-purple-500" />
                          マーケットプレイス
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-lg bg-muted/50 p-3">
                            <p className="text-lg font-bold">{revenueData?.marketplaceSales?.count ?? 0}</p>
                            <p className="text-xs text-muted-foreground">総販売数</p>
                          </div>
                          <div className="rounded-lg bg-muted/50 p-3">
                            <p className="text-lg font-bold">{(revenueData?.marketplaceSales?.totalPoints ?? 0).toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground">消費ポイント</p>
                          </div>
                        </div>
                      </div>

                      {/* Point Economy */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Coins className="h-4 w-4 text-amber-500" />
                          ポイント経済
                        </div>
                        {revenueData?.pointStats && revenueData.pointStats.length > 0 ? (
                          <div className="space-y-2">
                            {revenueData.pointStats.map((ps: any) => {
                              const typeLabels: Record<string, string> = { earn: "獲得", spend: "消費", expire: "期限切れ", bonus: "ボーナス", refund: "返金" };
                              const typeColors: Record<string, string> = { earn: "text-green-500", spend: "text-red-500", expire: "text-gray-500", bonus: "text-blue-500", refund: "text-amber-500" };
                              return (
                                <div key={ps.type} className="flex items-center justify-between text-sm">
                                  <span className={`font-medium ${typeColors[ps.type] || ""}`}>
                                    {typeLabels[ps.type] || ps.type}
                                  </span>
                                  <div className="text-right">
                                    <span className="font-medium">{(ps.total || 0).toLocaleString()}pt</span>
                                    <span className="text-muted-foreground text-xs ml-2">({ps.count}件)</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">ポイント取引がありません</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

export default AdminReview;
