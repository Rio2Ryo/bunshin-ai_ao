import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc, API_BASE } from "@/lib/trpc";
import { Link } from "wouter";
import { useState } from "react";
import { toast } from "sonner";
import {
  Heart, MessageSquare, Share2, Globe, Users, Lock, Loader2,
  Trophy, Target, Star, BarChart3, Trash2, MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const VISIBILITY_ICONS: Record<string, any> = {
  public: Globe,
  friends: Users,
  private: Lock,
};

const TYPE_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  matching_result: { label: "マッチング結果", icon: BarChart3, color: "text-primary" },
  tournament_result: { label: "トーナメント成績", icon: Trophy, color: "text-yellow-500" },
  scenario_review: { label: "シナリオレビュー", icon: Star, color: "text-orange-500" },
  achievement: { label: "アチーブメント", icon: Target, color: "text-green-500" },
  status: { label: "ステータス", icon: MessageSquare, color: "text-blue-500" },
};

function FeedItem({ item, onRefetch }: { item: any; onRefetch: () => void }) {
  const [showComments, setShowComments] = useState(false);
  const [commentInput, setCommentInput] = useState("");
  const likeMut = trpc.feed.like.useMutation();
  const unlikeMut = trpc.feed.unlike.useMutation();
  const commentMut = trpc.feed.comment.useMutation();
  const deleteMut = trpc.feed.delete.useMutation();
  const updateVisMut = trpc.feed.updateVisibility.useMutation();
  const { data: comments, refetch: refetchComments } = trpc.feed.getComments.useQuery(
    { feedItemId: item.id },
    { enabled: showComments }
  );

  const typeInfo = TYPE_LABELS[item.type] || TYPE_LABELS.status;
  const TypeIcon = typeInfo.icon;
  const VisIcon = VISIBILITY_ICONS[item.visibility] || Globe;

  const handleLike = async () => {
    try {
      if (item.liked) {
        await unlikeMut.mutateAsync({ feedItemId: item.id });
      } else {
        await likeMut.mutateAsync({ feedItemId: item.id });
      }
      onRefetch();
    } catch { /* ignore */ }
  };

  const handleComment = async () => {
    if (!commentInput.trim()) return;
    try {
      await commentMut.mutateAsync({ feedItemId: item.id, content: commentInput.trim() });
      setCommentInput("");
      refetchComments();
      onRefetch();
    } catch (e: any) {
      toast.error(e.message || "コメントの投稿に失敗しました");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMut.mutateAsync({ feedItemId: item.id });
      onRefetch();
      toast.success("投稿を削除しました");
    } catch { /* ignore */ }
  };

  const handleVisibility = async (vis: "public" | "friends" | "private") => {
    try {
      await updateVisMut.mutateAsync({ feedItemId: item.id, visibility: vis });
      onRefetch();
    } catch { /* ignore */ }
  };

  return (
    <Card>
      <CardContent className="pt-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          <Link href={`/users/${item.userId}`}>
            <Avatar className="h-10 w-10 cursor-pointer">
              {item.avatarUrl ? <AvatarImage src={`${API_BASE}${item.avatarUrl}`} /> : null}
              <AvatarFallback>{(item.userName || "?").slice(0, 2)}</AvatarFallback>
            </Avatar>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Link href={`/users/${item.userId}`}>
                <span className="font-medium text-sm hover:underline cursor-pointer">{item.userName || "ユーザー"}</span>
              </Link>
              <Badge variant="outline" className={`text-xs ${typeInfo.color}`}>
                <TypeIcon className="h-3 w-3 mr-1" />
                {typeInfo.label}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <VisIcon className="h-3 w-3" />
              <span>{item.createdAt?.slice(0, 16).replace("T", " ")}</span>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleVisibility("public")}>
                <Globe className="h-4 w-4 mr-2" />公開
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleVisibility("friends")}>
                <Users className="h-4 w-4 mr-2" />友達のみ
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleVisibility("private")}>
                <Lock className="h-4 w-4 mr-2" />非公開
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                <Trash2 className="h-4 w-4 mr-2" />削除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Content */}
        {item.type === "matching_result" && item.data && (
          <div className="bg-muted/50 rounded-lg p-3 mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">{item.data.theme}</span>
              <span className="text-lg font-bold text-primary">{item.data.score}%</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {item.data.twin1Name} × {item.data.twin2Name}
            </p>
            {item.data.summary && <p className="text-sm mt-1">{item.data.summary}</p>}
            {item.data.sessionId && (
              <Link href={`/matching/${item.data.sessionId}`}>
                <Button variant="link" size="sm" className="px-0 h-auto mt-1">詳細を見る →</Button>
              </Link>
            )}
          </div>
        )}
        {item.type === "tournament_result" && item.data && (
          <div className="bg-muted/50 rounded-lg p-3 mb-3">
            <p className="text-sm font-medium">{item.data.tournamentName}</p>
            <p className="text-xs text-muted-foreground">順位: {item.data.rank}位 / スコア: {item.data.score}</p>
          </div>
        )}
        {item.type === "scenario_review" && item.data && (
          <div className="bg-muted/50 rounded-lg p-3 mb-3">
            <p className="text-sm font-medium">{item.data.scenarioTitle}</p>
            <div className="flex items-center gap-1 mt-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className={`h-3.5 w-3.5 ${i < (item.data.rating || 0) ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground"}`} />
              ))}
            </div>
            {item.data.comment && <p className="text-sm mt-1">{item.data.comment}</p>}
          </div>
        )}
        {(item.type === "achievement" || item.type === "status") && item.data?.message && (
          <p className="text-sm mb-3">{item.data.message}</p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-4 border-t pt-2">
          <button
            onClick={handleLike}
            className={`flex items-center gap-1.5 text-sm transition-colors ${
              item.liked ? "text-red-500" : "text-muted-foreground hover:text-red-500"
            }`}
          >
            <Heart className={`h-4 w-4 ${item.liked ? "fill-red-500" : ""}`} />
            {item.likeCount > 0 && <span>{item.likeCount}</span>}
          </button>
          <button
            onClick={() => setShowComments(!showComments)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            <MessageSquare className="h-4 w-4" />
            {item.commentCount > 0 && <span>{item.commentCount}</span>}
          </button>
          <button
            onClick={() => {
              const url = `https://bunshin-ai.pages.dev/feed`;
              navigator.clipboard.writeText(url);
              toast.success("リンクをコピーしました");
            }}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            <Share2 className="h-4 w-4" />
          </button>
        </div>

        {/* Comments section */}
        {showComments && (
          <div className="mt-3 space-y-2 border-t pt-3">
            {comments?.map((c: any) => (
              <div key={c.id} className="flex items-start gap-2">
                <Avatar className="h-6 w-6">
                  {c.avatarUrl ? <AvatarImage src={`${API_BASE}${c.avatarUrl}`} /> : null}
                  <AvatarFallback className="text-xs">{(c.userName || "?").slice(0, 1)}</AvatarFallback>
                </Avatar>
                <div>
                  <span className="text-xs font-medium">{c.userName}</span>
                  <p className="text-sm">{c.content}</p>
                  <span className="text-xs text-muted-foreground">{c.createdAt?.slice(0, 16).replace("T", " ")}</span>
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                placeholder="コメントを入力..."
                className="h-8 text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleComment()}
              />
              <Button size="sm" onClick={handleComment} disabled={!commentInput.trim() || commentMut.isPending}>
                送信
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Feed() {
  usePageMeta({ title: "フィード", description: "友達のマッチング結果やアクティビティを確認", path: "/feed" });
  const { data, isLoading, refetch } = trpc.feed.list.useQuery({ limit: 30 });

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-primary" />
            フィード
          </h1>
          <p className="text-muted-foreground">友達のマッチング結果・トーナメント成績・レビュー</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : data?.items && data.items.length > 0 ? (
          data.items.map((item: any) => (
            <FeedItem key={item.id} item={item} onRefetch={refetch} />
          ))
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">フィードにまだ投稿がありません</p>
              <p className="text-sm text-muted-foreground mt-1">マッチング完了後に結果をシェアしましょう</p>
              <Link href="/matching">
                <Button variant="outline" className="mt-4">マッチングを開始</Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
