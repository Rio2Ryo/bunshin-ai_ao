import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { 
  Bot, MessageSquare, Users, FileText, Settings2, Plus, UserPlus, 
  TrendingUp, Clock, CheckCircle, Sparkles, Crown, Search, Globe
} from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();
  const { data: myTwin, isLoading: twinLoading } = trpc.myTwin.get.useQuery();
  const { data: friends } = trpc.friends.list.useQuery();
  const { data: chatSessions } = trpc.chat.sessions.useQuery();
  const { data: matchingSessions } = trpc.matching.sessions.useQuery();
  const { data: planInfo } = trpc.plan.getInfo.useQuery();
  const { data: usage } = trpc.plan.getUsage.useQuery();

  // 完了したマッチングの数
  const completedMatchings = matchingSessions?.filter(s => s.status === "completed").length || 0;
  // 高スコアマッチング（80%以上）
  const highScoreMatchings = matchingSessions?.filter(s => {
    if (!s.analysisResult) return false;
    try {
      const analysis = typeof s.analysisResult === 'string' 
        ? JSON.parse(s.analysisResult) 
        : s.analysisResult;
      return analysis.compatibilityScore >= 80;
    } catch {
      return false;
    }
  }).length || 0;

  // 最近のマッチング（最新3件）
  const recentMatchings = matchingSessions?.slice(0, 3) || [];

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Welcome Section */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold">
              おかえりなさい、<span className="text-gradient">{user?.name || "ユーザー"}</span>さん
            </h1>
            <p className="text-muted-foreground mt-2">
              分身AIの管理とビジネスマッチングを始めましょう。
            </p>
          </div>
          {planInfo && (
            <Link href="/plan">
              <Badge variant={planInfo.plan === "free" ? "secondary" : "default"} className="cursor-pointer">
                <Crown className="h-3 w-3 mr-1" />
                {planInfo.plan === "free" ? "フリープラン" : planInfo.plan === "premium" ? "プレミアム" : "エンタープライズ"}
              </Badge>
            </Link>
          )}
        </div>

        {/* Quick Stats */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="分身AI"
            value={myTwin ? "1" : "0"}
            description={myTwin ? myTwin.name : "未作成"}
            icon={Bot}
            href="/twins"
          />
          <StatCard
            title="友達"
            value={friends?.length?.toString() || "0"}
            description="接続中のユーザー"
            icon={Users}
            href="/friends"
          />
          <StatCard
            title="チャット"
            value={chatSessions?.length?.toString() || "0"}
            description="分身AIとの会話"
            icon={MessageSquare}
            href="/chat"
          />
          <StatCard
            title="マッチング"
            value={matchingSessions?.length?.toString() || "0"}
            description={`${completedMatchings}件完了`}
            icon={FileText}
            href="/matching"
            highlight={highScoreMatchings > 0}
          />
        </div>

        {/* Usage & Plan Info */}
        {usage && planInfo && planInfo.limits && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  今月の利用状況
                </CardTitle>
                <Link href="/plan">
                  <Button variant="ghost" size="sm">
                    詳細を見る
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">マッチング回数</span>
                    <span>{usage.matchingsThisMonth} / {planInfo.limits.maxMatchingsPerMonth === -1 ? "∞" : planInfo.limits.maxMatchingsPerMonth}</span>
                  </div>
                  <Progress 
                    value={planInfo.limits.maxMatchingsPerMonth === -1 ? 0 : (usage.matchingsThisMonth / planInfo.limits.maxMatchingsPerMonth) * 100} 
                    className="h-2"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">友達数</span>
                    <span>{friends?.length || 0} / {planInfo.limits.maxFriends === -1 ? "∞" : planInfo.limits.maxFriends}</span>
                  </div>
                  <Progress 
                    value={planInfo.limits.maxFriends === -1 ? 0 : ((friends?.length || 0) / planInfo.limits.maxFriends) * 100} 
                    className="h-2"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main Content Grid */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* My Twin Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                あなたの分身AI
              </CardTitle>
              <CardDescription>
                {myTwin ? "分身AIが作成されています" : "分身AIを作成して始めましょう"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {twinLoading ? (
                <div className="h-20 animate-pulse bg-muted rounded-lg" />
              ) : myTwin ? (
                <div className="space-y-3">
                  <div className="p-4 rounded-lg bg-muted/50 border">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium text-lg">{myTwin.name}</p>
                      {myTwin.isPublic && (
                        <Badge variant="outline" className="text-xs">
                          <Globe className="h-3 w-3 mr-1" />
                          公開中
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {myTwin.description || "説明なし"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Link href="/twins" className="flex-1">
                      <Button variant="outline" className="w-full">
                        <Settings2 className="h-4 w-4 mr-2" />
                        管理
                      </Button>
                    </Link>
                    <Link href="/chat" className="flex-1">
                      <Button className="w-full">
                        <MessageSquare className="h-4 w-4 mr-2" />
                        チャット
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-muted-foreground mb-4">
                    まだ分身AIを作成していません
                  </p>
                  <Link href="/twins">
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      分身AIを作成
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Friends & Matching */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                友達とマッチング
              </CardTitle>
              <CardDescription>
                友達の分身AIとビジネスマッチング
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="p-4 rounded-lg bg-muted/50 border">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">友達</span>
                    <span className="font-medium">{friends?.length || 0}人</span>
                  </div>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-muted-foreground">マッチング</span>
                    <span className="font-medium">{matchingSessions?.length || 0}件</span>
                  </div>
                  {highScoreMatchings > 0 && (
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Sparkles className="h-3 w-3 text-yellow-500" />
                        高相性
                      </span>
                      <span className="font-medium text-yellow-500">{highScoreMatchings}件</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Link href="/friends" className="flex-1">
                    <Button variant="outline" className="w-full">
                      <UserPlus className="h-4 w-4 mr-2" />
                      友達を追加
                    </Button>
                  </Link>
                  <Link href="/matching" className="flex-1">
                    <Button className="w-full" disabled={!myTwin || !friends?.length}>
                      <FileText className="h-4 w-4 mr-2" />
                      マッチング
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity */}
        {recentMatchings.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  最近のマッチング
                </CardTitle>
                <Link href="/matching">
                  <Button variant="ghost" size="sm">
                    すべて見る
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {recentMatchings.map((session) => {
                  let score = 0;
                  try {
                    const analysis = typeof session.analysisResult === 'string' 
                      ? JSON.parse(session.analysisResult) 
                      : session.analysisResult;
                    score = analysis?.compatibilityScore || 0;
                  } catch {}
                  
                  return (
                    <Link key={session.id} href={`/matching/${session.id}`}>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                        <div className="flex items-center gap-3">
                          {session.status === "completed" ? (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          ) : (
                            <Clock className="h-5 w-5 text-muted-foreground" />
                          )}
                          <div>
                            <p className="font-medium text-sm">{session.theme}</p>
                            <p className="text-xs text-muted-foreground">
                              {session.twin1?.name} × {session.twin2?.name}
                            </p>
                          </div>
                        </div>
                        {score > 0 && (
                          <Badge variant={score >= 80 ? "default" : "secondary"}>
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

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              クイックアクション
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Link href="/discover">
                <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2">
                  <Search className="h-5 w-5" />
                  <span>分身AIを発見</span>
                </Button>
              </Link>
              <Link href="/friends">
                <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2">
                  <UserPlus className="h-5 w-5" />
                  <span>友達を追加</span>
                </Button>
              </Link>
              <Link href="/matching">
                <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2" disabled={!myTwin}>
                  <FileText className="h-5 w-5" />
                  <span>新規マッチング</span>
                </Button>
              </Link>
              <Link href="/plan">
                <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2">
                  <Crown className="h-5 w-5" />
                  <span>プランを確認</span>
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  href,
  highlight = false,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ElementType;
  href: string;
  highlight?: boolean;
}) {
  return (
    <Link href={href}>
      <Card className={`hover:border-primary/50 transition-colors cursor-pointer ${highlight ? "border-yellow-500/50" : ""}`}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <Icon className={`h-4 w-4 ${highlight ? "text-yellow-500" : "text-muted-foreground"}`} />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{value}</div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
