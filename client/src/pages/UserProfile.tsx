import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useParams, Link, useLocation } from "wouter";
import { toast } from "sonner";
import {
  ArrowLeft, Bot, Shield, Briefcase, Building2, MapPin,
  UserPlus, Users, Loader2, MessageSquare, Sparkles, Tag,
} from "lucide-react";

const rankLabels: Record<string, string> = {
  beginner: "ビギナー",
  bronze: "ブロンズ",
  silver: "シルバー",
  gold: "ゴールド",
  platinum: "プラチナ",
  diamond: "ダイヤモンド",
};

const rankColors: Record<string, string> = {
  beginner: "bg-muted text-muted-foreground",
  bronze: "bg-amber-100 text-amber-800",
  silver: "bg-gray-200 text-gray-700",
  gold: "bg-yellow-100 text-yellow-800",
  platinum: "bg-cyan-100 text-cyan-800",
  diamond: "bg-violet-100 text-violet-800",
};

export default function UserProfile() {
  const { id } = useParams<{ id: string }>();
  const userId = parseInt(id || "0");
  const [, navigate] = useLocation();

  const { data: profile, isLoading, isError } = trpc.profile.getPublic.useQuery(
    { userId },
    { enabled: userId > 0 }
  );

  const { data: friends } = trpc.friends.list.useQuery();
  const { data: myTwin } = trpc.myTwin.get.useQuery();

  const sendRequest = trpc.friends.sendRequest.useMutation({
    onSuccess: () => toast.success("友達リクエストを送信しました"),
    onError: (e) => toast.error(e.message),
  });

  const createMatching = trpc.matching.create.useMutation({
    onSuccess: (data) => {
      toast.success("マッチングセッションを開始しました");
      navigate(`/matching/${data.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const displayName = profile?.displayName || profile?.userName || "ユーザー";
  usePageMeta({
    title: `${displayName}のプロフィール`,
    description: profile?.bio || `${displayName}のプロフィールを見る`,
    path: `/users/${id}`,
  });

  const isFriend = friends?.some((f) => f.friend.id === userId) ?? false;
  const initial = displayName.charAt(0) || "?";
  const apiBaseUrl = import.meta.env.VITE_API_URL || "https://bunshin-ai-api.common-gifted-tokyo.workers.dev";

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (isError || !profile) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <p className="text-muted-foreground">プロフィールが見つかりません</p>
          <Button variant="outline" onClick={() => navigate("/discover")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            発見ページへ戻る
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Back button */}
        <Button variant="ghost" size="sm" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          戻る
        </Button>

        {/* Profile Header */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
              <Avatar className="h-20 w-20 shrink-0">
                {profile.avatarUrl && (
                  <AvatarImage src={`${apiBaseUrl}${profile.avatarUrl}`} alt={displayName} />
                )}
                <AvatarFallback className="text-2xl bg-primary/10 text-primary">
                  {initial}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 text-center sm:text-left min-w-0">
                <h1 className="text-xl font-bold">{displayName}</h1>

                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-1.5">
                  {profile.position && (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Briefcase className="h-3.5 w-3.5" />
                      {profile.position}
                    </span>
                  )}
                  {profile.company && (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Building2 className="h-3.5 w-3.5" />
                      {profile.company}
                    </span>
                  )}
                  {profile.industry && (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" />
                      {profile.industry}
                    </span>
                  )}
                </div>

                {/* Trust badge */}
                <div className="flex items-center justify-center sm:justify-start gap-2 mt-2">
                  <Badge className={`text-xs ${rankColors[profile.trustRank] || rankColors.beginner}`}>
                    <Shield className="h-3 w-3 mr-1" />
                    {rankLabels[profile.trustRank] || "ビギナー"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{profile.trustScore}pt</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bio */}
        {profile.bio && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">自己紹介</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{profile.bio}</p>
            </CardContent>
          </Card>
        )}

        {/* Experience */}
        {profile.experience && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">経歴</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{profile.experience}</p>
            </CardContent>
          </Card>
        )}

        {/* Skills & Expertise */}
        {(profile.skills.length > 0 || profile.expertise.length > 0) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">スキル・専門分野</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {profile.skills.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">スキル</p>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.skills.map((skill, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {profile.expertise.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">専門分野</p>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.expertise.map((exp, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        <Sparkles className="h-3 w-3 mr-1" />
                        {exp}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Twin Info */}
        {profile.twin && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                分身AI
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-medium text-sm">{profile.twin.name}</p>
              {profile.twin.description && (
                <p className="text-sm text-muted-foreground mt-1">{profile.twin.description}</p>
              )}
              {profile.twin.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {profile.twin.tags.map((tag, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      <Tag className="h-3 w-3 mr-1" />
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          {isFriend ? (
            <Button
              className="flex-1"
              onClick={() => {
                const theme = prompt("対話テーマを入力してください", "ビジネス協業の可能性");
                if (theme && myTwin) {
                  createMatching.mutate({ friendId: userId, theme });
                } else if (!myTwin) {
                  toast.error("まず自分の分身AIを作成してください");
                }
              }}
              disabled={createMatching.isPending}
            >
              {createMatching.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Users className="h-4 w-4 mr-2" />
              )}
              マッチングを開始
            </Button>
          ) : (
            <Button
              className="flex-1"
              onClick={() => {
                // We need the friend code — fetch it from the discover data
                // Since we don't have it here, use a different approach
                toast.info("友達コードで友達追加するには、発見ページをご利用ください");
                navigate("/discover");
              }}
              disabled={sendRequest.isPending}
            >
              <UserPlus className="h-4 w-4 mr-2" />
              友達になる
            </Button>
          )}
          {isFriend && (
            <Button variant="outline" className="flex-1" asChild>
              <Link href="/chat">
                <MessageSquare className="h-4 w-4 mr-2" />
                チャットへ
              </Link>
            </Button>
          )}
        </div>

        {!isFriend && (
          <p className="text-xs text-muted-foreground text-center">
            マッチングを開始するには、まず友達になる必要があります
          </p>
        )}
      </div>
    </DashboardLayout>
  );
}
