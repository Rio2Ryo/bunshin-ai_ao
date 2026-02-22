import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import {
  Bot, MessageSquare, Users, FileText, UserPlus,
  Clock, CheckCircle, Crown, Globe, ArrowRight
} from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();
  const { data: myTwin } = trpc.myTwin.get.useQuery();
  const { data: friends } = trpc.friends.list.useQuery();
  const { data: chatSessions } = trpc.chat.sessions.useQuery();
  const { data: matchingSessions } = trpc.matching.sessions.useQuery();
  const { data: planInfo } = trpc.plan.getInfo.useQuery();

  const completedMatchings = matchingSessions?.filter(s => s.status === "completed").length || 0;
  const recentMatchings = matchingSessions?.slice(0, 3) || [];

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

  return (
    <DashboardLayout>
      <div className="space-y-6">
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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

        {/* Quick Stats */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <MiniStat icon={Bot} label="分身AI" value={myTwin ? "作成済み" : "未作成"} href="/twins" />
          <MiniStat icon={UserPlus} label="友達" value={`${friends?.length || 0}人`} href="/friends" />
          <MiniStat icon={MessageSquare} label="チャット" value={`${chatSessions?.length || 0}件`} href="/chat" />
          <MiniStat icon={FileText} label="マッチング" value={`${completedMatchings}件完了`} href="/matching" />
        </div>

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
                  let score = 0;
                  try {
                    const analysis = typeof session.analysisResult === 'string'
                      ? JSON.parse(session.analysisResult)
                      : session.analysisResult;
                    score = analysis?.compatibilityScore || 0;
                  } catch {}

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
    <Link href={href}>
      <div className="flex items-center gap-2.5 p-3 rounded-lg border bg-card hover:border-primary/50 transition-colors cursor-pointer">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-sm font-medium truncate">{value}</p>
        </div>
      </div>
    </Link>
  );
}
