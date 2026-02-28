import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc, API_BASE } from "@/lib/trpc";
import { useParams, Link, useLocation } from "wouter";
import { toast } from "sonner";
import { useState } from "react";
import {
  ArrowLeft, Bot, Shield, Briefcase, Building2, MapPin,
  UserPlus, Users, Loader2, MessageSquare, Sparkles, Tag,
  Share2, Copy, Check,
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

  const utils = trpc.useUtils();
  const sendRequest = trpc.friends.sendRequest.useMutation({
    onSuccess: () => {
      toast.success("友達リクエストを送信しました");
      utils.friends.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const [matchingDialogOpen, setMatchingDialogOpen] = useState(false);
  const [matchingTheme, setMatchingTheme] = useState("ビジネス協業の可能性");

  const createMatching = trpc.matching.create.useMutation({
    onSuccess: (data) => {
      setMatchingDialogOpen(false);
      toast.success("マッチングセッションを開始しました");
      navigate(`/matching/${data.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const displayName = profile?.displayName || profile?.userName || "ユーザー";
  const apiBaseUrl = API_BASE;

  usePageMeta({
    title: `${displayName}のプロフィール`,
    description: profile?.bio || profile?.twin?.description || `${displayName}のプロフィール - 分身AI`,
    ogImage: profile?.avatarUrl ? `${apiBaseUrl}${profile.avatarUrl}` : undefined,
    path: `/users/${id}`,
  });

  const isFriend = friends?.some((f) => f.friend.id === userId) ?? false;
  const initial = displayName.charAt(0) || "?";

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/users/${id}` : "";
  const shareText = `${displayName}のプロフィール - 分身AI`;
  const [copied, setCopied] = useState(false);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("リンクをコピーしました");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("コピーに失敗しました");
    }
  };

  const handleShareTwitter = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleShareLine = () => {
    const url = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: shareText, url: shareUrl });
      } catch { /* cancelled */ }
    }
  };

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
                if (!myTwin) {
                  toast.error("まず自分の分身AIを作成してください");
                  return;
                }
                setMatchingTheme("ビジネス協業の可能性");
                setMatchingDialogOpen(true);
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
                if (!profile.friendCode) {
                  toast.error("このユーザーの友達コードが見つかりません");
                  return;
                }
                sendRequest.mutate({ friendCode: profile.friendCode });
              }}
              disabled={sendRequest.isPending}
            >
              {sendRequest.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4 mr-2" />
              )}
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

        {/* Share Buttons */}
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-3">
              <Share2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">プロフィールを共有</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleShareTwitter}>
                <svg className="h-4 w-4 mr-1.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                X(Twitter)
              </Button>
              <Button variant="outline" size="sm" onClick={handleShareLine}>
                <svg className="h-4 w-4 mr-1.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                </svg>
                LINE
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyLink}
              >
                {copied ? <Check className="h-4 w-4 mr-1.5 text-green-500" /> : <Copy className="h-4 w-4 mr-1.5" />}
                {copied ? "コピー済み" : "リンクをコピー"}
              </Button>
              {typeof navigator !== "undefined" && "share" in navigator && (
                <Button variant="outline" size="sm" onClick={handleNativeShare}>
                  <Share2 className="h-4 w-4 mr-1.5" />
                  共有
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Matching Theme Dialog */}
      <Dialog open={matchingDialogOpen} onOpenChange={setMatchingDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>マッチングを開始</DialogTitle>
            <DialogDescription>
              分身AI同士が対話するテーマを入力してください
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="matching-theme">対話テーマ</Label>
            <Input
              id="matching-theme"
              value={matchingTheme}
              onChange={(e) => setMatchingTheme(e.target.value)}
              placeholder="例: ビジネス協業の可能性"
              onKeyDown={(e) => {
                if (e.key === "Enter" && matchingTheme.trim()) {
                  createMatching.mutate({ friendId: userId, theme: matchingTheme.trim() });
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatchingDialogOpen(false)}>
              キャンセル
            </Button>
            <Button
              onClick={() => createMatching.mutate({ friendId: userId, theme: matchingTheme.trim() })}
              disabled={!matchingTheme.trim() || createMatching.isPending}
            >
              {createMatching.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Users className="h-4 w-4 mr-2" />}
              開始
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
