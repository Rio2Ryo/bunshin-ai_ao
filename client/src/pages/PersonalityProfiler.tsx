import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useState, useRef, useEffect, useCallback } from "react";
import { Brain, MessageSquare, BarChart3, Users, Loader2, Send, CheckCircle } from "lucide-react";
import { RadarChart } from "@/components/RadarChart";
import { toast } from "sonner";

const BIG_FIVE_LABELS: Record<string, string> = {
  openness: "開放性",
  conscientiousness: "誠実性",
  extraversion: "外向性",
  agreeableness: "協調性",
  neuroticism: "神経質性",
};

export default function PersonalityProfiler() {
  usePageMeta({ title: "AI人格プロファイラー", description: "AIとの対話でパーソナリティを分析。Big Five、MBTI、価値観プロフィールを一括診断します。", path: "/personality" });

  const { data: session, refetch: refetchSession } = trpc.personalityProfiler.getSession.useQuery(undefined, { staleTime: 10_000 });
  const { data: results } = trpc.personalityProfiler.getResults.useQuery(undefined, { staleTime: 60_000 });
  const { data: friends } = trpc.friends.list.useQuery(undefined, { staleTime: 30_000 });
  const answerMutation = trpc.personalityProfiler.answer.useMutation();

  const [message, setMessage] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [selectedFriendId, setSelectedFriendId] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initialize chat messages from session
  useEffect(() => {
    if (session?.interviewLog) {
      try {
        const log = typeof session.interviewLog === "string" ? JSON.parse(session.interviewLog) : session.interviewLog;
        if (Array.isArray(log)) setChatMessages(log);
      } catch {}
    }
    if (session?.status === "completed") setIsComplete(true);
  }, [session]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleSend = useCallback(async () => {
    if (!message.trim() || answerMutation.isPending) return;
    const userMsg = message.trim();
    setMessage("");

    setChatMessages(prev => [...prev, { role: "user", content: userMsg }]);

    try {
      const result = await answerMutation.mutateAsync({
        sessionId: session?.id ?? 0,
        content: userMsg,
      });

      if (result.aiResponse) {
        setChatMessages(prev => [...prev, { role: "assistant", content: result.aiResponse }]);
      }
      if (result.isComplete) {
        setIsComplete(true);
        refetchSession();
        toast.success("パーソナリティ分析が完了しました！");
      }
    } catch (err: any) {
      toast.error(err.message || "送信に失敗しました");
    }
  }, [message, session?.id, answerMutation, refetchSession]);

  // Get comparison data
  const { data: compatibility } = trpc.personalityProfiler.getCompatibility.useQuery(
    { friendId: parseInt(selectedFriendId) },
    { enabled: !!selectedFriendId && selectedFriendId !== "" }
  );

  const hasResults = results && results.bigFive;
  const bigFiveData = hasResults
    ? Object.entries(results.bigFive).map(([key, value]) => ({
        trait: BIG_FIVE_LABELS[key] || key,
        value: value as number,
      }))
    : [];

  const compareBigFive = compatibility?.friendBigFive
    ? Object.entries(compatibility.friendBigFive).map(([key, value]) => ({
        trait: BIG_FIVE_LABELS[key] || key,
        value: value as number,
      }))
    : undefined;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            AI人格プロファイラー
          </h1>
          <p className="text-muted-foreground mt-1">AIとの対話でBig Five、MBTI、価値観を一括診断</p>
        </div>

        <Tabs defaultValue={hasResults ? "results" : "interview"}>
          <TabsList>
            <TabsTrigger value="interview">
              <MessageSquare className="h-4 w-4 mr-2" />
              診断インタビュー
            </TabsTrigger>
            <TabsTrigger value="results" disabled={!hasResults}>
              <BarChart3 className="h-4 w-4 mr-2" />
              結果
            </TabsTrigger>
            <TabsTrigger value="compare" disabled={!hasResults}>
              <Users className="h-4 w-4 mr-2" />
              比較
            </TabsTrigger>
          </TabsList>

          {/* Interview Tab */}
          <TabsContent value="interview">
            <Card>
              <CardHeader>
                <CardTitle>パーソナリティ診断</CardTitle>
                <CardDescription>
                  {isComplete
                    ? "診断が完了しました。結果タブで確認できます。"
                    : "AIの質問に答えて、あなたのパーソナリティを分析します（約15問）"}
                </CardDescription>
                {!isComplete && session && (
                  <Progress value={(chatMessages.filter(m => m.role === "user").length / 15) * 100} className="h-1.5 mt-2" />
                )}
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px] pr-4" ref={scrollRef}>
                  <div className="space-y-4">
                    {chatMessages.length === 0 && !isComplete && (
                      <div className="text-center py-8">
                        <Brain className="h-12 w-12 mx-auto text-primary/50 mb-4" />
                        <p className="text-muted-foreground mb-4">「開始」ボタンを押して診断を始めましょう</p>
                        <Button onClick={() => {
                          setChatMessages([{ role: "assistant", content: "こんにちは！パーソナリティ診断を始めましょう。あなたのことをいくつか質問させてください。\n\nまず、新しい環境や未知の体験に対してどのように感じますか？ワクワクしますか、それとも慎重になりますか？具体的なエピソードがあれば教えてください。" }]);
                        }}>
                          診断を開始
                        </Button>
                      </div>
                    )}
                    {chatMessages.map((msg, i) => (
                      <div
                        key={i}
                        className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                      >
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === "user" ? "bg-primary/20" : "bg-muted"}`}>
                          {msg.role === "user" ? "You" : <Brain className="h-4 w-4" />}
                        </div>
                        <div className={`max-w-[80%] rounded-lg p-3 ${msg.role === "user" ? "bg-primary/10" : "bg-muted"}`}>
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      </div>
                    ))}
                    {answerMutation.isPending && (
                      <div className="flex gap-3">
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <Brain className="h-4 w-4" />
                        </div>
                        <div className="flex items-center gap-1 px-3 py-2 rounded-lg bg-muted">
                          <span className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    )}
                    {isComplete && (
                      <div className="text-center py-4">
                        <CheckCircle className="h-8 w-8 mx-auto text-green-500 mb-2" />
                        <p className="text-sm font-medium">診断完了！</p>
                        <p className="text-xs text-muted-foreground">「結果」タブで分析を確認できます</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
                {!isComplete && chatMessages.length > 0 && (
                  <div className="flex gap-2 mt-4">
                    <Input
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="回答を入力..."
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                      disabled={answerMutation.isPending}
                    />
                    <Button onClick={handleSend} disabled={answerMutation.isPending || !message.trim()}>
                      {answerMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Results Tab */}
          <TabsContent value="results">
            {hasResults && (
              <div className="grid gap-6 md:grid-cols-2">
                {/* Big Five Radar */}
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle>Big Five パーソナリティ</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <RadarChart data={bigFiveData} />
                  </CardContent>
                </Card>

                {/* MBTI */}
                <Card>
                  <CardHeader>
                    <CardTitle>MBTI タイプ</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center">
                      <span className="text-4xl font-bold text-primary">{results.mbti || "?"}</span>
                      {results.mbtiScores && (
                        <div className="mt-4 space-y-3">
                          {Object.entries(results.mbtiScores as Record<string, number>).map(([axis, score]) => {
                            const labels: Record<string, [string, string]> = {
                              ei: ["内向 (I)", "外向 (E)"],
                              sn: ["感覚 (S)", "直感 (N)"],
                              tf: ["思考 (T)", "感情 (F)"],
                              jp: ["判断 (J)", "知覚 (P)"],
                            };
                            const [left, right] = labels[axis] || [axis, axis];
                            return (
                              <div key={axis}>
                                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                                  <span>{left}</span>
                                  <span>{right}</span>
                                </div>
                                <Progress value={score} className="h-2" />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Value Profile */}
                <Card>
                  <CardHeader>
                    <CardTitle>価値観プロフィール</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {results.valueProfile ? (
                      <div className="space-y-3">
                        {Object.entries(results.valueProfile as Record<string, number>).map(([key, value]) => (
                          <div key={key}>
                            <div className="flex justify-between text-sm mb-1">
                              <span>{key}</span>
                              <span className="font-medium">{value}</span>
                            </div>
                            <Progress value={value} className="h-2" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-center py-4">データなし</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* Compare Tab */}
          <TabsContent value="compare">
            <Card>
              <CardHeader>
                <CardTitle>友達と比較</CardTitle>
                <CardDescription>パーソナリティの違いと互換性を確認</CardDescription>
              </CardHeader>
              <CardContent>
                <Select value={selectedFriendId} onValueChange={setSelectedFriendId}>
                  <SelectTrigger className="w-full mb-6">
                    <SelectValue placeholder="比較する友達を選択..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(friends ?? []).map((f: any) => (
                      <SelectItem key={f.id || f.friendId} value={String(f.friendId || f.id)}>
                        {f.friendName || f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {compareBigFive && (
                  <div className="space-y-6">
                    <RadarChart
                      data={bigFiveData}
                      compareData={compareBigFive}
                      userName="自分"
                      compareName={compatibility?.friendName || "友達"}
                    />
                    {compatibility?.compatibilityScore != null && (
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground mb-2">パーソナリティ互換性</p>
                        <span className="text-3xl font-bold text-primary">{compatibility.compatibilityScore}%</span>
                        {compatibility.summary && (
                          <p className="text-sm text-muted-foreground mt-2">{compatibility.summary}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {!selectedFriendId && (
                  <p className="text-center text-muted-foreground py-8">友達を選択して比較を開始してください</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
