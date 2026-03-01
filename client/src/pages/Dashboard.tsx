import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import {
  Bot, MessageSquare, Users, FileText, UserPlus,
  Clock, CheckCircle, Crown, Globe, ArrowRight, Shield, Sparkles, Bell, Loader2
} from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();
  usePageMeta({ title: "ダッシュボード", description: "分身AIの管理、チャット、マッチングの概要を確認しましょう。", path: "/dashboard" });
  const { data: myTwin, isLoading: twinLoading } = trpc.myTwin.get.useQuery(undefined, { staleTime: 30_000 });
  const { data: friends } = trpc.friends.list.useQuery(undefined, { staleTime: 30_000 });
  const { data: chatSessions } = trpc.chat.sessions.useQuery(undefined, { staleTime: 30_000 });
  const { data: matchingSessions } = trpc.matching.sessions.useQuery(undefined, { staleTime: 30_000 });
  const { data: planInfo } = trpc.plan.getInfo.useQuery();
  const { data: trustData, isLoading: trustLoading } = trpc.trust.getScore.useQuery(undefined, { staleTime: 60_000 });
  const { data: receivedRequests } = trpc.matching.receivedRequests.useQuery(undefined, { staleTime: 15_000 });
  const { data: profile } = trpc.profile.get.useQuery(undefined, { staleTime: 60_000 });
  const pendingRequestCount = receivedRequests?.length ?? 0;

  const completedMatchings = matchingSessions?.filter(s => s.status === "completed").length || 0;
  const recentMatchings = matchingSessions?.slice(0, 3) || [];
  const me = user as any;
  const tutorialDone = me?.tutorialCompleted === 1;
  const hasNpcSessions = matchingSessions?.some((s: any) => s.isNpcSession);

  // Determine action cards based on user state
  const actionCards: Array<{ title: string; description: string; href: string; icon: React.ElementType; primary?: boolean }> = [];

  if (myTwin && !myTwin.isPublic) {
    actionCards.push({ title: "分身AIを公開しよう", description: "他のユーザーに発見してもらえるようになります", href: "/twins", icon: Globe });
  }
  if (!friends?.length) {
    actionCards.push({ title: "友達を追加しよう", description: "フレンドコードで友達を見つけましょう", href: "/friends", icon: UserPlus });
  }
  if (friends?.length && !matchingSessions?.length) {
    actionCards.push({ title: "マッチングを試そう", description: "友達の分身AIとビジネスマッチング", href: "/matching", icon: Users });
  }
  if (myTwin && chatSessions && chatSessions.length <= 1) {
    actionCards.push({ title: "チャットで会話してみよう", description: "分身AIと会話して育てましょう", href: "/chat", icon: MessageSquare, primary: true });
  }

  // If no specific actions, show default actions
  if (actionCards.length === 0) {
    actionCards.push(
      { title: "チャット", description: "分身AIと会話する", href: "/chat", icon: MessageSquare },
      { title: "マッチング", description: "新しいマッチングを作成", href: "/matching", icon: Users },
    );
  }

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

  return (
    <DashboardLayout>
      <div className="space-y-6" role="main" aria-label="ダッシュボード">
        {/* Welcome Section */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              おかえりなさい、<span className="text-gradient">{user?.name || "ユーザー"}</span>さん
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              分身AIの管理とビジネスマッチングを始めましょう
            </p>
          </div>
          {planInfo && (
            <Link href="/plan">
              <Badge variant={planInfo.plan === "free" ? "secondary" : "default"} className="cursor-pointer">
                <Crown className="h-3 w-3 mr-1" />
                {planInfo.plan === "free" ? "フリー" : planInfo.plan === "premium" ? "プレミアム" : "エンタープライズ"}
              </Badge>
            </Link>
          )}
        </div>

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
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                      <span>実ユーザーとのマッチングを開始</span>
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

        {/* Pending Requests Notification */}
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

        {/* Twin Status Card (compact) */}
        {myTwin && (
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <Bot className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{myTwin.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {myTwin.isPublic ? "公開中" : "非公開"} · {myTwin.description ? myTwin.description.slice(0, 30) + (myTwin.description.length > 30 ? "..." : "") : "プロフィール未設定"}
                    </p>
                  </div>
                </div>
                <Link href="/twins">
                  <Button variant="ghost" size="sm">
                    管理
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" role="list" aria-label="アクション">
          {actionCards.slice(0, 3).map((card) => (
            <Link key={card.href + card.title} href={card.href}>
              <Card className={`hover:border-primary/50 transition-colors cursor-pointer h-full ${card.primary ? "border-primary/30 bg-primary/5" : ""}`}>
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${card.primary ? "bg-primary/20" : "bg-muted"}`}>
                      <card.icon className={`h-4 w-4 ${card.primary ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{card.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{card.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

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
                {profileFields.filter(f => !f.filled).length > 4 && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">+{profileFields.filter(f => !f.filled).length - 4}</Badge>
                )}
              </div>
              <Link href="/profile">
                <Button variant="ghost" size="sm" className="mt-2 text-xs gap-1 p-0 h-auto">
                  プロフィールを編集 <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Quick Stats */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-5" role="list" aria-label="統計情報">
          <MiniStat icon={Shield} label="信頼度" value={`${trustData?.score ?? 0}pt`} href="/trust" />
          <MiniStat icon={Bot} label="分身AI" value={myTwin ? "作成済み" : "未作成"} href="/twins" />
          <MiniStat icon={UserPlus} label="友達" value={`${friends?.length || 0}人`} href="/friends" />
          <MiniStat icon={MessageSquare} label="チャット" value={`${chatSessions?.length || 0}件`} href="/chat" />
          <MiniStat icon={FileText} label="マッチング" value={`${completedMatchings}件完了`} href="/matching" />
        </div>

        {/* Login Streak */}
        {(me?.loginStreak ?? 0) > 1 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-lg px-4 py-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <span>{me.loginStreak}日連続ログイン中</span>
            {me.loginStreak >= 7 && <Badge variant="default" className="text-[10px]">ストリーク</Badge>}
          </div>
        )}

        {/* Recent Matchings */}
        {recentMatchings.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  最近のマッチング
                </CardTitle>
                <Link href="/matching">
                  <Button variant="ghost" size="sm" className="text-xs">
                    すべて見る
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                {recentMatchings.map((session) => {
                  const score = (session as any).compatibilityScore || 0;

                  return (
                    <Link key={session.id} href={`/matching/${session.id}`}>
                      <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                        <div className="flex items-center gap-2.5">
                          {session.status === "completed" ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <Clock className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div>
                            <p className="font-medium text-sm">{session.theme}</p>
                            <p className="text-xs text-muted-foreground">
                              {session.twin1?.name} × {session.twin2?.name}
                            </p>
                          </div>
                        </div>
                        {score > 0 && (
                          <Badge variant={score >= 80 ? "default" : "secondary"} className="text-xs">
                            {score}%
                          </Badge>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  href: string;
}) {
  return (
    <Link href={href} aria-label={`${label}: ${value}`}>
      <div className="flex items-center gap-2.5 p-3 rounded-lg border bg-card hover:border-primary/50 transition-colors cursor-pointer" role="listitem">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-sm font-medium truncate">{value}</p>
        </div>
      </div>
    </Link>
  );
}
