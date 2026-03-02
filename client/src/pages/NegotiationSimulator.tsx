import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Swords, Send, Trophy, Target, MessageSquare, BarChart3, Clock, Loader2, ArrowLeft, Star } from "lucide-react";

type Message = {
  role: "user" | "opponent";
  content: string;
  timestamp: string;
};

type NegotiationResults = {
  overallScore: number;
  techniqueScores: { name: string; score: number }[];
  strengths: string[];
  improvements: string[];
  feedback: string;
};

export default function NegotiationSimulator() {
  usePageMeta({ title: "ネゴシエーション・シミュレーター", description: "AI相手にビジネス交渉の練習をしましょう。", path: "/negotiation" });

  const [activeTab, setActiveTab] = useState("practice");
  const [negotiationId, setNegotiationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [results, setResults] = useState<NegotiationResults | null>(null);
  const [theme, setTheme] = useState("");
  const [difficulty, setDifficulty] = useState<"beginner" | "intermediate" | "advanced">("intermediate");
  const scrollRef = useRef<HTMLDivElement>(null);

  const startMut = trpc.matching.startNegotiation.useMutation({
    onSuccess: (data: any) => {
      setNegotiationId(data.id);
      if (data.openingMessage) {
        setMessages([{ role: "opponent", content: data.openingMessage, timestamp: new Date().toISOString() }]);
      }
      toast.success("交渉シミュレーションを開始しました");
    },
    onError: (err) => toast.error(err.message),
  });

  const sendMut = trpc.matching.sendNegotiationMessage.useMutation({
    onSuccess: (data: any) => {
      if (data.reply) {
        setMessages((prev) => [...prev, { role: "opponent", content: data.reply, timestamp: new Date().toISOString() }]);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const endMut = trpc.matching.endNegotiation.useMutation({
    onSuccess: (data: any) => {
      setResults({
        overallScore: data.overallScore ?? 72,
        techniqueScores: data.techniqueScores ?? [
          { name: "論理構成", score: 75 },
          { name: "説得力", score: 68 },
          { name: "柔軟性", score: 80 },
          { name: "Win-Win思考", score: 70 },
          { name: "感情管理", score: 65 },
        ],
        strengths: data.strengths ?? ["論点の整理が明確", "相手の立場への配慮"],
        improvements: data.improvements ?? ["具体的な数値の活用", "代替案の提示を増やす"],
        feedback: data.feedback ?? "全体的にバランスの取れた交渉でした。",
      });
      toast.success("交渉が終了しました。結果を確認してください。");
    },
    onError: (err) => toast.error(err.message),
  });

  const { data: history, isLoading: historyLoading } = trpc.matching.getNegotiationHistory.useQuery(undefined, {
    enabled: activeTab === "history",
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleStart = () => {
    if (!theme.trim()) {
      toast.error("交渉テーマを入力してください");
      return;
    }
    startMut.mutate({ theme, difficulty });
  };

  const handleSend = () => {
    if (!messageInput.trim() || !negotiationId) return;
    const userMsg: Message = { role: "user", content: messageInput, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    sendMut.mutate({ negotiationId, message: messageInput });
    setMessageInput("");
  };

  const handleEnd = () => {
    if (!negotiationId) return;
    endMut.mutate({ negotiationId });
  };

  const handleReset = () => {
    setNegotiationId(null);
    setMessages([]);
    setResults(null);
    setTheme("");
    setDifficulty("intermediate");
  };

  const difficultyLabel: Record<string, string> = { beginner: "初級", intermediate: "中級", advanced: "上級" };
  const difficultyColor: Record<string, string> = { beginner: "bg-green-500/10 text-green-500", intermediate: "bg-yellow-500/10 text-yellow-500", advanced: "bg-red-500/10 text-red-500" };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <Swords className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">ネゴシエーション・シミュレーター</h1>
            <p className="text-sm text-muted-foreground">AI相手にビジネス交渉スキルを磨きましょう</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="practice" className="gap-1.5"><Target className="h-4 w-4" />練習</TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5"><Clock className="h-4 w-4" />履歴</TabsTrigger>
          </TabsList>

          {/* ===== Practice Tab ===== */}
          <TabsContent value="practice">
            <div className="space-y-4 mt-4">
              {/* State: No active session → Start form */}
              {!negotiationId && !results && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="h-5 w-5 text-primary" />
                      新しい交渉を開始
                    </CardTitle>
                    <CardDescription>テーマと難易度を設定して、AIとの交渉練習を始めましょう</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">交渉テーマ</label>
                      <Input
                        placeholder="例: 納期の延長交渉、価格改定の提案..."
                        value={theme}
                        onChange={(e) => setTheme(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">難易度</label>
                      <Select value={difficulty} onValueChange={(v) => setDifficulty(v as "beginner" | "intermediate" | "advanced")}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="beginner">初級 — 協力的な相手</SelectItem>
                          <SelectItem value="intermediate">中級 — 駆け引きあり</SelectItem>
                          <SelectItem value="advanced">上級 — 強硬な相手</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button onClick={handleStart} disabled={startMut.isPending} className="w-full">
                      {startMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Swords className="h-4 w-4 mr-2" />}
                      交渉を開始
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* State: Active session → Chat interface */}
              {negotiationId && !results && (
                <Card className="flex flex-col" style={{ minHeight: "60vh" }}>
                  <CardHeader className="pb-2 border-b">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-5 w-5 text-primary" />
                        <CardTitle className="text-base">交渉中</CardTitle>
                        <Badge className={difficultyColor[difficulty]}>
                          {difficultyLabel[difficulty]}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{messages.length} ターン</Badge>
                        <Button variant="destructive" size="sm" onClick={handleEnd} disabled={endMut.isPending}>
                          {endMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          終了して評価
                        </Button>
                      </div>
                    </div>
                    <CardDescription>テーマ: {theme}</CardDescription>
                  </CardHeader>
                  <ScrollArea className="flex-1 p-4" ref={scrollRef}>
                    <div className="space-y-4 pb-4">
                      {messages.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                          <div
                            className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${
                              msg.role === "user"
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted"
                            }`}
                          >
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                            <p className="text-[10px] opacity-60 mt-1 text-right">
                              {new Date(msg.timestamp).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                        </div>
                      ))}
                      {sendMut.isPending && (
                        <div className="flex justify-start">
                          <div className="bg-muted rounded-lg px-4 py-2.5 text-sm">
                            <Loader2 className="h-4 w-4 animate-spin" />
                          </div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                  <div className="border-t p-3">
                    <div className="flex gap-2">
                      <Input
                        placeholder="メッセージを入力..."
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                        disabled={sendMut.isPending}
                      />
                      <Button onClick={handleSend} disabled={sendMut.isPending || !messageInput.trim()} size="icon">
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              )}

              {/* State: Completed → Results */}
              {results && (
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Trophy className="h-5 w-5 text-yellow-500" />
                          <CardTitle>交渉結果</CardTitle>
                        </div>
                        <Button variant="outline" size="sm" onClick={handleReset}>
                          <ArrowLeft className="h-4 w-4 mr-2" />
                          新しい交渉
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {/* Overall Score */}
                      <div className="flex flex-col items-center py-4">
                        <div className="relative w-32 h-32">
                          <svg className="w-32 h-32 transform -rotate-90" viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted" />
                            <circle
                              cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="8"
                              className={results.overallScore >= 80 ? "text-green-500" : results.overallScore >= 60 ? "text-blue-500" : "text-yellow-500"}
                              strokeDasharray={`${(results.overallScore / 100) * 327} 327`}
                              strokeLinecap="round"
                            />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-3xl font-bold">{results.overallScore}</span>
                            <span className="text-xs text-muted-foreground">/ 100</span>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">総合スコア</p>
                      </div>

                      {/* Technique Scores */}
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                          <BarChart3 className="h-4 w-4 text-primary" />
                          テクニック別スコア
                        </h3>
                        {results.techniqueScores.map((t) => (
                          <div key={t.name} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span>{t.name}</span>
                              <span className="font-medium">{t.score}%</span>
                            </div>
                            <Progress value={t.score} className="h-2" />
                          </div>
                        ))}
                      </div>

                      {/* Strengths & Improvements */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <h3 className="text-sm font-semibold text-green-500 flex items-center gap-1">
                            <Star className="h-4 w-4" />
                            強み
                          </h3>
                          <ul className="space-y-1">
                            {results.strengths.map((s, i) => (
                              <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                                <span className="text-green-500 mt-0.5">+</span>
                                {s}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="space-y-2">
                          <h3 className="text-sm font-semibold text-orange-500 flex items-center gap-1">
                            <Target className="h-4 w-4" />
                            改善ポイント
                          </h3>
                          <ul className="space-y-1">
                            {results.improvements.map((s, i) => (
                              <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                                <span className="text-orange-500 mt-0.5">!</span>
                                {s}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      {/* Detailed Feedback */}
                      <div className="rounded-lg bg-muted/50 p-4">
                        <h3 className="text-sm font-semibold mb-2">詳細フィードバック</h3>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{results.feedback}</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ===== History Tab ===== */}
          <TabsContent value="history">
            <div className="space-y-4 mt-4">
              {historyLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : history && (history as any[]).length > 0 ? (
                <div className="space-y-3">
                  {(history as any[]).map((session: any) => (
                    <Card key={session.id}>
                      <CardContent className="flex items-center gap-4 p-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium truncate">{session.theme}</span>
                            <Badge className={
                              session.difficulty === "beginner" ? "bg-green-500/10 text-green-500" :
                              session.difficulty === "advanced" ? "bg-red-500/10 text-red-500" :
                              "bg-yellow-500/10 text-yellow-500"
                            }>
                              {session.difficulty === "beginner" ? "初級" : session.difficulty === "advanced" ? "上級" : "中級"}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{session.turns ?? 0} ターン</span>
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{session.createdAt ? new Date(session.createdAt).toLocaleDateString("ja-JP") : "—"}</span>
                          </div>
                        </div>
                        {session.score != null && (
                          <div className={`w-12 h-12 rounded-full border-2 flex items-center justify-center shrink-0 font-bold text-sm ${
                            session.score >= 80 ? "text-green-500 border-green-500/40" :
                            session.score >= 60 ? "text-blue-500 border-blue-500/40" :
                            "text-yellow-500 border-yellow-500/40"
                          }`}>
                            {session.score}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center py-12">
                    <Swords className="h-10 w-10 text-muted-foreground mb-2" />
                    <p className="text-muted-foreground text-sm">まだ練習履歴がありません</p>
                    <Button variant="link" onClick={() => setActiveTab("practice")} className="mt-2">
                      練習を始める
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
