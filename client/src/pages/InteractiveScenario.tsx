import { useState, useRef, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Swords, Shield, Handshake, Lightbulb, BarChart3, Clock, Play, CheckCircle, Loader2 } from "lucide-react";

interface DialogueMessage {
  role: "twin" | "opponent";
  content: string;
  strategy?: string;
}

const STRATEGY_CONFIG = {
  aggressive: { icon: Swords, label: "🗡️ 攻め", color: "bg-red-600 hover:bg-red-700 text-white" },
  defensive: { icon: Shield, label: "🛡️ 守り", color: "bg-blue-600 hover:bg-blue-700 text-white" },
  compromise: { icon: Handshake, label: "🤝 妥協", color: "bg-green-600 hover:bg-green-700 text-white" },
  propose: { icon: Lightbulb, label: "💡 提案", color: "bg-purple-600 hover:bg-purple-700 text-white" },
} as const;

type StrategyKey = keyof typeof STRATEGY_CONFIG;

export default function InteractiveScenario() {
  usePageMeta({ title: "交渉シナリオ", description: "インタラクティブ交渉シミュレーション", path: "/interactive-scenario" });

  const [activeTab, setActiveTab] = useState("execute");
  const [theme, setTheme] = useState("");
  const [selectedFriend, setSelectedFriend] = useState<string>("");
  const [activeScenarioId, setActiveScenarioId] = useState<number | null>(null);
  const [dialogue, setDialogue] = useState<DialogueMessage[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [isAnalyzed, setIsAnalyzed] = useState(false);
  const dialogueEndRef = useRef<HTMLDivElement>(null);

  const friendsQuery = trpc.friends.list.useQuery();
  const scenarioListQuery = trpc.matching.listInteractiveScenarios.useQuery();
  const scenarioQuery = trpc.matching.getInteractiveScenario.useQuery(
    { scenarioId: activeScenarioId! },
    { enabled: !!activeScenarioId }
  );

  const createMutation = trpc.matching.createInteractiveScenario.useMutation({
    onSuccess: (data: any) => {
      setActiveScenarioId(data.id ?? data.scenarioId);
      if (data.dialogue) {
        setDialogue(data.dialogue);
      }
      toast.success("シナリオを作成しました");
    },
    onError: (err: any) => toast.error(err.message || "作成に失敗しました"),
  });

  const respondMutation = trpc.matching.respondInteractiveScenario.useMutation({
    onSuccess: (data: any) => {
      if (data.dialogue) {
        setDialogue(data.dialogue);
      }
      setTurnCount((prev) => prev + 1);
      if (data.isComplete) {
        setIsComplete(true);
      }
    },
    onError: (err: any) => toast.error(err.message || "応答に失敗しました"),
  });

  const analyzeMutation = trpc.matching.analyzeInteractiveScenario.useMutation({
    onSuccess: () => {
      setIsAnalyzed(true);
      setActiveTab("analysis");
      scenarioQuery.refetch();
      toast.success("分析が完了しました");
    },
    onError: (err: any) => toast.error(err.message || "分析に失敗しました"),
  });

  useEffect(() => {
    dialogueEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dialogue]);

  const handleCreate = () => {
    if (!theme.trim()) {
      toast.error("テーマを入力してください");
      return;
    }
    setDialogue([]);
    setTurnCount(0);
    setIsComplete(false);
    setIsAnalyzed(false);
    const friendId = selectedFriend && selectedFriend !== "none" ? Number(selectedFriend) : undefined;
    createMutation.mutate({
      theme: theme.trim(),
      friendId,
    });
  };

  const handleStrategy = (strategy: StrategyKey) => {
    if (!activeScenarioId) return;
    respondMutation.mutate({
      scenarioId: activeScenarioId,
      strategy,
    });
  };

  const handleAnalyze = () => {
    if (!activeScenarioId) return;
    analyzeMutation.mutate({ scenarioId: activeScenarioId });
  };

  const analysis = scenarioQuery.data?.analysisResult;
  const friends = friendsQuery.data ?? [];
  const scenarios = scenarioListQuery.data ?? [];

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-500/20">
            <Swords className="h-6 w-6 text-red-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">交渉シナリオ</h1>
            <p className="text-sm text-muted-foreground">インタラクティブなビジネス交渉シミュレーション</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="execute">
              <Play className="h-4 w-4 mr-1" />
              シナリオ実行
            </TabsTrigger>
            <TabsTrigger value="analysis">
              <BarChart3 className="h-4 w-4 mr-1" />
              分析結果
            </TabsTrigger>
            <TabsTrigger value="history">
              <Clock className="h-4 w-4 mr-1" />
              履歴
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Execute Scenario */}
          <TabsContent value="execute" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>新しいシナリオ</CardTitle>
                <CardDescription>テーマを入力して交渉シミュレーションを開始</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">テーマ</label>
                  <Input
                    placeholder="例: 新規事業の提携交渉、予算削減の説得..."
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">対戦相手（オプション）</label>
                  <Select value={selectedFriend} onValueChange={setSelectedFriend}>
                    <SelectTrigger>
                      <SelectValue placeholder="友達を選択（任意）" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">指定なし（AIが生成）</SelectItem>
                      {(friends as any[]).map((f: any) => (
                        <SelectItem key={f.friendId || f.id} value={String(f.friendId || f.id)}>
                          {f.friendName || f.displayName || "友達"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending || !theme.trim()}
                  className="w-full"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  シナリオ開始
                </Button>
              </CardContent>
            </Card>

            {/* Dialogue Display */}
            {dialogue.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>対話</span>
                    <Badge variant="outline">ターン {turnCount}/5</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                    {dialogue.map((msg, i) => (
                      <div
                        key={i}
                        className={`flex ${msg.role === "twin" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                            msg.role === "twin"
                              ? "bg-blue-600/20 text-blue-100 border border-blue-500/30"
                              : "bg-muted text-muted-foreground border border-border"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-semibold">
                              {msg.role === "twin" ? "あなたのツイン" : "相手"}
                            </span>
                            {msg.strategy && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0">
                                {STRATEGY_CONFIG[msg.strategy as StrategyKey]?.label || msg.strategy}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm leading-relaxed">{msg.content}</p>
                        </div>
                      </div>
                    ))}
                    <div ref={dialogueEndRef} />
                  </div>

                  {/* Strategy Buttons */}
                  {!isComplete && activeScenarioId && (
                    <div className="mt-4 space-y-2">
                      <p className="text-sm text-muted-foreground text-center">次の戦略を選択:</p>
                      <div className="grid grid-cols-2 gap-2">
                        {(Object.entries(STRATEGY_CONFIG) as [StrategyKey, typeof STRATEGY_CONFIG[StrategyKey]][]).map(
                          ([key, config]) => (
                            <Button
                              key={key}
                              onClick={() => handleStrategy(key)}
                              disabled={respondMutation.isPending}
                              className={config.color}
                              variant="ghost"
                            >
                              {respondMutation.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <config.icon className="h-4 w-4 mr-2" />
                              )}
                              {config.label}
                            </Button>
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {/* Analyze Button */}
                  {isComplete && !isAnalyzed && (
                    <div className="mt-4">
                      <Button
                        onClick={handleAnalyze}
                        disabled={analyzeMutation.isPending}
                        className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
                      >
                        {analyzeMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <BarChart3 className="h-4 w-4 mr-2" />
                        )}
                        分析を実行
                      </Button>
                    </div>
                  )}

                  {isComplete && (
                    <div className="mt-3 text-center">
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        シナリオ完了
                      </Badge>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Tab 2: Analysis */}
          <TabsContent value="analysis" className="space-y-4">
            {!analysis ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>シナリオを完了して分析を実行してください</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Overall Score */}
                <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-orange-500/5">
                  <CardContent className="py-8 text-center">
                    <p className="text-sm text-muted-foreground mb-2">総合スコア</p>
                    <p className="text-6xl font-bold text-amber-400">
                      {analysis.overallScore ?? 0}
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">/ 100</p>
                  </CardContent>
                </Card>

                {/* Strategy Effectiveness */}
                <Card>
                  <CardHeader>
                    <CardTitle>戦略の効果</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {(analysis.strategyEffectiveness ?? []).map((s: any, i: number) => (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span>{STRATEGY_CONFIG[s.strategy as StrategyKey]?.label || s.strategy}</span>
                          <span className="font-medium">{s.score}%</span>
                        </div>
                        <Progress value={s.score} className="h-2" />
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Best / Worst Choices */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card className="border-green-500/30">
                    <CardHeader>
                      <CardTitle className="text-green-400">ベストな選択</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm">{analysis.bestChoice?.description || "データなし"}</p>
                      {analysis.bestChoice?.turn && (
                        <Badge variant="outline" className="mt-2">ターン {analysis.bestChoice.turn}</Badge>
                      )}
                    </CardContent>
                  </Card>
                  <Card className="border-red-500/30">
                    <CardHeader>
                      <CardTitle className="text-red-400">改善ポイント</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm">{analysis.worstChoice?.description || "データなし"}</p>
                      {analysis.worstChoice?.turn && (
                        <Badge variant="outline" className="mt-2">ターン {analysis.worstChoice.turn}</Badge>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Optimal Route Timeline */}
                {analysis.optimalRoute && (
                  <Card>
                    <CardHeader>
                      <CardTitle>最適ルート</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {(analysis.optimalRoute as any[]).map((step: any, i: number) => (
                          <div key={i} className="flex items-start gap-3">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold">
                              {i + 1}
                            </div>
                            <div>
                              <p className="text-sm font-medium">
                                {STRATEGY_CONFIG[step.strategy as StrategyKey]?.label || step.strategy}
                              </p>
                              <p className="text-xs text-muted-foreground">{step.reason}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Lessons */}
                {analysis.lessons && (
                  <Card>
                    <CardHeader>
                      <CardTitle>学んだこと</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {(analysis.lessons as string[]).map((lesson: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <Lightbulb className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                            <span>{lesson}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* Tab 3: History */}
          <TabsContent value="history" className="space-y-4">
            {scenarios.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>まだシナリオ履歴がありません</p>
                </CardContent>
              </Card>
            ) : (
              scenarios.map((s: any) => (
                <Card
                  key={s.id}
                  className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => {
                    setActiveScenarioId(s.id);
                    if (s.dialogue) setDialogue(s.dialogue);
                    if (s.status === "completed") {
                      setIsComplete(true);
                      if (s.analysisResult) {
                        setIsAnalyzed(true);
                        setActiveTab("analysis");
                      }
                    } else {
                      setIsComplete(false);
                      setIsAnalyzed(false);
                    }
                    setActiveTab("execute");
                  }}
                >
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-medium">{s.theme || "テーマなし"}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          ターン: {s.turnCount ?? 0} / 5
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            s.status === "active"
                              ? "bg-green-500/20 text-green-400 border-green-500/30"
                              : "bg-muted text-muted-foreground"
                          }
                        >
                          {s.status === "active" ? "進行中" : "完了"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {s.createdAt ? new Date(s.createdAt).toLocaleDateString("ja-JP") : ""}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
