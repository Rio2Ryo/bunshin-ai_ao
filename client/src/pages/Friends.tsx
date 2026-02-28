import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useState } from "react";
import { toast } from "sonner";
import { UserPlus, Users, Loader2, Check, X, Bot, Copy, Share2, QrCode, Link as LinkIcon, Heart, Sparkles, TrendingUp, ExternalLink, Ban, ShieldOff } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link } from "wouter";
import { QRCodeSVG } from "qrcode.react";

// 相性レベルに応じた色を取得
function getCompatibilityColor(score: number): string {
  if (score >= 80) return "text-green-500";
  if (score >= 60) return "text-cyan-500";
  if (score >= 40) return "text-yellow-500";
  return "text-gray-500";
}

// 相性レベルに応じたラベルを取得
function getCompatibilityLabel(score: number): string {
  if (score >= 80) return "最高の相性";
  if (score >= 60) return "良い相性";
  if (score >= 40) return "普通";
  return "まだ分析中";
}

export default function Friends() {
  usePageMeta({ title: "友達", description: "友達一覧・友達申請・相性チェック", path: "/friends" });
  const { user } = useAuth();
  const { data: friends, isLoading, refetch } = trpc.friends.list.useQuery();
  const { data: requests, refetch: refetchRequests } = trpc.friends.pendingRequests.useQuery();
  const { data: friendCodeData } = trpc.plan.getFriendCode.useQuery();
  const { data: compatibilityData } = trpc.friends.getAllWaveformCompatibilities.useQuery();

  const sendRequest = trpc.friends.sendRequest.useMutation();
  const acceptRequest = trpc.friends.acceptRequest.useMutation();
  const rejectRequest = trpc.friends.rejectRequest.useMutation();

  const { data: blockedUsers, refetch: refetchBlocked } = trpc.blocks.list.useQuery();
  const blockMut = trpc.blocks.block.useMutation({
    onSuccess: () => {
      refetch();
      refetchBlocked();
      toast.success("ブロックしました");
    },
  });
  const unblockMut = trpc.blocks.unblock.useMutation({
    onSuccess: () => {
      refetchBlocked();
      toast.success("ブロックを解除しました");
    },
  });

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [friendCode, setFriendCode] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // ユーザーの友達コード
  const myFriendCode = friendCodeData?.friendCode || "";
  
  // 共有用URL
  const shareUrl = typeof window !== "undefined" 
    ? `${window.location.origin}/friends?code=${myFriendCode}`
    : "";

  // 友達の相性データを取得
  const getCompatibility = (friendId: number) => {
    if (!compatibilityData?.compatibilities) return null;
    return compatibilityData.compatibilities.find((c: { friendId: number }) => c.friendId === friendId);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(myFriendCode);
    toast.success("友達コードをコピーしました");
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    toast.success("共有リンクをコピーしました");
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "分身AI - 友達コード",
          text: `分身AIで友達になりましょう！\n友達コード: ${myFriendCode}`,
          url: shareUrl,
        });
      } catch (error) {
        // ユーザーがキャンセルした場合は何もしない
      }
    } else {
      setIsShareOpen(true);
    }
  };

  const handleSendRequest = async () => {
    if (!friendCode.trim()) {
      toast.error("友達コードを入力してください");
      return;
    }

    try {
      await sendRequest.mutateAsync({ friendCode: friendCode.trim() });
      toast.success("友達リクエストを送信しました");
      setIsAddOpen(false);
      setFriendCode("");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "送信に失敗しました";
      toast.error(message);
    }
  };

  const handleAccept = async (requestId: number) => {
    try {
      await acceptRequest.mutateAsync({ requestId });
      toast.success("友達リクエストを承認しました");
      refetch();
      refetchRequests();
    } catch (error) {
      toast.error("承認に失敗しました");
    }
  };

  const handleReject = async (requestId: number) => {
    try {
      await rejectRequest.mutateAsync({ requestId });
      toast.success("友達リクエストを拒否しました");
      refetchRequests();
    } catch (error) {
      toast.error("拒否に失敗しました");
    }
  };

  const pendingCount = requests?.length || 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">友達</h1>
            <p className="text-muted-foreground mt-2">
              友達になると、お互いの分身AI同士でマッチングができます
            </p>
          </div>
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="h-4 w-4 mr-2" />
                友達を追加
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>友達を追加</DialogTitle>
                <DialogDescription>
                  友達コードを入力して、友達リクエストを送信します
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>友達コード</Label>
                  <Input
                    value={friendCode}
                    onChange={(e) => setFriendCode(e.target.value)}
                    placeholder="友達のコードを入力"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                    キャンセル
                  </Button>
                  <Button onClick={handleSendRequest} disabled={sendRequest.isPending}>
                    {sendRequest.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    リクエスト送信
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* 自分の友達コード */}
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5 text-primary" />
              あなたの友達コード
            </CardTitle>
            <CardDescription>
              このコードやQRコードを友達に共有して、友達リクエストを受け取りましょう
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-6">
              {/* QRコード */}
              <div className="flex flex-col items-center gap-3">
                <div className="p-4 bg-white rounded-xl shadow-lg">
                  <QRCodeSVG 
                    value={shareUrl}
                    size={160}
                    level="M"
                    includeMargin={false}
                  />
                </div>
                <p className="text-sm text-muted-foreground">QRコードをスキャン</p>
              </div>
              
              {/* コードと共有ボタン */}
              <div className="flex-1 space-y-4">
                <div>
                  <Label className="text-sm text-muted-foreground mb-2 block">友達コード</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 p-3 rounded-lg bg-muted font-mono text-xl tracking-wider text-center">
                      {myFriendCode}
                    </code>
                    <Button variant="outline" size="icon" onClick={handleCopyCode}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button className="flex-1" onClick={handleShare}>
                    <Share2 className="h-4 w-4 mr-2" />
                    共有する
                  </Button>
                  <Dialog open={isShareOpen} onOpenChange={setIsShareOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="flex-1">
                        <QrCode className="h-4 w-4 mr-2" />
                        QRコードを拡大
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>友達コードを共有</DialogTitle>
                        <DialogDescription>
                          QRコードをスキャンするか、リンクをコピーして共有してください
                        </DialogDescription>
                      </DialogHeader>
                      <div className="flex flex-col items-center gap-6 py-4">
                        <div className="p-6 bg-white rounded-2xl shadow-lg">
                          <QRCodeSVG 
                            value={shareUrl}
                            size={240}
                            level="H"
                            includeMargin={false}
                          />
                        </div>
                        <div className="w-full space-y-3">
                          <div className="flex items-center gap-2">
                            <code className="flex-1 p-2 rounded bg-muted text-sm truncate">
                              {shareUrl}
                            </code>
                            <Button variant="outline" size="sm" onClick={handleCopyLink}>
                              <LinkIcon className="h-4 w-4 mr-1" />
                              コピー
                            </Button>
                          </div>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 p-2 rounded bg-muted text-center font-mono text-lg">
                              {myFriendCode}
                            </code>
                            <Button variant="outline" size="sm" onClick={handleCopyCode}>
                              <Copy className="h-4 w-4 mr-1" />
                              コピー
                            </Button>
                          </div>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="friends">
          <TabsList>
            <TabsTrigger value="friends">友達一覧 ({friends?.length || 0})</TabsTrigger>
            <TabsTrigger value="requests">
              リクエスト {pendingCount > 0 && `(${pendingCount})`}
            </TabsTrigger>
            <TabsTrigger value="blocked">ブロック ({blockedUsers?.length || 0})</TabsTrigger>
          </TabsList>

          <TabsContent value="friends" className="mt-4">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : friends && friends.length > 0 ? (
              <>
                {friends.length > 5 && (
                  <div className="mb-4">
                    <Input
                      placeholder="友達を検索..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="max-w-sm"
                    />
                  </div>
                )}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {friends.filter(f => {
                  if (!searchQuery.trim()) return true;
                  const q = searchQuery.toLowerCase();
                  return (f.friend.name || "").toLowerCase().includes(q) ||
                         (f.twin?.name || "").toLowerCase().includes(q);
                }).map((friend) => {
                  const compatibility = getCompatibility(friend.friend.id);
                  const hasCompatibility = compatibility && 'overallCompatibility' in compatibility;
                  
                  return (
                    <Card key={friend.friendship.id} className="overflow-hidden">
                      <CardContent className="pt-6">
                        <div className="flex items-start gap-4">
                          <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                            <Users className="h-6 w-6 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              {friend.friend.isNpc ? (
                                <p className="font-medium truncate">{friend.friend.name || "名前未設定"}</p>
                              ) : (
                                <Link href={`/users/${friend.friend.id}`}>
                                  <p className="font-medium truncate hover:text-primary transition-colors cursor-pointer">{friend.friend.name || "名前未設定"}</p>
                                </Link>
                              )}
                              {friend.friend.isNpc && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">NPC</Badge>}
                            </div>
                            {friend.twin ? (
                              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                <Bot className="h-3 w-3" />
                                <span className="truncate">{friend.twin.name}</span>
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">分身AI未作成</p>
                            )}
                          </div>
                        </div>

                        {/* 相性表示 */}
                        {friend.twin && (
                          <div className="mt-4 pt-4 border-t">
                            {hasCompatibility ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <Heart className={`h-4 w-4 ${getCompatibilityColor(compatibility.overallCompatibility)}`} />
                                          <span className="text-sm font-medium">相性スコア</span>
                                        </div>
                                        <Badge variant="secondary" className={getCompatibilityColor(compatibility.overallCompatibility)}>
                                          {compatibility.overallCompatibility}%
                                        </Badge>
                                      </div>
                                      <Progress 
                                        value={compatibility.overallCompatibility} 
                                        className="h-2"
                                      />
                                      <p className={`text-xs text-center ${getCompatibilityColor(compatibility.overallCompatibility)}`}>
                                        {getCompatibilityLabel(compatibility.overallCompatibility)}
                                      </p>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" className="max-w-xs">
                                    <div className="space-y-2 text-sm">
                                      <div className="flex justify-between">
                                        <span>価値観の類似度:</span>
                                        <span className="font-medium">{compatibility.waveformSimilarity}%</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>徳の相性:</span>
                                        <span className="font-medium">{compatibility.virtueCompatibility}%</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>地雷回避度:</span>
                                        <span className="font-medium">{compatibility.mineCompatibility}%</span>
                                      </div>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : compatibility && !('overallCompatibility' in compatibility) ? (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <TrendingUp className="h-4 w-4" />
                                <span>波形データ収集中...</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Sparkles className="h-4 w-4" />
                                <span>波形を生成すると相性が表示されます</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* ブロックボタン */}
                        {!friend.friend.isNpc && (
                          <div className="mt-3 pt-3 border-t">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => {
                                if (confirm(`${friend.friend.name}さんをブロックしますか？友達関係も解除されます。`)) {
                                  blockMut.mutate({ userId: friend.friend.id });
                                }
                              }}
                              disabled={blockMut.isPending}
                            >
                              <Ban className="h-3.5 w-3.5 mr-1" />
                              ブロック
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
              </>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">友達がいません</h3>
                  <p className="text-muted-foreground mb-4">
                    友達コードを共有して、友達を追加しましょう
                  </p>
                  <Button onClick={() => setIsAddOpen(true)}>
                    <UserPlus className="h-4 w-4 mr-2" />
                    友達を追加
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="requests" className="mt-4">
            {requests && requests.length > 0 ? (
              <div className="space-y-3">
                {requests.map((request) => (
                  <Card key={request.friendship.id}>
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                            <Users className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{request.sender?.name || "名前未設定"}</p>
                            <p className="text-sm text-muted-foreground">友達リクエスト</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleAccept(request.friendship.id)}
                            disabled={acceptRequest.isPending}
                          >
                            <Check className="h-4 w-4 mr-1" />
                            承認
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleReject(request.friendship.id)}
                            disabled={rejectRequest.isPending}
                          >
                            <X className="h-4 w-4 mr-1" />
                            拒否
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <UserPlus className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">リクエストはありません</h3>
                  <p className="text-muted-foreground">
                    友達コードを共有すると、リクエストが届きます
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="blocked" className="mt-4">
            {blockedUsers && blockedUsers.length > 0 ? (
              <div className="space-y-3">
                {blockedUsers.map((b: any) => (
                  <Card key={b.blockedUserId}>
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{b.name || "名前未設定"}</p>
                          <p className="text-xs text-muted-foreground">{new Date(b.createdAt).toLocaleDateString('ja-JP')}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => unblockMut.mutate({ userId: b.blockedUserId })}
                          disabled={unblockMut.isPending}
                        >
                          <ShieldOff className="h-3.5 w-3.5 mr-1" />
                          解除
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">ブロックしているユーザーはいません</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
