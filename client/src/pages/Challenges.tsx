import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { Trophy, Users, Plus, Medal, Clock, Target, Star, Loader2, Crown, Flame } from "lucide-react";

export default function Challenges() {
  const { t } = useTranslation();
  usePageMeta({ title: t("challenges.title"), description: t("challenges.description"), path: "/challenges" });

  const [activeTab, setActiveTab] = useState("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [newTheme, setNewTheme] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [selectedChallengeId, setSelectedChallengeId] = useState<string>("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [showCompleted, setShowCompleted] = useState(false);

  // Data
  const { data: challengesData, isLoading: challengesLoading, refetch: refetchChallenges } = trpc.matching.listChallenges.useQuery();
  const { data: leaderboardData, isLoading: leaderboardLoading } = trpc.matching.getChallengeLeaderboard.useQuery(
    { challengeId: parseInt(selectedChallengeId) },
    { enabled: activeTab === "leaderboard" && !!selectedChallengeId }
  );

  // Mutations
  const createChallengeMut = trpc.matching.createChallenge.useMutation();
  const joinChallengeMut = trpc.matching.joinChallenge.useMutation();
  const submitResultMut = trpc.matching.submitChallengeResult.useMutation();

  const challenges = (challengesData as any)?.challenges ?? [];
  const activeChallenges = challenges.filter((c: any) => c.status === "active");
  const completedChallenges = challenges.filter((c: any) => c.status === "completed");
  const leaderboard = (leaderboardData as any)?.entries ?? [];

  const handleCreate = async () => {
    if (!newTheme.trim()) {
      toast.error("テーマを入力してください");
      return;
    }
    try {
      await createChallengeMut.mutateAsync({ theme: newTheme, description: newDescription });
      toast.success("チャレンジを作成しました");
      setNewTheme("");
      setNewDescription("");
      setCreateOpen(false);
      refetchChallenges();
    } catch (e: any) {
      toast.error(e.message || "作成に失敗しました");
    }
  };

  const handleJoin = async (challengeId: number) => {
    try {
      await joinChallengeMut.mutateAsync({ challengeId });
      toast.success("チャレンジに参加しました");
      refetchChallenges();
    } catch (e: any) {
      toast.error(e.message || "参加に失敗しました");
    }
  };

  const handleSubmitResult = async () => {
    if (!selectedChallengeId || !selectedSessionId) {
      toast.error("チャレンジとセッションを選択してください");
      return;
    }
    try {
      await submitResultMut.mutateAsync({
        challengeId: parseInt(selectedChallengeId),
        sessionId: parseInt(selectedSessionId),
      });
      toast.success("結果を提出しました");
      setSubmitOpen(false);
      setSelectedSessionId("");
      refetchChallenges();
    } catch (e: any) {
      toast.error(e.message || "提出に失敗しました");
    }
  };

  const formatTimeRemaining = (endDate: string) => {
    const end = new Date(endDate);
    const now = new Date();
    const diff = end.getTime() - now.getTime();
    if (diff <= 0) return "終了";
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `残り${days}日${hours}時間`;
    return `残り${hours}時間`;
  };

  const getRankDisplay = (rank: number) => {
    if (rank === 1) return <span className="text-lg">🥇</span>;
    if (rank === 2) return <span className="text-lg">🥈</span>;
    if (rank === 3) return <span className="text-lg">🥉</span>;
    return <span className="text-sm font-medium text-muted-foreground">{rank}</span>;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Trophy className="h-6 w-6 text-primary" />
              {t("challenges.title")}
            </h1>
            <p className="text-muted-foreground mt-1">{t("challenges.description")}</p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                新規チャレンジ
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新規チャレンジを作成</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <label className="text-sm font-medium mb-1 block">テーマ</label>
                  <Input
                    value={newTheme}
                    onChange={(e) => setNewTheme(e.target.value)}
                    placeholder="例: AI活用ビジネスマッチング"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">説明</label>
                  <Textarea
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="チャレンジの詳細説明..."
                    className="min-h-[80px]"
                  />
                </div>
                <Button onClick={handleCreate} disabled={createChallengeMut.isPending} className="w-full">
                  {createChallengeMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Trophy className="h-4 w-4 mr-2" />
                  )}
                  作成
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="list">{t("challenges.title")}</TabsTrigger>
            <TabsTrigger value="leaderboard">{t("challenges.leaderboard")}</TabsTrigger>
          </TabsList>

          {/* Challenge List Tab */}
          <TabsContent value="list" className="space-y-4">
            {challengesLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : activeChallenges.length === 0 && completedChallenges.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Trophy className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">まだチャレンジがありません</p>
                  <p className="text-sm text-muted-foreground mt-1">「新規チャレンジ」ボタンで作成しましょう</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Active Challenges */}
                {activeChallenges.length > 0 && (
                  <div className="space-y-3">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <Flame className="h-5 w-5 text-orange-500" />
                      {t("challenges.active")} ({activeChallenges.length})
                    </h2>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {activeChallenges.map((c: any) => (
                        <Card key={c.id} className="hover:shadow-md transition-shadow">
                          <CardHeader className="pb-3">
                            <div className="flex items-start justify-between">
                              <CardTitle className="text-base">{c.theme}</CardTitle>
                              {c.endDate && (
                                <Badge variant="outline" className="text-xs flex-shrink-0">
                                  <Clock className="h-3 w-3 mr-1" />
                                  {formatTimeRemaining(c.endDate)}
                                </Badge>
                              )}
                            </div>
                            {c.description && (
                              <CardDescription className="text-xs">{c.description}</CardDescription>
                            )}
                          </CardHeader>
                          <CardContent>
                            <div className="flex items-center justify-between text-sm mb-3">
                              <div className="flex items-center gap-3">
                                <span className="flex items-center gap-1 text-muted-foreground">
                                  <Users className="h-3.5 w-3.5" />
                                  {c.participantCount ?? 0} {t("challenges.participants")}
                                </span>
                                {c.topScore != null && (
                                  <span className="flex items-center gap-1 text-muted-foreground">
                                    <Star className="h-3.5 w-3.5 text-yellow-500" />
                                    {c.topScore}%
                                  </span>
                                )}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              className="w-full"
                              onClick={() => handleJoin(c.id)}
                              disabled={joinChallengeMut.isPending || c.joined}
                              variant={c.joined ? "secondary" : "default"}
                            >
                              {joinChallengeMut.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                              ) : c.joined ? (
                                <Target className="h-4 w-4 mr-1" />
                              ) : (
                                <Medal className="h-4 w-4 mr-1" />
                              )}
                              {c.joined ? "参加中" : "参加"}
                            </Button>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Completed Challenges */}
                {completedChallenges.length > 0 && (
                  <div className="space-y-3">
                    <button
                      onClick={() => setShowCompleted(!showCompleted)}
                      className="text-lg font-semibold flex items-center gap-2 hover:text-primary transition-colors"
                    >
                      <Trophy className="h-5 w-5 text-muted-foreground" />
                      {t("challenges.ended")} ({completedChallenges.length})
                      <span className="text-xs text-muted-foreground">{showCompleted ? "▲" : "▼"}</span>
                    </button>
                    {showCompleted && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        {completedChallenges.map((c: any) => (
                          <Card key={c.id} className="opacity-75">
                            <CardHeader className="pb-3">
                              <div className="flex items-start justify-between">
                                <CardTitle className="text-base">{c.theme}</CardTitle>
                                <Badge variant="secondary" className="text-xs">完了</Badge>
                              </div>
                              {c.description && (
                                <CardDescription className="text-xs">{c.description}</CardDescription>
                              )}
                            </CardHeader>
                            <CardContent>
                              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Users className="h-3.5 w-3.5" />
                                  {c.participantCount ?? 0} {t("challenges.participants")}
                                </span>
                                {c.topScore != null && (
                                  <span className="flex items-center gap-1">
                                    <Crown className="h-3.5 w-3.5 text-yellow-500" />
                                    最高: {c.topScore}%
                                  </span>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* Leaderboard Tab */}
          <TabsContent value="leaderboard" className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <Select value={selectedChallengeId} onValueChange={setSelectedChallengeId}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="チャレンジを選択" />
                </SelectTrigger>
                <SelectContent>
                  {challenges.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.theme}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={!selectedChallengeId}>
                    <Target className="h-4 w-4 mr-1" />
                    結果を提出
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>結果を提出</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div>
                      <label className="text-sm font-medium mb-1 block">マッチングセッション</label>
                      <Input
                        type="number"
                        value={selectedSessionId}
                        onChange={(e) => setSelectedSessionId(e.target.value)}
                        placeholder="セッションIDを入力"
                      />
                    </div>
                    <Button onClick={handleSubmitResult} disabled={submitResultMut.isPending} className="w-full">
                      {submitResultMut.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Medal className="h-4 w-4 mr-2" />
                      )}
                      提出
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {!selectedChallengeId ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Medal className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">チャレンジを選択してリーダーボードを表示</p>
                </CardContent>
              </Card>
            ) : leaderboardLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : leaderboard.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">まだ結果がありません</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-4">
                  <div className="space-y-2">
                    {/* Header */}
                    <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium text-muted-foreground border-b">
                      <div className="col-span-1 text-center">順位</div>
                      <div className="col-span-5">名前</div>
                      <div className="col-span-3 text-center">スコア</div>
                      <div className="col-span-3 text-right">提出日</div>
                    </div>
                    {/* Rows */}
                    {leaderboard.map((entry: any, i: number) => (
                      <div
                        key={i}
                        className={`grid grid-cols-12 gap-2 px-3 py-2 rounded-lg items-center ${
                          i < 3 ? "bg-primary/5" : "hover:bg-muted/50"
                        }`}
                      >
                        <div className="col-span-1 text-center">
                          {getRankDisplay(entry.rank ?? i + 1)}
                        </div>
                        <div className="col-span-5 flex items-center gap-2">
                          {entry.avatarUrl ? (
                            <img src={entry.avatarUrl} alt="アバター" className="h-7 w-7 rounded-full object-cover" loading="lazy" decoding="async" />
                          ) : (
                            <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                              {(entry.name ?? "?")[0]}
                            </div>
                          )}
                          <span className="text-sm font-medium truncate">{entry.name ?? "匿名"}</span>
                        </div>
                        <div className="col-span-3 text-center">
                          <Badge variant={i < 3 ? "default" : "secondary"} className="text-xs">
                            {entry.score}%
                          </Badge>
                        </div>
                        <div className="col-span-3 text-right text-xs text-muted-foreground">
                          {entry.submittedAt ? new Date(entry.submittedAt).toLocaleDateString("ja-JP") : "-"}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
