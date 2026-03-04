import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import {
  Heart, Users, Eye, Activity, ArrowRight,
  TrendingUp, TrendingDown, Loader2, RefreshCw,
  Target, BarChart3, AlertTriangle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// ===== Waveform Comparison SVG =====
function WaveformComparisonChart({
  selfWaveform,
  othersWaveform,
  gap,
  evaluators,
}: {
  selfWaveform: { virtue: number; mine: number; responseCount?: number } | null;
  othersWaveform: { virtue: number; mine: number } | null;
  gap: { virtueGap: number; mineGap: number; totalGap: number; gapLevel: string; gapLabel: string } | null;
  evaluators: Array<{ twinId: number; name: string; avgVirtue: number; avgMine: number; evalCount: number }>;
}) {
  const w = 500, h = 320;
  const pad = { top: 40, right: 30, bottom: 50, left: 60 };
  const gw = w - pad.left - pad.right;
  const gh = h - pad.top - pad.bottom;

  const selfV = selfWaveform?.virtue ?? 50;
  const selfM = selfWaveform?.mine ?? 50;
  const otherV = othersWaveform?.virtue ?? 50;
  const otherM = othersWaveform?.mine ?? 50;

  // Dimensions: Virtue and Mine on radar-like dual-bar
  const dims = [
    { label: "徳 (Virtue)", self: selfV, other: otherV, color: "#22c55e" },
    { label: "地雷 (Mine)", self: selfM, other: otherM, color: "#ef4444" },
  ];

  // Add per-evaluator bars if available
  const allBars = evaluators.length > 0
    ? evaluators.map(e => ({ label: e.name.slice(0, 8), virtue: e.avgVirtue, mine: e.avgMine }))
    : [];

  const barCount = 2 + allBars.length; // self + others-avg + evaluators
  const barWidth = Math.min(50, gw / (barCount * 2 + 1));
  const groupWidth = barWidth * 2 + 8;

  return (
    <div className="space-y-4">
      {/* Main Dual-Axis Bar Chart */}
      <svg width={w} height={h} className="w-full" viewBox={`0 0 ${w} ${h}`}>
        <defs>
          <linearGradient id="selfGrad" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="otherGrad" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.9" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map(v => {
          const y = pad.top + gh - (v / 100) * gh;
          return (
            <g key={v}>
              <line x1={pad.left} y1={y} x2={w - pad.right} y2={y}
                stroke="currentColor" strokeOpacity={0.1} strokeDasharray={v === 0 ? "0" : "4,4"} />
              <text x={pad.left - 8} y={y} textAnchor="end" dominantBaseline="middle"
                className="text-[10px] fill-muted-foreground">{v}</text>
            </g>
          );
        })}

        {/* Virtue bars */}
        <g transform={`translate(${pad.left + gw * 0.25 - groupWidth / 2}, 0)`}>
          {/* Self */}
          <rect x={0} y={pad.top + gh - (selfV / 100) * gh} width={barWidth} height={(selfV / 100) * gh}
            fill="url(#selfGrad)" rx={4} />
          <text x={barWidth / 2} y={pad.top + gh - (selfV / 100) * gh - 6}
            textAnchor="middle" className="text-[10px] fill-indigo-400 font-bold">{selfV}</text>
          {/* Others */}
          <rect x={barWidth + 8} y={pad.top + gh - (otherV / 100) * gh} width={barWidth} height={(otherV / 100) * gh}
            fill="url(#otherGrad)" rx={4} />
          <text x={barWidth + 8 + barWidth / 2} y={pad.top + gh - (otherV / 100) * gh - 6}
            textAnchor="middle" className="text-[10px] fill-amber-400 font-bold">{otherV}</text>
          {/* Label */}
          <text x={groupWidth / 2} y={h - pad.bottom + 18}
            textAnchor="middle" className="text-[11px] fill-green-500 font-medium">徳 (Virtue)</text>
        </g>

        {/* Mine bars */}
        <g transform={`translate(${pad.left + gw * 0.75 - groupWidth / 2}, 0)`}>
          <rect x={0} y={pad.top + gh - (selfM / 100) * gh} width={barWidth} height={(selfM / 100) * gh}
            fill="url(#selfGrad)" rx={4} />
          <text x={barWidth / 2} y={pad.top + gh - (selfM / 100) * gh - 6}
            textAnchor="middle" className="text-[10px] fill-indigo-400 font-bold">{selfM}</text>
          <rect x={barWidth + 8} y={pad.top + gh - (otherM / 100) * gh} width={barWidth} height={(otherM / 100) * gh}
            fill="url(#otherGrad)" rx={4} />
          <text x={barWidth + 8 + barWidth / 2} y={pad.top + gh - (otherM / 100) * gh - 6}
            textAnchor="middle" className="text-[10px] fill-amber-400 font-bold">{otherM}</text>
          <text x={groupWidth / 2} y={h - pad.bottom + 18}
            textAnchor="middle" className="text-[11px] fill-red-500 font-medium">地雷 (Mine)</text>
        </g>

        {/* Gap arrows */}
        {gap && (
          <>
            {/* Virtue gap line */}
            <line x1={pad.left + gw * 0.25 + groupWidth + 10} y1={pad.top + gh - (selfV / 100) * gh}
              x2={pad.left + gw * 0.25 + groupWidth + 10} y2={pad.top + gh - (otherV / 100) * gh}
              stroke="#f97316" strokeWidth={2} strokeDasharray="4,2" />
            {Math.abs(gap.virtueGap) > 5 && (
              <text x={pad.left + gw * 0.25 + groupWidth + 18}
                y={(pad.top + gh - (selfV / 100) * gh + pad.top + gh - (otherV / 100) * gh) / 2}
                className="text-[9px] fill-orange-400 font-bold" dominantBaseline="middle">
                {gap.virtueGap > 0 ? "+" : ""}{gap.virtueGap}
              </text>
            )}
          </>
        )}

        {/* Legend */}
        <rect x={w - pad.right - 120} y={pad.top - 28} width={10} height={10} fill="#6366f1" rx={2} />
        <text x={w - pad.right - 106} y={pad.top - 20} className="text-[10px] fill-muted-foreground">自己申告</text>
        <rect x={w - pad.right - 55} y={pad.top - 28} width={10} height={10} fill="#f59e0b" rx={2} />
        <text x={w - pad.right - 41} y={pad.top - 20} className="text-[10px] fill-muted-foreground">他者視点</text>
      </svg>

      {/* Per-evaluator mini bars */}
      {allBars.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">各友達の分身AIからの評価</p>
          <div className="grid gap-2">
            {allBars.map((bar, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="w-16 truncate text-muted-foreground">{bar.label}</span>
                <div className="flex-1 flex gap-1 items-center">
                  <span className="text-green-500 w-6 text-right">{bar.virtue}</span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden flex">
                    <div className="bg-green-500/60 h-full" style={{ width: `${bar.virtue}%` }} />
                  </div>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden flex">
                    <div className="bg-red-500/60 h-full" style={{ width: `${bar.mine}%` }} />
                  </div>
                  <span className="text-red-500 w-6">{bar.mine}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Gap Visualization =====
function GapVisualization({ gap }: {
  gap: { virtueGap: number; mineGap: number; totalGap: number; gapLevel: string; gapLabel: string } | null;
}) {
  if (!gap) return (
    <div className="text-center py-6 text-muted-foreground text-sm">
      <Eye className="h-8 w-8 mx-auto mb-2 opacity-50" />
      <p>他者視点の波形データがまだありません</p>
      <p className="text-xs mt-1">友達の分身AIからの予測を集めると、自己認識ギャップが計算されます</p>
    </div>
  );

  const gapColor = gap.gapLevel === "excellent" ? "text-green-500" :
    gap.gapLevel === "good" ? "text-blue-500" :
    gap.gapLevel === "moderate" ? "text-amber-500" : "text-red-500";

  const gapBg = gap.gapLevel === "excellent" ? "bg-green-500/10 border-green-500/30" :
    gap.gapLevel === "good" ? "bg-blue-500/10 border-blue-500/30" :
    gap.gapLevel === "moderate" ? "bg-amber-500/10 border-amber-500/30" : "bg-red-500/10 border-red-500/30";

  return (
    <div className="space-y-4">
      <div className={`p-4 rounded-lg border ${gapBg}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">自己認識ギャップ</span>
          <Badge variant="outline" className={gapColor}>{gap.gapLabel}</Badge>
        </div>
        <div className="text-3xl font-bold text-center my-2">
          <span className={gapColor}>{gap.totalGap}</span>
          <span className="text-sm text-muted-foreground ml-1">/ 200</span>
        </div>
        <Progress value={Math.max(0, 100 - gap.totalGap / 2)} className="h-2" />
        <p className="text-xs text-muted-foreground mt-2 text-center">
          {gap.totalGap < 10 ? "あなたの自己認識は他者の評価と非常に一致しています" :
           gap.totalGap < 25 ? "自己認識と他者の評価がよく一致しています" :
           gap.totalGap < 50 ? "自己認識と他者の評価にやや差があります" :
           "自己認識と他者の評価に大きな差があります。新たな視点を得るチャンスです"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-muted/30">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-green-500" />
            <span className="text-xs font-medium">徳のギャップ</span>
          </div>
          <p className="text-lg font-bold">
            {gap.virtueGap > 0 ? "+" : ""}{gap.virtueGap}
          </p>
          <p className="text-xs text-muted-foreground">
            {gap.virtueGap > 10 ? "自己評価が他者より高め" :
             gap.virtueGap < -10 ? "他者の方が高く評価" : "ほぼ一致"}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-muted/30">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="h-4 w-4 text-red-500" />
            <span className="text-xs font-medium">地雷のギャップ</span>
          </div>
          <p className="text-lg font-bold">
            {gap.mineGap > 0 ? "+" : ""}{gap.mineGap}
          </p>
          <p className="text-xs text-muted-foreground">
            {gap.mineGap > 10 ? "自己評価が他者より高め" :
             gap.mineGap < -10 ? "他者の方が高く評価" : "ほぼ一致"}
          </p>
        </div>
      </div>
    </div>
  );
}

// ===== Friend Intimacy Card =====
function FriendIntimacyCard({ friend, onRefresh }: {
  friend: any;
  onRefresh: (friendId: number) => void;
}) {
  const levelColors: Record<string, string> = {
    stranger: "bg-gray-500/10 text-gray-500",
    acquaintance: "bg-blue-500/10 text-blue-500",
    friend: "bg-green-500/10 text-green-500",
    close_friend: "bg-purple-500/10 text-purple-500",
    best_friend: "bg-amber-500/10 text-amber-500",
  };

  return (
    <Card className="hover:border-primary/30 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold">
              {friend.friendName?.charAt(0) || "?"}
            </div>
            <div>
              <p className="text-sm font-medium">{friend.friendName}</p>
              {friend.twinName && <p className="text-xs text-muted-foreground">{friend.twinName}</p>}
            </div>
          </div>
          <Badge className={levelColors[friend.intimacyLevel] || levelColors.stranger}>
            {friend.intimacyLevelLabel}
          </Badge>
        </div>

        {/* Intimacy Score Bar */}
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">親密度</span>
            <span className="font-bold">{friend.intimacyScore}%</span>
          </div>
          <Progress value={friend.intimacyScore} className="h-2" />
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="p-1.5 rounded bg-muted/30">
            <p className="text-muted-foreground">会話量</p>
            <p className="font-medium">{friend.totalMessageCount}</p>
          </div>
          <div className="p-1.5 rounded bg-muted/30">
            <p className="text-muted-foreground">予測数</p>
            <p className="font-medium">{friend.totalPredictions}</p>
          </div>
          <div className="p-1.5 rounded bg-muted/30">
            <p className="text-muted-foreground">的中率</p>
            <p className="font-medium">{friend.predictionAccuracy != null ? `${friend.predictionAccuracy}%` : "-"}</p>
          </div>
        </div>

        {/* Gap indicator */}
        {friend.gap && (
          <div className="mt-3 flex items-center gap-2 text-xs">
            {Math.abs(friend.gap.virtueGap) + Math.abs(friend.gap.mineGap) > 30 ? (
              <AlertTriangle className="h-3 w-3 text-amber-500" />
            ) : (
              <Target className="h-3 w-3 text-green-500" />
            )}
            <span className="text-muted-foreground">
              認識ギャップ: 徳{friend.gap.virtueGap > 0 ? "+" : ""}{friend.gap.virtueGap} / 地雷{friend.gap.mineGap > 0 ? "+" : ""}{friend.gap.mineGap}
            </span>
          </div>
        )}

        <Button variant="ghost" size="sm" className="w-full mt-2 text-xs gap-1" onClick={() => onRefresh(friend.friendId)}>
          <RefreshCw className="h-3 w-3" />
          予測を更新
        </Button>
      </CardContent>
    </Card>
  );
}

// ===== Main Page =====
export default function Intimacy() {
  const { t } = useTranslation();
  usePageMeta({ title: t("intimacy.title"), description: t("intimacy.description"), path: "/intimacy" });
  const [refreshingFriend, setRefreshingFriend] = useState<number | null>(null);

  const { data: comparison, isLoading: compLoading } = trpc.friends.getWaveformComparison.useQuery();
  const { data: dashboard, isLoading: dashLoading, refetch: refetchDashboard } = trpc.friends.getIntimacyDashboard.useQuery();

  const compareMut = trpc.friends.comparePredictions.useMutation({
    onSuccess: (data) => {
      toast.success(`予測結果を更新しました（的中率: ${data.accuracy}%）`);
      refetchDashboard();
      setRefreshingFriend(null);
    },
    onError: () => {
      toast.error("更新に失敗しました");
      setRefreshingFriend(null);
    },
  });

  const evaluateAllMut = trpc.myTwin.evaluateByAllTwins.useMutation({
    onSuccess: (data: any) => {
      toast.success(`${data.totalEvaluations}件の予測を生成しました`);
      refetchDashboard();
    },
    onError: () => toast.error("予測生成に失敗しました"),
  });

  const handleRefreshFriend = (friendId: number) => {
    setRefreshingFriend(friendId);
    compareMut.mutate({ friendUserId: friendId });
  };

  const isLoading = compLoading || dashLoading;

  if (isLoading) {
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
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Heart className="h-6 w-6 text-pink-500" />
            {t("intimacy.title")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("intimacy.description")}
          </p>
        </div>

        {/* Waveform Comparison */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              波形比較：自己申告 vs 他者視点
            </CardTitle>
            <CardDescription>
              あなたの自己申告波形と、友達の分身AIによる評価を並べて比較
            </CardDescription>
          </CardHeader>
          <CardContent>
            {comparison?.hasSelf ? (
              <WaveformComparisonChart
                selfWaveform={comparison.selfWaveform}
                othersWaveform={comparison.othersWaveform ? { virtue: comparison.othersWaveform.virtue, mine: comparison.othersWaveform.mine ?? 50 } : null}
                gap={comparison.gap}
                evaluators={comparison.evaluators}
              />
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Activity className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">自己申告波形がまだ生成されていません</p>
                <p className="text-xs mt-1">価値観シナリオインタビューに回答して波形を生成してください</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Gap Visualization */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  {t("intimacy.gap")}
                </CardTitle>
                <CardDescription>
                  自分が思う自分と、友達から見た自分のズレを可視化
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => evaluateAllMut.mutate()}
                disabled={evaluateAllMut.isPending}
                className="gap-1"
              >
                {evaluateAllMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                全友達から予測
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <GapVisualization gap={comparison?.gap ?? null} />
          </CardContent>
        </Card>

        {/* Friends Intimacy Grid */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Users className="h-5 w-5" />
              {t("intimacy.score")}
            </h2>
            {dashboard?.friends && dashboard.friends.length > 0 && (
              <Badge variant="secondary">{dashboard.friends.length}人</Badge>
            )}
          </div>

          {dashboard?.friends && dashboard.friends.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {dashboard.friends.map((friend: any) => (
                <FriendIntimacyCard
                  key={friend.friendId}
                  friend={friend}
                  onRefresh={handleRefreshFriend}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">{t("intimacy.noData")}</p>
                <p className="text-xs mt-1">{t("intimacy.noDataDesc")}</p>
                <a href="/friends">
                  <Button variant="outline" size="sm" className="mt-3 gap-1">
                    友達を追加 <ArrowRight className="h-3 w-3" />
                  </Button>
                </a>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
