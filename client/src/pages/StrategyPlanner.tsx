import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { Map, Target, AlertTriangle, CheckCircle, Lightbulb, Loader2, Save, MessageSquare, Star, ArrowRight } from "lucide-react";

export default function StrategyPlanner() {
  usePageMeta({ title: "戦略プランナー", description: "AIがマッチング前の戦略を立案", path: "/strategy" });

  const [activeTab, setActiveTab] = useState("plan");
  const [selectedFriendId, setSelectedFriendId] = useState<string>("");
  const [theme, setTheme] = useState("");
  const [notes, setNotes] = useState("");
  const [strategy, setStrategy] = useState<any>(null);
  const [reviewResult, setReviewResult] = useState<any>(null);

  // Review tab state
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [effectiveness, setEffectiveness] = useState<string>("");

  // Queries
  const { data: friendsData, isLoading: friendsLoading } = trpc.friends.list.useQuery();
  const { data: sessionsData } = trpc.matching.sessions.useQuery();
  const { data: savedStrategy, isLoading: strategyLoading } = trpc.matching.getStrategy.useQuery(
    { friendId: parseInt(selectedFriendId) },
    { enabled: !!selectedFriendId }
  );

  // Mutations
  const generateMut = trpc.matching.generateStrategy.useMutation();
  const saveNoteMut = trpc.matching.saveStrategyNote.useMutation();
  const reviewMut = trpc.matching.reviewStrategy.useMutation();

  const friends = (friendsData as any)?.friends ?? friendsData ?? [];
  const sessions = (sessionsData as any) ?? [];
  const completedSessions = sessions.filter((s: any) => s.status === "completed");

  // Load saved strategy when friend changes
  const loadedStrategy = (savedStrategy as any)?.strategy ?? null;

  const handleGenerate = async () => {
    if (!selectedFriendId) {
      toast.error("友達を選択してください");
      return;
    }
    try {
      const result = await generateMut.mutateAsync({
        friendId: parseInt(selectedFriendId),
        theme: theme || undefined,
      });
      setStrategy(result);
      toast.success("戦略を生成しました");
    } catch (e: any) {
      toast.error(e.message || "戦略生成に失敗しました");
    }
  };

  const handleSaveNote = async () => {
    if (!selectedFriendId || !notes.trim()) {
      toast.error("友達を選択し、メモを入力してください");
      return;
    }
    try {
      await saveNoteMut.mutateAsync({
        strategyId: parseInt(selectedFriendId),
        note: notes,
      });
      toast.success("メモを保存しました");
    } catch (e: any) {
      toast.error(e.message || "メモ保存に失敗しました");
    }
  };

  const handleReview = async () => {
    if (!selectedStrategyId || !selectedSessionId || !effectiveness) {
      toast.error("すべての項目を入力してください");
      return;
    }
    try {
      const result = await reviewMut.mutateAsync({
        strategyId: parseInt(selectedStrategyId),
        sessionId: parseInt(selectedSessionId),
        effectiveness: effectiveness as "excellent" | "good" | "neutral" | "poor",
      });
      setReviewResult(result);
      toast.success("振り返りを完了しました");
    } catch (e: any) {
      toast.error(e.message || "振り返りに失敗しました");
    }
  };

  const currentStrategy = strategy || loadedStrategy;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Map className="h-6 w-6 text-blue-500" />
            AIマッチング戦略プランナー
          </h1>
          <p className="text-muted-foreground mt-1">
            マッチング前にAIが相手に合わせた最適な戦略を立案します
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="plan">
              <Target className="h-4 w-4 mr-1" />
              戦略立案
            </TabsTrigger>
            <TabsTrigger value="review">
              <Star className="h-4 w-4 mr-1" />
              振り返り
            </TabsTrigger>
          </TabsList>

          {/* Plan Tab */}
          <TabsContent value="plan" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">戦略を生成</CardTitle>
                <CardDescription>マッチング相手を選択してAIに戦略を立案してもらいましょう</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">マッチング相手</label>
                    <Select value={selectedFriendId} onValueChange={setSelectedFriendId}>
                      <SelectTrigger>
                        <SelectValue placeholder={friendsLoading ? "読み込み中..." : "友達を選択"} />
                      </SelectTrigger>
                      <SelectContent>
                        {friends.map((f: any) => (
                          <SelectItem key={f.friendId || f.id} value={String(f.friendId || f.id)}>
                            {f.displayName || f.name || `ユーザー #${f.friendId || f.id}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">テーマ（任意）</label>
                    <Input
                      placeholder="例: AI事業の共同開発について"
                      value={theme}
                      onChange={(e) => setTheme(e.target.value)}
                    />
                  </div>
                </div>
                <Button onClick={handleGenerate} disabled={generateMut.isPending || !selectedFriendId}>
                  {generateMut.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</>
                  ) : (
                    <><Lightbulb className="h-4 w-4 mr-2" />戦略を生成</>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Loading */}
            {strategyLoading && selectedFriendId && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Strategy Display */}
            {currentStrategy && (
              <div className="space-y-4">
                {/* Approach */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-blue-500" />
                      アプローチ
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed">{currentStrategy.approach}</p>
                  </CardContent>
                </Card>

                {/* Opening Strategy */}
                {currentStrategy.openingStrategy && (
                  <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <ArrowRight className="h-5 w-5 text-blue-600" />
                        オープニング戦略
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-relaxed font-medium">{currentStrategy.openingStrategy}</p>
                    </CardContent>
                  </Card>
                )}

                {/* Emphasize & Avoid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        強調すべきポイント
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                      {(currentStrategy.emphasize ?? []).map((item: string, i: number) => (
                        <Badge key={i} variant="outline" className="bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 border-green-200">
                          {item}
                        </Badge>
                      ))}
                      {(!currentStrategy.emphasize || currentStrategy.emphasize.length === 0) && (
                        <p className="text-sm text-muted-foreground">データなし</p>
                      )}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                        避けるべきトピック
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                      {(currentStrategy.avoid ?? []).map((item: string, i: number) => (
                        <Badge key={i} variant="outline" className="bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400 border-red-200">
                          {item}
                        </Badge>
                      ))}
                      {(!currentStrategy.avoid || currentStrategy.avoid.length === 0) && (
                        <p className="text-sm text-muted-foreground">データなし</p>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Key Points */}
                {currentStrategy.keyPoints && currentStrategy.keyPoints.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Target className="h-4 w-4 text-purple-500" />
                        キーポイント
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ol className="list-decimal list-inside space-y-2">
                        {currentStrategy.keyPoints.map((point: string, i: number) => (
                          <li key={i} className="text-sm">{point}</li>
                        ))}
                      </ol>
                    </CardContent>
                  </Card>
                )}

                {/* Predicted Challenges */}
                {currentStrategy.predictedChallenges && currentStrategy.predictedChallenges.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        想定される課題
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {currentStrategy.predictedChallenges.map((challenge: string, i: number) => (
                          <li key={i} className="text-sm flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                            {challenge}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Confidence Level */}
                {currentStrategy.confidenceLevel != null && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">信頼度</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">AI分析の信頼度</span>
                        <span className="font-medium">{currentStrategy.confidenceLevel}%</span>
                      </div>
                      <Progress value={currentStrategy.confidenceLevel} className="h-2" />
                    </CardContent>
                  </Card>
                )}

                {/* Notes */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Save className="h-4 w-4" />
                      メモ
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Textarea
                      placeholder="戦略に関するメモを記入..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={4}
                    />
                    <Button size="sm" onClick={handleSaveNote} disabled={saveNoteMut.isPending}>
                      {saveNoteMut.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-1 animate-spin" />保存中...</>
                      ) : (
                        <><Save className="h-4 w-4 mr-1" />メモを保存</>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Empty state */}
            {!currentStrategy && !strategyLoading && (
              <Card>
                <CardContent className="py-12 text-center">
                  <Map className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">友達を選択して戦略を生成してください</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Review Tab */}
          <TabsContent value="review" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">マッチング振り返り</CardTitle>
                <CardDescription>実施したマッチングの戦略効果を振り返り、次回に活かしましょう</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">戦略</label>
                    <Select value={selectedStrategyId} onValueChange={setSelectedStrategyId}>
                      <SelectTrigger>
                        <SelectValue placeholder="生成済み戦略を選択" />
                      </SelectTrigger>
                      <SelectContent>
                        {friends.map((f: any) => (
                          <SelectItem key={f.friendId || f.id} value={String(f.friendId || f.id)}>
                            {f.displayName || f.name || `ユーザー #${f.friendId || f.id}`} の戦略
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">マッチングセッション</label>
                    <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
                      <SelectTrigger>
                        <SelectValue placeholder="完了済みセッションを選択" />
                      </SelectTrigger>
                      <SelectContent>
                        {completedSessions.map((s: any) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.theme || `セッション #${s.id}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">効果の自己評価</label>
                  <Select value={effectiveness} onValueChange={setEffectiveness}>
                    <SelectTrigger className="w-[240px]">
                      <SelectValue placeholder="効果を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="excellent">素晴らしい</SelectItem>
                      <SelectItem value="good">良い</SelectItem>
                      <SelectItem value="average">普通</SelectItem>
                      <SelectItem value="poor">不十分</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleReview} disabled={reviewMut.isPending}>
                  {reviewMut.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />分析中...</>
                  ) : (
                    <><Star className="h-4 w-4 mr-2" />振り返りを実行</>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Review Results */}
            {reviewResult && (
              <div className="space-y-4">
                {/* Effectiveness Score */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">戦略効果スコア</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">効果</span>
                      <span className="font-bold text-lg">{reviewResult.effectivenessScore ?? 0}/100</span>
                    </div>
                    <Progress value={reviewResult.effectivenessScore ?? 0} className="h-3" />
                  </CardContent>
                </Card>

                {/* What Worked / Didn't */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        うまくいった点
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {(reviewResult.whatWorked ?? []).map((item: string, i: number) => (
                          <li key={i} className="text-sm flex items-start gap-2">
                            <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                        改善が必要な点
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {(reviewResult.whatDidnt ?? []).map((item: string, i: number) => (
                          <li key={i} className="text-sm flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>

                {/* Lessons Learned */}
                {reviewResult.lessonsLearned && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Lightbulb className="h-4 w-4 text-yellow-500" />
                        学んだこと
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-relaxed">{reviewResult.lessonsLearned}</p>
                    </CardContent>
                  </Card>
                )}

                {/* Next Time Advice */}
                {reviewResult.nextTimeAdvice && (
                  <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <ArrowRight className="h-5 w-5 text-blue-600" />
                        次回へのアドバイス
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-relaxed font-medium">{reviewResult.nextTimeAdvice}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Empty state */}
            {!reviewResult && (
              <Card>
                <CardContent className="py-12 text-center">
                  <Star className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">戦略とセッションを選択して振り返りを実行してください</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
