import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Bot, MessageSquare, Users, FileText, Settings2, Plus, UserPlus } from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();
  const { data: myTwin, isLoading: twinLoading } = trpc.myTwin.get.useQuery();
  const { data: friends } = trpc.friends.list.useQuery();
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
            description="ビジネス対話"
            icon={FileText}
            href="/matching"
          />
        </div>

        {/* Quick Actions */}
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
                    <p className="font-medium text-lg">{myTwin.name}</p>
                    <p className="text-sm text-muted-foreground mt-1">
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
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ElementType;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{value}</div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
