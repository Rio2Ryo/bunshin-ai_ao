import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Crown, ArrowRight, Sparkles, Bell, Loader2, Pencil, RotateCcw, Eye, EyeOff, GripVertical, CheckCircle } from "lucide-react";
import { useDashboardLayout, type WidgetId } from "@/hooks/useDashboardLayout";
import { lazy, Suspense, useCallback, useRef, useState } from "react";

const KpiWidget = lazy(() => import("@/components/widgets/KpiWidget").then(m => ({ default: m.KpiWidget })));
const RecentMatchingsWidget = lazy(() => import("@/components/widgets/RecentMatchingsWidget").then(m => ({ default: m.RecentMatchingsWidget })));
const FriendsListWidget = lazy(() => import("@/components/widgets/FriendsListWidget").then(m => ({ default: m.FriendsListWidget })));
const TwinStatusWidget = lazy(() => import("@/components/widgets/TwinStatusWidget").then(m => ({ default: m.TwinStatusWidget })));
const NotificationsWidget = lazy(() => import("@/components/widgets/NotificationsWidget").then(m => ({ default: m.NotificationsWidget })));
const QuickActionsWidget = lazy(() => import("@/components/widgets/QuickActionsWidget").then(m => ({ default: m.QuickActionsWidget })));
const AnalyticsWidget = lazy(() => import("@/components/widgets/AnalyticsWidget").then(m => ({ default: m.AnalyticsWidget })));
const BriefingWidget = lazy(() => import("@/components/widgets/BriefingWidget").then(m => ({ default: m.BriefingWidget })));
const QualityTrendWidget = lazy(() => import("@/components/widgets/QualityTrendWidget").then(m => ({ default: m.QualityTrendWidget })));
const BookmarksWidget = lazy(() => import("@/components/widgets/BookmarksWidget").then(m => ({ default: m.BookmarksWidget })));

const WIDGET_COMPONENTS: Record<WidgetId, { component: React.FC; label: string }> = {
  kpi: { component: KpiWidget, label: "KPI" },
  recentMatchings: { component: RecentMatchingsWidget, label: "最近のマッチング" },
  friendsList: { component: FriendsListWidget, label: "友達" },
  twinStatus: { component: TwinStatusWidget, label: "分身AI" },
  notifications: { component: NotificationsWidget, label: "通知" },
  quickActions: { component: QuickActionsWidget, label: "クイックアクション" },
  analytics: { component: AnalyticsWidget, label: "アクティビティ" },
  briefing: { component: BriefingWidget, label: "ブリーフィング" },
  qualityTrend: { component: QualityTrendWidget, label: "品質トレンド" },
  bookmarks: { component: BookmarksWidget, label: "ブックマーク" },
};

export default function Dashboard() {
  const { user } = useAuth();
  usePageMeta({ title: "ダッシュボード", description: "分身AIの管理、チャット、マッチングの概要を確認しましょう。", path: "/dashboard" });
  const { data: planInfo } = trpc.plan.getInfo.useQuery();
  const { data: profile } = trpc.profile.get.useQuery(undefined, { staleTime: 60_000 });
  const { data: receivedRequests } = trpc.matching.receivedRequests.useQuery(undefined, { staleTime: 15_000 });
  const { data: myTwin, isLoading: twinLoading } = trpc.myTwin.get.useQuery(undefined, { staleTime: 30_000 });
  const { data: trustData, isLoading: trustLoading } = trpc.trust.getScore.useQuery(undefined, { staleTime: 60_000 });
  const { data: matchingSessions } = trpc.matching.sessions.useQuery(undefined, { staleTime: 30_000 });
  const pendingRequestCount = receivedRequests?.length ?? 0;
  const me = user as any;
  const tutorialDone = me?.tutorialCompleted === 1;
  const hasNpcSessions = matchingSessions?.some((s: any) => s.isNpcSession);

  const { layout, isEditing, setIsEditing, toggleWidget, resetLayout, swapWidgets } = useDashboardLayout();
  const [draggedWidget, setDraggedWidget] = useState<WidgetId | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, id: WidgetId) => {
    setDraggedWidget(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, dropId: WidgetId) => {
    e.preventDefault();
    const dragId = e.dataTransfer.getData("text/plain") as WidgetId;
    if (dragId && dragId !== dropId) {
      swapWidgets(dragId, dropId);
    }
    setDraggedWidget(null);
  }, [swapWidgets]);

  // Profile completion
  const profileFields = [
    { key: "displayName", label: "表示名", filled: !!profile?.displayName },
    { key: "bio", label: "自己紹介", filled: !!profile?.bio },
    { key: "company", label: "会社名", filled: !!profile?.company },
    { key: "industry", label: "業種", filled: !!profile?.industry },
    { key: "position", label: "役職", filled: !!profile?.position },
    { key: "skills", label: "スキル", filled: !!(profile?.skills && profile.skills.length > 0) },
    { key: "expertise", label: "専門分野", filled: !!(profile?.expertise && profile.expertise.length > 0) },
    { key: "experience", label: "経歴", filled: !!profile?.experience },
  ];
  const filledCount = profileFields.filter(f => f.filled).length;
  const completionPct = Math.round((filledCount / profileFields.length) * 100);

  if (twinLoading && trustLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  const visibleWidgets = layout.filter(w => w.visible).sort((a, b) => a.y === b.y ? a.x - b.x : a.y - b.y);
  const hiddenWidgets = layout.filter(w => !w.visible);

  return (
    <DashboardLayout>
      <div className="space-y-6" role="main" aria-label="ダッシュボード">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              おかえりなさい、<span className="text-gradient">{user?.name || "ユーザー"}</span>さん
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              分身AIの管理とビジネスマッチングを始めましょう
            </p>
          </div>
          <div className="flex items-center gap-2">
            {planInfo && (
              <Link href="/plan">
                <Badge variant={planInfo.plan === "free" ? "secondary" : "default"} className="cursor-pointer">
                  <Crown className="h-3 w-3 mr-1" />
                  {planInfo.plan === "free" ? "フリー" : planInfo.plan === "premium" ? "プレミアム" : "エンタープライズ"}
                </Badge>
              </Link>
            )}
            <Button
              variant={isEditing ? "default" : "outline"}
              size="sm"
              onClick={() => setIsEditing(!isEditing)}
              className="gap-1"
            >
              <Pencil className="h-3.5 w-3.5" />
              {isEditing ? "完了" : "編集"}
            </Button>
          </div>
        </div>

        {/* Edit mode toolbar */}
        {isEditing && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">レイアウト編集中</span>
                <span className="text-xs text-muted-foreground">ウィジェットをドラッグして並べ替え</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={resetLayout} className="gap-1">
                  <RotateCcw className="h-3 w-3" />
                  リセット
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Hidden widgets palette (edit mode) */}
        {isEditing && hiddenWidgets.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {hiddenWidgets.map(w => (
              <Button
                key={w.id}
                variant="outline"
                size="sm"
                onClick={() => toggleWidget(w.id)}
                className="gap-1"
              >
                <Eye className="h-3 w-3" />
                {WIDGET_COMPONENTS[w.id]?.label}
              </Button>
            ))}
          </div>
        )}

        {/* First-time user guide */}
        {!tutorialDone && myTwin && (
          <Card className="border-primary/50 bg-primary/5">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm mb-1">次のステップ</p>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      {hasNpcSessions ? <CheckCircle className="h-4 w-4 text-green-500 shrink-0" /> : <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />}
                      <span className={hasNpcSessions ? "line-through" : ""}>ガイドキャラクターとの練習マッチング</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                      <span>マッチング結果を確認してチュートリアル完了</span>
                    </div>
                  </div>
                  <Link href="/matching">
                    <Button size="sm" className="mt-3 gap-1">
                      マッチングページへ
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Pending Requests */}
        {pendingRequestCount > 0 && (
          <Card className="border-orange-500/50 bg-orange-500/5">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0">
                  <Bell className="h-5 w-5 text-orange-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">マッチングリクエストが{pendingRequestCount}件届いています</p>
                  <p className="text-xs text-muted-foreground mt-0.5">リクエストを確認して承認しましょう</p>
                </div>
                <Link href="/matching">
                  <Button size="sm" variant="outline" className="gap-1 shrink-0">
                    確認する
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Profile Completion */}
        {profile && completionPct < 100 && (
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">プロフィール完成度</span>
                <span className="text-sm font-bold text-primary">{completionPct}%</span>
              </div>
              <Progress value={completionPct} className="h-2 mb-3" />
              <div className="flex flex-wrap gap-1.5">
                {profileFields.filter(f => !f.filled).slice(0, 4).map(f => (
                  <Badge key={f.key} variant="outline" className="text-xs text-muted-foreground">{f.label}</Badge>
                ))}
              </div>
              <Link href="/profile">
                <Button variant="ghost" size="sm" className="mt-2 text-xs gap-1 p-0 h-auto">
                  プロフィールを編集 <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Widget Grid */}
        <Suspense fallback={<div className="animate-pulse h-32 bg-muted rounded-lg" />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visibleWidgets.map(widgetLayout => {
              const config = WIDGET_COMPONENTS[widgetLayout.id];
              if (!config) return null;
              const WidgetComponent = config.component;
              const isFullWidth = widgetLayout.w >= 12;
              const isDragging = draggedWidget === widgetLayout.id;

              return (
                <div
                  key={widgetLayout.id}
                  className={`${isFullWidth ? "md:col-span-2" : ""} ${isDragging ? "opacity-50" : ""} ${isEditing ? "relative group" : ""}`}
                  draggable={isEditing}
                  onDragStart={(e) => handleDragStart(e, widgetLayout.id)}
                  onDragOver={isEditing ? handleDragOver : undefined}
                  onDrop={isEditing ? (e) => handleDrop(e, widgetLayout.id) : undefined}
                >
                  {isEditing && (
                    <div className="absolute -top-2 -right-2 z-10 flex items-center gap-1">
                      <button
                        onClick={() => toggleWidget(widgetLayout.id)}
                        className="h-6 w-6 rounded-full bg-destructive/90 text-white flex items-center justify-center hover:bg-destructive text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label={`${config.label}ウィジェットを非表示`}
                      >
                        <EyeOff className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  {isEditing && (
                    <div
                      className="absolute top-2 left-2 z-10 cursor-grab active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring rounded"
                      tabIndex={0}
                      role="button"
                      aria-label={`${config.label}ウィジェットを移動（矢印キーで並べ替え）`}
                      aria-roledescription="ドラッグハンドル"
                      onKeyDown={(e) => {
                        const idx = visibleWidgets.findIndex(w => w.id === widgetLayout.id);
                        if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                          e.preventDefault();
                          if (idx > 0) swapWidgets(widgetLayout.id, visibleWidgets[idx - 1].id);
                        } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                          e.preventDefault();
                          if (idx < visibleWidgets.length - 1) swapWidgets(widgetLayout.id, visibleWidgets[idx + 1].id);
                        }
                      }}
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    </div>
                  )}
                  <WidgetComponent />
                </div>
              );
            })}
          </div>
        </Suspense>

        {/* Login Streak */}
        {(me?.loginStreak ?? 0) > 1 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-lg px-4 py-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <span>{me.loginStreak}日連続ログイン中</span>
            {me.loginStreak >= 7 && <Badge variant="default" className="text-[10px]">ストリーク</Badge>}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
