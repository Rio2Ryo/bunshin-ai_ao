import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Shield, TrendingUp, TrendingDown, Clock, MessageSquare, Users, UserCheck, Star, LogIn, Award } from "lucide-react";
import { Loader2 } from "lucide-react";

const RANK_CONFIG = {
  bronze: { label: "Bronze", color: "text-amber-600", bg: "bg-amber-500/20", border: "border-amber-500/30", min: 0, max: 29 },
  silver: { label: "Silver", color: "text-gray-400", bg: "bg-gray-400/20", border: "border-gray-400/30", min: 30, max: 59 },
  gold: { label: "Gold", color: "text-yellow-400", bg: "bg-yellow-400/20", border: "border-yellow-400/30", min: 60, max: 84 },
  platinum: { label: "Platinum", color: "text-cyan-300", bg: "bg-cyan-300/20", border: "border-cyan-300/30", min: 85, max: 100 },
} as const;

const ACTION_INFO = [
  { action: "register", label: "アカウント作成", points: "+5", icon: Star },
  { action: "daily_login", label: "デイリーログイン", points: "+2/日", icon: LogIn },
  { action: "chat_conversation", label: "会話を継続（5メッセージごと）", points: "+2", icon: MessageSquare },
  { action: "profile_complete", label: "プロフィール充実", points: "+10", icon: UserCheck },
  { action: "onboarding_complete", label: "オンボーディング完了", points: "+10", icon: Award },
  { action: "matching_complete", label: "マッチング成功", points: "+5", icon: Users },
];

function getActionIcon(action: string) {
  const info = ACTION_INFO.find(a => a.action === action);
  return info?.icon || Star;
}

function getActionLabel(action: string) {
  const info = ACTION_INFO.find(a => a.action === action);
  return info?.label || action;
}

export default function TrustScore() {
  usePageMeta({ title: "信頼度スコア", description: "あなたの信頼度スコアの詳細と変動履歴を確認できます。", path: "/trust" });

  const { data: trustData, isLoading: trustLoading } = trpc.trust.getScore.useQuery();
  const { data: history, isLoading: historyLoading } = trpc.trust.getHistory.useQuery({ limit: 50 });

  const score = trustData?.score ?? 0;
  const rank = (trustData?.rank ?? "bronze") as keyof typeof RANK_CONFIG;
  const rankInfo = RANK_CONFIG[rank] || RANK_CONFIG.bronze;

  // Find next rank
  const rankOrder = ["bronze", "silver", "gold", "platinum"] as const;
  const currentIdx = rankOrder.indexOf(rank);
  const nextRank = currentIdx < rankOrder.length - 1 ? rankOrder[currentIdx + 1] : null;
  const nextRankInfo = nextRank ? RANK_CONFIG[nextRank] : null;
  const progressToNext = nextRankInfo
    ? Math.round(((score - rankInfo.min) / (nextRankInfo.min - rankInfo.min)) * 100)
    : 100;

  if (trustLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Shield className="h-7 w-7 text-primary" />
            信頼度スコア
          </h1>
          <p className="text-muted-foreground mt-2">
            信頼度が高いほど、より多くの機能が使えるようになります
          </p>
        </div>

        {/* Main Score Card */}
        <Card className={`${rankInfo.border} border-2`}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className={`w-20 h-20 rounded-full ${rankInfo.bg} flex items-center justify-center`}>
                  <span className={`text-3xl font-bold ${rankInfo.color}`}>{score}</span>
                </div>
                <div>
                  <Badge className={`${rankInfo.bg} ${rankInfo.color} border ${rankInfo.border} mb-1`}>
                    {rankInfo.label}
                  </Badge>
                  <p className="text-sm text-muted-foreground">/ 100</p>
                </div>
              </div>
              {nextRankInfo && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">次のランク</p>
                  <Badge variant="outline" className={`${nextRankInfo.color}`}>
                    {nextRankInfo.label}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-1">あと {nextRankInfo.min - score} ポイント</p>
                </div>
              )}
            </div>

            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{rankInfo.label} ({rankInfo.min})</span>
                <span>{nextRankInfo ? `${nextRankInfo.label} (${nextRankInfo.min})` : "MAX"}</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${rank === "bronze" ? "bg-amber-500" : rank === "silver" ? "bg-gray-400" : rank === "gold" ? "bg-yellow-400" : "bg-cyan-400"}`}
                  style={{ width: `${Math.min(100, progressToNext)}%` }}
                />
              </div>
            </div>

            {/* Matching threshold indicator */}
            {score < 30 && (
              <div className="mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                <p className="text-sm text-yellow-500 font-medium">
                  マッチング開始には信頼度30以上が必要です（あと {30 - score} ポイント）
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rank overview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ランク一覧</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {rankOrder.map((r) => {
                const ri = RANK_CONFIG[r];
                const isActive = r === rank;
                return (
                  <div key={r} className={`p-3 rounded-lg border ${isActive ? `${ri.border} ${ri.bg}` : "border-muted"}`}>
                    <p className={`font-medium text-sm ${isActive ? ri.color : "text-muted-foreground"}`}>
                      {ri.label}
                    </p>
                    <p className="text-xs text-muted-foreground">{ri.min}~{ri.max}pt</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* How to increase */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">スコアを上げる方法</CardTitle>
            <CardDescription>以下のアクションでスコアが上がります</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {ACTION_INFO.map((info) => {
                const Icon = info.icon;
                return (
                  <div key={info.action} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30">
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 text-sm">{info.label}</span>
                    <Badge variant="secondary" className="text-xs">{info.points}</Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* History */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              変動履歴
            </CardTitle>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : history && history.length > 0 ? (
              <div className="space-y-2">
                {history.map((entry: any) => {
                  const Icon = getActionIcon(entry.action);
                  const isPositive = entry.delta > 0;
                  return (
                    <div key={entry.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/30 transition-colors">
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{entry.description || getActionLabel(entry.action)}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(entry.createdAt).toLocaleDateString("ja-JP", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {isPositive ? (
                          <TrendingUp className="h-3 w-3 text-green-500" />
                        ) : (
                          <TrendingDown className="h-3 w-3 text-red-500" />
                        )}
                        <span className={`text-sm font-medium ${isPositive ? "text-green-500" : "text-red-500"}`}>
                          {isPositive ? "+" : ""}{entry.delta}
                        </span>
                        <span className="text-xs text-muted-foreground ml-1">
                          → {entry.scoreAfter}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">まだ変動履歴がありません</p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
