import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { FileText, Mail, Calendar, TrendingUp, Trophy, Target, Loader2, RefreshCw, BarChart3, CheckCircle, Sparkles, ArrowUpRight } from "lucide-react";

// Cast trpc to bypass TypeScript for not-yet-implemented backend procedures
const t = trpc as any;

type DigestPeriod = "weekly" | "monthly";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(value);
}

export default function MatchingDigest() {
  usePageMeta({ title: "マッチングダイジェスト", description: "マッチング活動の週間/月間サマリー", path: "/digest" });

  const [period, setPeriod] = useState<DigestPeriod>("weekly");

  // Fetch existing digest
  const { data: digestData, isLoading: digestLoading, refetch: refetchDigest } = t.matching.getDigest.useQuery(
    { period },
    { enabled: true }
  );

  // Generate digest mutation
  const generateMut = t.matching.generateDigest.useMutation({
    onSuccess: () => {
      toast.success("ダイジェストを生成しました");
      refetchDigest();
    },
    onError: (err: any) => {
      toast.error(err.message || "ダイジェストの生成に失敗しました");
    },
  });

  // Send digest email mutation
  const sendEmailMut = t.matching.sendDigestEmail.useMutation({
    onSuccess: () => {
      toast.success("ダイジェストメールを送信しました");
    },
    onError: (err: any) => {
      toast.error(err.message || "メール送信に失敗しました");
    },
  });

  const handleGenerate = () => {
    generateMut.mutate({ period });
  };

  const handleSendEmail = () => {
    if (!digest?.id) return;
    sendEmailMut.mutate({ digestId: digest.id });
  };

  const digest = digestData as any;

  const stats = [
    {
      label: "マッチング数",
      value: digest?.matchCount ?? 0,
      icon: BarChart3,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-100 dark:bg-blue-900/30",
    },
    {
      label: "平均スコア",
      value: digest?.avgScore != null ? `${Math.round(digest.avgScore)}点` : "—",
      icon: TrendingUp,
      color: "text-green-600 dark:text-green-400",
      bg: "bg-green-100 dark:bg-green-900/30",
    },
    {
      label: "成果価値",
      value: digest?.outcomeValue != null ? formatCurrency(digest.outcomeValue) : "—",
      icon: Target,
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-100 dark:bg-purple-900/30",
    },
    {
      label: "完了アクション",
      value: digest?.actionsCompleted ?? 0,
      icon: CheckCircle,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-100 dark:bg-amber-900/30",
    },
  ];

  return (
    <DashboardLayout>
      <main id="main-content" className="flex-1 overflow-auto">
        <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                <FileText className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">マッチングダイジェスト</h1>
                <p className="text-sm text-muted-foreground">マッチング活動の週間/月間サマリー</p>
              </div>
            </div>
          </div>

          {/* Controls */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">ダイジェスト設定</CardTitle>
              <CardDescription>期間を選んでダイジェストを生成・送信</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-3">
                <Select value={period} onValueChange={(v) => setPeriod(v as DigestPeriod)}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">
                      <span className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5" />
                        週間
                      </span>
                    </SelectItem>
                    <SelectItem value="monthly">
                      <span className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5" />
                        月間
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={handleGenerate} disabled={generateMut.isPending}>
                  {generateMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  ダイジェスト生成
                </Button>
                {digest?.id && (
                  <Button variant="outline" onClick={handleSendEmail} disabled={sendEmailMut.isPending}>
                    {sendEmailMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Mail className="h-4 w-4 mr-2" />
                    )}
                    メール送信
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Loading state */}
          {digestLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {/* No digest yet */}
          {!digestLoading && !digest && (
            <Card>
              <CardContent className="py-16">
                <div className="text-center space-y-3">
                  <FileText className="h-12 w-12 text-muted-foreground/40 mx-auto" />
                  <p className="text-muted-foreground">ダイジェストがまだありません</p>
                  <p className="text-sm text-muted-foreground">
                    「ダイジェスト生成」ボタンで{period === "weekly" ? "週間" : "月間"}サマリーを作成します
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Digest content */}
          {digest && (
            <div className="space-y-6">
              {/* Period badge */}
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-sm">
                  <Calendar className="h-3.5 w-3.5 mr-1" />
                  {digest.periodLabel ?? (period === "weekly" ? "今週" : "今月")}
                </Badge>
                {digest.generatedAt && (
                  <span className="text-xs text-muted-foreground">
                    生成: {new Date(digest.generatedAt).toLocaleString("ja-JP")}
                  </span>
                )}
              </div>

              {/* Stats grid */}
              <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
                {stats.map((stat) => (
                  <Card key={stat.label}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${stat.bg}`}>
                          <stat.icon className={`h-4 w-4 ${stat.color}`} />
                        </div>
                        <div>
                          <p className="text-[11px] text-muted-foreground">{stat.label}</p>
                          <p className="text-lg font-bold">{stat.value}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Summary */}
              {digest.summary && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary" />
                      サマリー
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {digest.summary}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Highlights */}
              {digest.highlights && digest.highlights.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-amber-500" />
                      ハイライト
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {digest.highlights.map((item: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                          <span className="text-muted-foreground">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              <div className="grid gap-6 md:grid-cols-2">
                {/* Top performance */}
                {digest.topPerformance && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Trophy className="h-4 w-4 text-yellow-500" />
                        ベストパフォーマンス
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="p-3 rounded-lg border bg-yellow-50/50 dark:bg-yellow-900/10">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">
                            {digest.topPerformance.theme ?? "セッション"}
                          </span>
                          <Badge variant="default" className="text-xs">
                            {digest.topPerformance.score ?? 0}点
                          </Badge>
                        </div>
                        {digest.topPerformance.sessionId && (
                          <a
                            href={`/matching/${digest.topPerformance.sessionId}`}
                            className="text-xs text-primary hover:underline flex items-center gap-1 mt-1"
                          >
                            セッション詳細を見る
                            <ArrowUpRight className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Area of growth */}
                {digest.areaOfGrowth && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-green-500" />
                        成長ポイント
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {digest.areaOfGrowth}
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* AI Recommendation */}
              {digest.recommendation && (
                <Card className="border-primary/30 bg-primary/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      AIからの提案
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed">
                      {digest.recommendation}
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </main>
    </DashboardLayout>
  );
}
