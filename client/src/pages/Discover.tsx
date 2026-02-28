import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Search, User, Globe, UserPlus, MessageSquare, Sparkles, ExternalLink, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { useLocation, Link } from "wouter";

export default function Discover() {
  usePageMeta({ title: "分身AI発見", description: "公開されている分身AIを探索して、新しいつながりを見つけましょう。", ogImage: "https://bunshin-ai.pages.dev/og/discover.svg", path: "/discover" });
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTwin, setSelectedTwin] = useState<{ twin: any; user: any } | null>(null);
  const [matchingDialogOpen, setMatchingDialogOpen] = useState(false);
  const [matchingTheme, setMatchingTheme] = useState("ビジネス協業の可能性");
  const [matchingTargetUserId, setMatchingTargetUserId] = useState<number | null>(null);

  const { data: publicTwins, isLoading, refetch } = trpc.myTwin.searchPublic.useQuery({
    query: searchQuery || undefined,
    limit: 50,
  });

  const { data: myTwin } = trpc.myTwin.get.useQuery();
  const { data: friends } = trpc.friends.list.useQuery();

  const sendRequestMutation = trpc.friends.sendRequest.useMutation({
    onSuccess: () => {
      toast.success("友達リクエストを送信しました");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const createMatchingMutation = trpc.matching.create.useMutation({
    onSuccess: (data) => {
      setMatchingDialogOpen(false);
      toast.success("マッチングセッションを開始しました");
      navigate(`/matching/${data.id}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    refetch();
  };

  const isFriend = (userId: number) => {
    return friends?.some(f => f.friend.id === userId);
  };

  const handleSendFriendRequest = async (friendCode: string) => {
    sendRequestMutation.mutate({ friendCode });
  };

  const handleStartMatching = async (userId: number, theme: string) => {
    if (!myTwin) {
      toast.error("まず自分の分身AIを作成してください");
      return;
    }
    createMatchingMutation.mutate({
      friendId: userId,
      theme,
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Globe className="h-6 w-6 text-cyan-400" />
              分身AI発見
            </h1>
            <p className="text-gray-400 mt-1">
              公開されている分身AIを探して、ビジネスマッチングを始めましょう
            </p>
          </div>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex gap-3" role="search">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden="true" />
            <Input
              placeholder="名前、スキル、タグで検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-gray-900/50 border-gray-700"
              aria-label="ユーザーを検索"
            />
          </div>
          <Button type="submit" className="bg-cyan-600 hover:bg-cyan-700" aria-label="検索">
            検索
          </Button>
        </form>

        {/* Results */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
          </div>
        ) : publicTwins && publicTwins.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" role="list" aria-label="公開分身AI一覧">
            {publicTwins.map(({ twin, user: twinUser }: { twin: any; user: any }) => (
              <Card
                key={twin.id}
                role="listitem"
                className="bg-gray-900/50 border-gray-700 hover:border-cyan-500/50 transition-colors cursor-pointer"
                onClick={() => setSelectedTwin({ twin, user: twinUser })}
                aria-label={`${twin.name} - ${twinUser?.name || "匿名ユーザー"}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-500 to-purple-500 flex items-center justify-center">
                      <User className="h-6 w-6 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg truncate">{twin.name}</CardTitle>
                      <CardDescription className="truncate">
                        {twinUser?.name || "匿名ユーザー"}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-400 line-clamp-2 mb-3">
                    {twin.publicBio || twin.description || "紹介文なし"}
                  </p>
                  {twin.tags && twin.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {twin.tags.slice(0, 3).map((tag: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                      {twin.tags.length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{twin.tags.length - 3}
                        </Badge>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="bg-gray-900/50 border-gray-700">
            <CardContent className="py-12 text-center">
              <Globe className="h-12 w-12 text-gray-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">公開分身AIが見つかりません</h3>
              <p className="text-gray-400">
                {searchQuery ? "検索条件を変更してみてください" : "まだ公開されている分身AIがありません"}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selectedTwin} onOpenChange={() => setSelectedTwin(null)}>
        <DialogContent className="bg-gray-900 border-gray-700 max-w-lg">
          {selectedTwin && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-500 to-purple-500 flex items-center justify-center">
                    <User className="h-8 w-8 text-white" />
                  </div>
                  <div>
                    <DialogTitle className="text-xl">{selectedTwin.twin.name}</DialogTitle>
                    <DialogDescription>
                      {selectedTwin.user?.name || "匿名ユーザー"}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4 mt-4">
                {/* Bio */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-400 mb-2">紹介</h4>
                  <p className="text-sm">
                    {selectedTwin.twin.publicBio || selectedTwin.twin.description || "紹介文なし"}
                  </p>
                </div>

                {/* Tags */}
                {selectedTwin.twin.tags && selectedTwin.twin.tags.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-400 mb-2">タグ</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedTwin.twin.tags.map((tag: string, i: number) => (
                        <Badge key={i} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Profile link */}
                {selectedTwin.user?.id && (
                  <div className="pt-2">
                    <Link href={`/users/${selectedTwin.user.id}`}>
                      <Button variant="outline" size="sm" className="w-full gap-2" aria-label="プロフィールを見る">
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        プロフィールを見る
                      </Button>
                    </Link>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-4 border-t border-gray-700">
                  {isFriend(selectedTwin.user?.id) ? (
                    <Button
                      className="flex-1 bg-cyan-600 hover:bg-cyan-700"
                      onClick={() => {
                        if (!myTwin) {
                          toast.error("まず自分の分身AIを作成してください");
                          return;
                        }
                        if (selectedTwin.user?.id) {
                          setMatchingTargetUserId(selectedTwin.user.id);
                          setMatchingTheme("ビジネス協業の可能性");
                          setMatchingDialogOpen(true);
                        }
                      }}
                      disabled={createMatchingMutation.isPending}
                      aria-label="マッチング開始"
                    >
                      <MessageSquare className="h-4 w-4 mr-2" aria-hidden="true" />
                      マッチング開始
                    </Button>
                  ) : (
                    <Button
                      className="flex-1 bg-cyan-600 hover:bg-cyan-700"
                      onClick={() => {
                        if (selectedTwin.user?.friendCode) {
                          handleSendFriendRequest(selectedTwin.user.friendCode);
                        } else {
                          toast.error("このユーザーには友達リクエストを送れません");
                        }
                      }}
                      disabled={sendRequestMutation.isPending}
                      aria-label="友達リクエストを送る"
                    >
                      <UserPlus className="h-4 w-4 mr-2" aria-hidden="true" />
                      友達リクエスト
                    </Button>
                  )}
                </div>

                {!isFriend(selectedTwin.user?.id) && (
                  <p className="text-xs text-gray-500 text-center">
                    マッチングを開始するには、まず友達になる必要があります
                  </p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

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
            <Label htmlFor="discover-matching-theme">対話テーマ</Label>
            <Input
              id="discover-matching-theme"
              value={matchingTheme}
              onChange={(e) => setMatchingTheme(e.target.value)}
              placeholder="例: ビジネス協業の可能性"
              onKeyDown={(e) => {
                if (e.key === "Enter" && matchingTheme.trim() && matchingTargetUserId) {
                  handleStartMatching(matchingTargetUserId, matchingTheme.trim());
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatchingDialogOpen(false)}>
              キャンセル
            </Button>
            <Button
              onClick={() => {
                if (matchingTargetUserId) {
                  handleStartMatching(matchingTargetUserId, matchingTheme.trim());
                }
              }}
              disabled={!matchingTheme.trim() || createMatchingMutation.isPending}
            >
              {createMatchingMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Users className="h-4 w-4 mr-2" />}
              開始
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
