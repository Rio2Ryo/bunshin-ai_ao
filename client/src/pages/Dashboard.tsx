import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Bot, MessageSquare, Users, FileText, Settings2, Plus } from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();
  const { data: twins, isLoading: twinsLoading } = trpc.twins.list.useQuery();
  const { data: chatSessions } = trpc.chat.sessions.useQuery();
  const { data: matchingSessions } = trpc.matching.sessions.useQuery();

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Welcome Section */}
        <div>
          <h1 className="text-3xl font-bold">
            おかえりなさい、<span className="text-gradient">{user?.name || "ユーザー"}</span>さん
          </h1>
          <p className="text-muted-foreground mt-2">
            分身AIの管理とビジネスマッチングを始めましょう。
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="分身AI"
            value={twins?.length ?? 0}
            icon={<Bot className="h-5 w-5" />}
            href="/twins"
          />
          <StatCard
            title="チャットセッション"
            value={chatSessions?.length ?? 0}
            icon={<MessageSquare className="h-5 w-5" />}
            href="/chat"
          />
          <StatCard
            title="マッチング"
            value={matchingSessions?.length ?? 0}
            icon={<Users className="h-5 w-5" />}
            href="/matching"
          />
          <StatCard
            title="知識ベース"
            value="-"
            icon={<FileText className="h-5 w-5" />}
            href="/twins"
          />
        </div>

        {/* Quick Actions */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* My Twins */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>分身AI</CardTitle>
                <CardDescription>あなたの分身AIを管理</CardDescription>
              </div>
              <Link href="/twins">
                <Button size="sm" variant="outline">
                  <Plus className="h-4 w-4 mr-1" />
                  新規作成
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {twinsLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : twins && twins.length > 0 ? (
                <div className="space-y-2">
                  {twins.slice(0, 3).map((twin) => (
                    <Link key={twin.id} href={`/twins/${twin.id}`}>
                      <div className="p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                            <Bot className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{twin.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {twin.status === "active" ? "アクティブ" : 
                               twin.status === "training" ? "学習中" : "非アクティブ"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Bot className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">まだ分身AIがありません</p>
                  <Link href="/twins">
                    <Button>
                      <Plus className="h-4 w-4 mr-1" />
                      分身AIを作成
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Matching */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>最近のマッチング</CardTitle>
                <CardDescription>分身AI同士の対話履歴</CardDescription>
              </div>
              <Link href="/matching">
                <Button size="sm" variant="outline">
                  すべて見る
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {matchingSessions && matchingSessions.length > 0 ? (
                <div className="space-y-2">
                  {matchingSessions.slice(0, 3).map((session) => (
                    <Link key={session.id} href={`/matching/${session.id}`}>
                      <div className="p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer">
                        <p className="font-medium truncate">{session.theme}</p>
                        <p className="text-sm text-muted-foreground">
                          {session.status === "completed" ? "完了" :
                           session.status === "running" ? "実行中" :
                           session.status === "failed" ? "失敗" : "待機中"}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">マッチング履歴がありません</p>
                  <Link href="/matching">
                    <Button>
                      マッチングを開始
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Setup Guide */}
        <Card>
          <CardHeader>
            <CardTitle>セットアップガイド</CardTitle>
            <CardDescription>分身AIを最大限に活用するための設定</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <SetupItem
                title="プロフィール設定"
                description="あなたの情報を入力して分身AIの基盤を作成"
                href="/profile"
                icon={<Settings2 className="h-5 w-5" />}
              />
              <SetupItem
                title="AI API設定"
                description="ChatGPT、Geminiなどの外部AIを連携"
                href="/ai-config"
                icon={<Bot className="h-5 w-5" />}
              />
              <SetupItem
                title="オーケストレーション"
                description="AIの役割分担を設定"
                href="/orchestration"
                icon={<Users className="h-5 w-5" />}
              />
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
  icon,
  href,
}: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{title}</p>
              <p className="text-2xl font-bold">{value}</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-primary">
              {icon}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function SetupItem({
  title,
  description,
  href,
  icon,
}: {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={href}>
      <div className="p-4 rounded-lg border border-border/50 hover:border-primary/50 transition-colors cursor-pointer">
        <div className="flex items-center gap-3 mb-2">
          <div className="text-primary">{icon}</div>
          <h3 className="font-medium">{title}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </Link>
  );
}
