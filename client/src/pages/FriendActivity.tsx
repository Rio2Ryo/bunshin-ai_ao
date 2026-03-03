import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Activity, Users, Zap, Trophy, Bot, UserPlus, Swords, Flame, FileText, ChevronDown, BarChart3 } from "lucide-react";

const ACTIVITY_TYPES = [
  { value: "all", label: "すべて" },
  { value: "matching_complete", label: "マッチング完了", icon: Zap, color: "bg-blue-500" },
  { value: "twin_update", label: "ツイン更新", icon: Bot, color: "bg-purple-500" },
  { value: "template_publish", label: "テンプレート公開", icon: FileText, color: "bg-green-500" },
  { value: "challenge_join", label: "チャレンジ参加", icon: Trophy, color: "bg-yellow-500" },
  { value: "achievement_unlock", label: "アチーブメント", icon: Trophy, color: "bg-orange-500" },
  { value: "friend_add", label: "友達追加", icon: UserPlus, color: "bg-pink-500" },
  { value: "scenario_publish", label: "シナリオ公開", icon: FileText, color: "bg-teal-500" },
  { value: "negotiation_complete", label: "ネゴ練習完了", icon: Swords, color: "bg-red-500" },
  { value: "streak_milestone", label: "ストリーク達成", icon: Flame, color: "bg-amber-500" },
];

function getActivityConfig(type: string) {
  return ACTIVITY_TYPES.find(t => t.value === type) || ACTIVITY_TYPES[0];
}

function formatTimeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}日前`;
  return date.toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
}

export default function FriendActivity() {
  usePageMeta({ title: "友達アクティビティ", description: "友達の最近のアクティビティを確認" });
  const [filter, setFilter] = useState("all");
  const [limit] = useState(30);
  const [offset, setOffset] = useState(0);

  const activitiesQuery = trpc.friends.listFriendActivities.useQuery({
    limit,
    offset,
    ...(filter !== "all" ? { activityType: filter } : {}),
  });

  const statsQuery = trpc.friends.getActivityStats.useQuery();

  const activities = activitiesQuery.data?.activities || [];
  const total = activitiesQuery.data?.total || 0;
  const hasMore = activitiesQuery.data?.hasMore || false;
  const stats = statsQuery.data;

  return (
    <DashboardLayout>
      <div className="container mx-auto py-6 px-4 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6" />
              友達アクティビティ
            </h1>
            <p className="text-muted-foreground text-sm mt-1">友達の最近の活動をリアルタイムで確認</p>
          </div>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold">{stats.totalThisWeek}</div>
                <div className="text-xs text-muted-foreground">今週のアクティビティ</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold">{Object.keys(stats.byType || {}).length}</div>
                <div className="text-xs text-muted-foreground">アクティブな種類</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold">{total}</div>
                <div className="text-xs text-muted-foreground">合計アクティビティ</div>
              </CardContent>
            </Card>
            {stats.mostActiveFriend && (
              <Card>
                <CardContent className="p-4">
                  <div className="text-sm font-bold truncate">{stats.mostActiveFriend.name}</div>
                  <div className="text-xs text-muted-foreground">最もアクティブな友達 ({stats.mostActiveFriend.count}件)</div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Filter */}
        <div className="flex items-center gap-3">
          <Select value={filter} onValueChange={(v) => { setFilter(v); setOffset(0); }}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="フィルタ" />
            </SelectTrigger>
            <SelectContent>
              {ACTIVITY_TYPES.map(t => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{total}件</span>
        </div>

        {/* Timeline */}
        {activitiesQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : activities.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>友達のアクティビティはまだありません</p>
              <p className="text-xs mt-1">友達がマッチングやツイン更新を行うとここに表示されます</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1">
            {activities.map((act: any) => {
              const config = getActivityConfig(act.activityType);
              const Icon = config.icon || Activity;
              return (
                <div key={act.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="relative mt-0.5">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={act.avatarUrl} />
                      <AvatarFallback className="text-xs">{(act.userName || "?")[0]}</AvatarFallback>
                    </Avatar>
                    <div className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full flex items-center justify-center ${config.color || "bg-gray-500"}`}>
                      <Icon className="h-2.5 w-2.5 text-white" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{act.userName}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">{config.label}</Badge>
                      <span className="text-xs text-muted-foreground ml-auto shrink-0">{formatTimeAgo(act.createdAt)}</span>
                    </div>
                    <p className="text-sm mt-0.5">{act.title}</p>
                    {act.description && <p className="text-xs text-muted-foreground mt-0.5">{act.description}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset(o => o + limit)}
              disabled={activitiesQuery.isFetching}
            >
              {activitiesQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ChevronDown className="h-4 w-4 mr-2" />}
              もっと読み込む
            </Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
