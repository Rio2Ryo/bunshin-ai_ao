import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { CalendarRange, TrendingUp, TrendingDown, Mail, Sparkles, BarChart3, Target, MessageSquare, Loader2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

type WeeklyStats = {
  matchingCount: number;
  avgScore: number;
  chatMessages: number;
  goalsCompleted: number;
};

type Improvement = {
  label: string;
  change: number;
};

type Recommendation = {
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
};

type WeeklyReviewData = {
  id: string;
  weekStart: string;
  weekEnd: string;
  summary: string;
  stats: WeeklyStats;
  improvements: Improvement[];
  deteriorations: Improvement[];
  recommendations: Recommendation[];
  createdAt: string;
};

const WEEK_OFFSETS = [
  { value: "0", label: "今週" },
  { value: "1", label: "先週" },
  { value: "2", label: "2週間前" },
  { value: "3", label: "3週間前" },
  { value: "4", label: "4週間前" },
];

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-500/20 text-red-600 border-red-500/30",
  medium: "bg-yellow-500/20 text-yellow-600 border-yellow-500/30",
  low: "bg-green-500/20 text-green-600 border-green-500/30",
};

const PRIORITY_LABELS: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export default function WeeklyReview() {
  usePageMeta({ title: "週次レビュー", description: "週次の振り返りレポートを生成", path: "/weekly-review" });

  const [weekOffset, setWeekOffset] = useState("0");
  const [latestReview, setLatestReview] = useState<WeeklyReviewData | null>(null);
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);

  const { data: reviewsRaw, refetch: refetchReviews } = trpc.myTwin.listWeeklyReviews.useQuery();
  const reviews = (reviewsRaw as any[]) || [];

  const generateReview = trpc.myTwin.generateWeeklyReview.useMutation({
    onSuccess: (data: any) => {
      setLatestReview(data as WeeklyReviewData);
      refetchReviews();
      toast.success("レビューを生成しました");
    },
    onError: (err: any) => toast.error(err.message || "レビュー生成に失敗しました"),
  });

  const sendEmail = trpc.myTwin.sendWeeklyReviewEmail.useMutation({
    onSuccess: () => toast.success("メールを送信しました"),
    onError: (err: any) => toast.error(err.message || "メール送信に失敗しました"),
  });

  const handleGenerate = () => {
    generateReview.mutate({ weekOffset: Number(weekOffset) });
  };

  // Build trend data from reviews
  const trendData = [...reviews]
    .reverse()
    .map((r: any) => ({
      week: r.weekStart ? new Date(r.weekStart).toLocaleDateString("ja-JP", { month: "short", day: "numeric" }) : "",
      matchingCount: r.stats?.matchingCount ?? 0,
      avgScore: r.stats?.avgScore ?? 0,
    }));

  const renderReviewDetail = (review: WeeklyReviewData) => {
    const stats = review.stats || { matchingCount: 0, avgScore: 0, chatMessages: 0, goalsCompleted: 0 };
    const improvements = review.improvements || [];
    const deteriorations = review.deteriorations || [];
    const recommendations = review.recommendations || [];

    return (
      <div className="space-y-4">
        {/* Summary */}
        <div className="p-4 bg-primary/5 border rounded-lg">
          <p className="text-sm">{review.summary}</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 text-center">
            <Target className="h-5 w-5 mx-auto text-blue-500 mb-1" />
            <p className="text-xs text-muted-foreground">マッチング数</p>
            <p className="text-xl font-bold">{stats.matchingCount}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <BarChart3 className="h-5 w-5 mx-auto text-green-500 mb-1" />
            <p className="text-xs text-muted-foreground">平均スコア</p>
            <p className="text-xl font-bold">{(stats.avgScore ?? 0).toFixed(1)}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <MessageSquare className="h-5 w-5 mx-auto text-purple-500 mb-1" />
            <p className="text-xs text-muted-foreground">チャット数</p>
            <p className="text-xl font-bold">{stats.chatMessages}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <Sparkles className="h-5 w-5 mx-auto text-yellow-500 mb-1" />
            <p className="text-xs text-muted-foreground">目標達成</p>
            <p className="text-xl font-bold">{stats.goalsCompleted}</p>
          </CardContent></Card>
        </div>

        {/* Improvements */}
        {improvements.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-green-500" />改善点
            </h4>
            <div className="flex flex-wrap gap-2">
              {improvements.map((item, i) => (
                <Badge key={i} className="bg-green-500/20 text-green-600 border-green-500/30">
                  {item.label} +{item.change}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Deteriorations */}
        {deteriorations.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
              <TrendingDown className="h-4 w-4 text-red-500" />要改善
            </h4>
            <div className="flex flex-wrap gap-2">
              {deteriorations.map((item, i) => (
                <Badge key={i} className="bg-red-500/20 text-red-600 border-red-500/30">
                  {item.label} {item.change}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2">おすすめアクション</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {recommendations.map((rec, i) => (
                <Card key={i}>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className={PRIORITY_COLORS[rec.priority] || PRIORITY_COLORS.medium}>
                        {PRIORITY_LABELS[rec.priority] || "中"}
                      </Badge>
                      <span className="font-medium text-sm">{rec.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{rec.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <CalendarRange className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">週次レビュー</h1>
            <p className="text-muted-foreground text-sm">毎週の振り返りと改善レポート</p>
          </div>
        </div>

        <Tabs defaultValue="current" className="space-y-4">
          <TabsList>
            <TabsTrigger value="current" className="gap-1.5"><Sparkles className="h-4 w-4" />今週のレビュー</TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5"><BarChart3 className="h-4 w-4" />履歴</TabsTrigger>
          </TabsList>

          {/* Tab 1: 今週のレビュー */}
          <TabsContent value="current" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">レビュー生成</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Select value={weekOffset} onValueChange={setWeekOffset}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEK_OFFSETS.map((w) => (
                        <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={handleGenerate} disabled={generateReview.isPending} className="gap-2">
                    {generateReview.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {generateReview.isPending ? "生成中..." : "レビュー生成"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {latestReview && (
              <>
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">
                        {latestReview.weekStart && latestReview.weekEnd
                          ? `${new Date(latestReview.weekStart).toLocaleDateString("ja-JP")} - ${new Date(latestReview.weekEnd).toLocaleDateString("ja-JP")}`
                          : "今週のレビュー"}
                      </CardTitle>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => sendEmail.mutate({ weekStart: latestReview.weekStart })}
                        disabled={sendEmail.isPending}
                        className="gap-1.5"
                      >
                        {sendEmail.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                        メール送信
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {renderReviewDetail(latestReview)}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* Tab 2: 履歴 */}
          <TabsContent value="history" className="space-y-4">
            {trendData.length >= 2 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">トレンド</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="left" />
                        <YAxis yAxisId="right" orientation="right" domain={[0, 100]} />
                        <Tooltip />
                        <Legend />
                        <Line yAxisId="left" type="monotone" dataKey="matchingCount" name="マッチング数" stroke="#6366f1" strokeWidth={2} />
                        <Line yAxisId="right" type="monotone" dataKey="avgScore" name="平均スコア" stroke="#10b981" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {reviews.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-muted-foreground">
                まだレビュー履歴がありません
              </CardContent></Card>
            ) : (
              reviews.map((review: any) => {
                const isExpanded = expandedReviewId === String(review.id);
                return (
                  <Card
                    key={review.id}
                    className="cursor-pointer"
                    onClick={() => setExpandedReviewId(isExpanded ? null : String(review.id))}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">
                          {review.weekStart && review.weekEnd
                            ? `${new Date(review.weekStart).toLocaleDateString("ja-JP")} - ${new Date(review.weekEnd).toLocaleDateString("ja-JP")}`
                            : `レビュー #${review.id}`}
                        </CardTitle>
                        <span className="text-xs text-muted-foreground">
                          {review.createdAt ? new Date(review.createdAt).toLocaleDateString("ja-JP") : ""}
                        </span>
                      </div>
                      {!isExpanded && review.summary && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{review.summary}</p>
                      )}
                    </CardHeader>
                    {isExpanded && (
                      <CardContent className="pt-0">
                        {renderReviewDetail(review as WeeklyReviewData)}
                      </CardContent>
                    )}
                  </Card>
                );
              })
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
