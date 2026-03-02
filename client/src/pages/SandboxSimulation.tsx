import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { FlaskConical, Loader2, Play, Clock, MessageSquare, CheckCircle, Settings } from "lucide-react";

export default function SandboxSimulation() {
  usePageMeta({ title: "サンドボックス", description: "ツイン対話をテスト実行", path: "/sandbox" });

  const [activeTab, setActiveTab] = useState("simulation");
  const [theme, setTheme] = useState("");
  const [opponentPersonality, setOpponentPersonality] = useState("");
  const [opponentDescription, setOpponentDescription] = useState("");
  const [turnCount, setTurnCount] = useState([5]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [simulationResult, setSimulationResult] = useState<any>(null);

  const sandboxCreateMut = trpc.matching.sandboxCreate.useMutation({
    onSuccess: (data) => {
      setSimulationResult(data);
      toast.success("シミュレーション完了");
    },
    onError: (err) => toast.error(err.message),
  });

  const applySettingsMut = trpc.matching.sandboxApplySettings.useMutation({
    onSuccess: () => toast.success("設定を適用しました"),
    onError: (err) => toast.error(err.message),
  });

  const { data: historyList } = trpc.matching.sandboxList.useQuery(undefined, {
    enabled: activeTab === "history" || activeTab === "detail",
  });

  const { data: detailData } = trpc.matching.sandboxGet.useQuery(
    { sessionId: selectedSessionId! },
    { enabled: !!selectedSessionId && activeTab === "detail" }
  );

  const handleStartSimulation = () => {
    if (!theme.trim()) {
      toast.error("テーマを入力してください");
      return;
    }
    sandboxCreateMut.mutate({
      theme: theme.trim(),
      opponentPersonality: opponentPersonality.trim() || undefined,
      opponentDescription: opponentDescription.trim() || undefined,
      turnCount: turnCount[0],
    });
  };

  const handleApplySettings = () => {
    if (!simulationResult?.id) return;
    applySettingsMut.mutate({ sessionId: simulationResult.id });
  };

  const renderDialogueBubbles = (dialogues: any[]) => {
    if (!dialogues || dialogues.length === 0) return <p className="text-muted-foreground text-sm">対話なし</p>;
    return (
      <div className="space-y-3">
        {dialogues.map((d: any, i: number) => (
          <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[75%] rounded-lg px-4 py-2 ${i % 2 === 0 ? "bg-muted" : "bg-primary text-primary-foreground"}`}>
              <p className="text-xs font-semibold mb-1">{d.speaker || (i % 2 === 0 ? "自分のツイン" : "相手のツイン")}</p>
              <p className="text-sm">{d.content}</p>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <FlaskConical className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">サンドボックス</h1>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="simulation">シミュレーション</TabsTrigger>
            <TabsTrigger value="history">履歴</TabsTrigger>
            <TabsTrigger value="detail">詳細</TabsTrigger>
          </TabsList>

          {/* シミュレーションタブ */}
          <TabsContent value="simulation" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Play className="h-5 w-5" />
                  シミュレーション設定
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>テーマ</Label>
                  <Input
                    placeholder="例: AIスタートアップの協業"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>相手の人格</Label>
                  <Textarea
                    placeholder="積極的なビジネスパーソン"
                    value={opponentPersonality}
                    onChange={(e) => setOpponentPersonality(e.target.value)}
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label>相手の説明</Label>
                  <Textarea
                    placeholder="IT企業の経営者で新規事業に関心がある"
                    value={opponentDescription}
                    onChange={(e) => setOpponentDescription(e.target.value)}
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label>ターン数: {turnCount[0]}</Label>
                  <Slider
                    value={turnCount}
                    onValueChange={setTurnCount}
                    min={1}
                    max={10}
                    step={1}
                    className="w-full"
                  />
                </div>

                <Button
                  onClick={handleStartSimulation}
                  disabled={sandboxCreateMut.isPending}
                  className="w-full"
                >
                  {sandboxCreateMut.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      シミュレーション中...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      シミュレーション開始
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Result */}
            {simulationResult && (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <MessageSquare className="h-5 w-5" />
                      対話結果
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {renderDialogueBubbles(simulationResult.dialogues || [])}
                  </CardContent>
                </Card>

                {simulationResult.score != null && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">スコア: {simulationResult.score}/100</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {simulationResult.strengths && (
                        <div>
                          <p className="text-sm font-semibold mb-1">強み</p>
                          <div className="flex flex-wrap gap-1">
                            {(simulationResult.strengths as string[]).map((s: string, i: number) => (
                              <Badge key={i} variant="default">{s}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {simulationResult.weaknesses && (
                        <div>
                          <p className="text-sm font-semibold mb-1">改善点</p>
                          <div className="flex flex-wrap gap-1">
                            {(simulationResult.weaknesses as string[]).map((w: string, i: number) => (
                              <Badge key={i} variant="secondary">{w}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {simulationResult.recommendedSettings && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Settings className="h-5 w-5" />
                        推奨設定
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-40">
                        {JSON.stringify(simulationResult.recommendedSettings, null, 2)}
                      </pre>
                      <Button onClick={handleApplySettings} disabled={applySettingsMut.isPending}>
                        {applySettingsMut.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <CheckCircle className="h-4 w-4 mr-2" />
                        )}
                        この設定を適用
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>

          {/* 履歴タブ */}
          <TabsContent value="history" className="space-y-4 mt-4">
            {!historyList || historyList.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <FlaskConical className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>シミュレーション履歴がありません</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {historyList.map((session: any) => (
                  <Card
                    key={session.id}
                    className="cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => {
                      setSelectedSessionId(session.id);
                      setActiveTab("detail");
                    }}
                  >
                    <CardContent className="py-3 flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="font-medium">{session.theme}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>相手: {session.opponentPersonality || "未設定"}</span>
                          <span>ターン: {session.turnCount}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {session.score != null && (
                          <Badge variant="outline">{session.score}点</Badge>
                        )}
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {session.createdAt ? new Date(session.createdAt).toLocaleDateString("ja-JP") : ""}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* 詳細タブ */}
          <TabsContent value="detail" className="space-y-4 mt-4">
            {!selectedSessionId ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <p>履歴からセッションを選択してください</p>
                </CardContent>
              </Card>
            ) : !detailData ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">{detailData.theme}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {renderDialogueBubbles(detailData.dialogues || [])}
                  </CardContent>
                </Card>

                {detailData.analysis && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">分析結果</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {detailData.analysis.score != null && (
                        <p className="text-lg font-semibold">スコア: {detailData.analysis.score}/100</p>
                      )}
                      {detailData.analysis.summary && (
                        <p className="text-sm text-muted-foreground">{detailData.analysis.summary}</p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {detailData.settingsComparison && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">設定比較</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm font-semibold mb-2">使用設定</p>
                          <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                            {JSON.stringify(detailData.settingsComparison.used, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <p className="text-sm font-semibold mb-2">推奨設定</p>
                          <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                            {JSON.stringify(detailData.settingsComparison.recommended, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
