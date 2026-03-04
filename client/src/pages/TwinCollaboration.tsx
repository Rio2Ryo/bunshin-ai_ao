import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { Users, Bot, MessageSquare, Loader2, Plus, BarChart3, CheckCircle, XCircle, Lightbulb, Scale, ArrowLeft } from "lucide-react";

const TWIN_COLORS = [
  { bg: "bg-blue-100 dark:bg-blue-900/30", border: "border-blue-300 dark:border-blue-700", text: "text-blue-700 dark:text-blue-300", dot: "bg-blue-500" },
  { bg: "bg-purple-100 dark:bg-purple-900/30", border: "border-purple-300 dark:border-purple-700", text: "text-purple-700 dark:text-purple-300", dot: "bg-purple-500" },
  { bg: "bg-green-100 dark:bg-green-900/30", border: "border-green-300 dark:border-green-700", text: "text-green-700 dark:text-green-300", dot: "bg-green-500" },
  { bg: "bg-orange-100 dark:bg-orange-900/30", border: "border-orange-300 dark:border-orange-700", text: "text-orange-700 dark:text-orange-300", dot: "bg-orange-500" },
  { bg: "bg-pink-100 dark:bg-pink-900/30", border: "border-pink-300 dark:border-pink-700", text: "text-pink-700 dark:text-pink-300", dot: "bg-pink-500" },
];

export default function TwinCollaboration() {
  usePageMeta({ title: "ツイン・コラボレーション", description: "複数ツインの同時対話と合意形成", path: "/collaboration" });

  const [activeTab, setActiveTab] = useState("new");
  const [topic, setTopic] = useState("");
  const [turns, setTurns] = useState(5);
  const [selectedTwinIds, setSelectedTwinIds] = useState<number[]>([]);
  const [collaboration, setCollaboration] = useState<any>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  // Queries
  const { data: myTwin } = trpc.myTwin.get.useQuery();
  const { data: friendsData } = trpc.friends.list.useQuery();
  const { data: collaborations, isLoading: historyLoading, refetch: refetchHistory } = trpc.myTwin.listCollaborations.useQuery();
  const { data: historyDetail } = trpc.myTwin.getCollaboration.useQuery(
    { collaborationId: selectedHistoryId! },
    { enabled: !!selectedHistoryId }
  );

  // Mutations
  const startMut = trpc.myTwin.startCollaboration.useMutation();
  const analyzeMut = trpc.myTwin.analyzeCollaboration.useMutation();

  const friends = (friendsData as any)?.friends ?? friendsData ?? [];
  const twin = myTwin as any;
  const historyList = (collaborations as any)?.collaborations ?? collaborations ?? [];
  const historyDetailData = (historyDetail as any) ?? null;

  // Build list of available twins
  const availableTwins: { id: number; name: string; source: string }[] = [];
  if (twin?.id) {
    availableTwins.push({ id: twin.id, name: twin.name || "自分のツイン", source: "自分" });
  }
  for (const f of friends) {
    if (f.twinId) {
      availableTwins.push({
        id: f.twinId,
        name: f.twinName || f.displayName || `ツイン #${f.twinId}`,
        source: f.displayName || f.name || "友達",
      });
    }
  }

  const toggleTwin = (twinId: number) => {
    setSelectedTwinIds((prev) =>
      prev.includes(twinId) ? prev.filter((id) => id !== twinId) : [...prev, twinId]
    );
  };

  const handleStart = async () => {
    if (selectedTwinIds.length < 2) {
      toast.error("2つ以上のツインを選択してください");
      return;
    }
    if (!topic.trim()) {
      toast.error("トピックを入力してください");
      return;
    }
    try {
      const result = await startMut.mutateAsync({
        twinIds: selectedTwinIds,
        topic,
        turns,
      });
      setCollaboration(result);
      setAnalysis(null);
      toast.success("コラボレーション対話が完了しました");
      refetchHistory();
    } catch (e: any) {
      toast.error(e.message || "対話の開始に失敗しました");
    }
  };

  const handleAnalyze = async () => {
    const collabId = collaboration?.collaborationId || collaboration?.id;
    if (!collabId) {
      toast.error("対話データがありません");
      return;
    }
    try {
      const result = await analyzeMut.mutateAsync({ collaborationId: collabId });
      setAnalysis(result);
      toast.success("分析が完了しました");
    } catch (e: any) {
      toast.error(e.message || "分析に失敗しました");
    }
  };

  const getTwinColor = (index: number) => TWIN_COLORS[index % TWIN_COLORS.length];

  const dialogue = collaboration?.dialogue ?? [];
  const displayAnalysis = analysis;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-purple-500" />
            ツイン・コラボレーション
          </h1>
          <p className="text-muted-foreground mt-1">
            複数のツインを同時に対話させ、合意形成や多角的な議論を行います
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="new">
              <Plus className="h-4 w-4 mr-1" />
              新規対話
            </TabsTrigger>
            <TabsTrigger value="history">
              <MessageSquare className="h-4 w-4 mr-1" />
              履歴
            </TabsTrigger>
          </TabsList>

          {/* New Dialogue Tab */}
          <TabsContent value="new" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">対話設定</CardTitle>
                <CardDescription>参加するツインとトピックを設定してください</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Twin Selection */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">参加ツイン（2つ以上選択）</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {availableTwins.map((tw) => {
                      const isSelected = selectedTwinIds.includes(tw.id);
                      return (
                        <button
                          key={tw.id}
                          onClick={() => toggleTwin(tw.id)}
                          className={`flex items-center gap-2 p-3 rounded-lg border text-left transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/10"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          <Bot className={`h-5 w-5 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                          <div>
                            <div className="text-sm font-medium">{tw.name}</div>
                            <div className="text-xs text-muted-foreground">{tw.source}</div>
                          </div>
                          {isSelected && <CheckCircle className="h-4 w-4 text-primary ml-auto" />}
                        </button>
                      );
                    })}
                  </div>
                  {availableTwins.length === 0 && (
                    <p className="text-sm text-muted-foreground">利用可能なツインがありません。友達を追加してください。</p>
                  )}
                </div>

                {/* Topic */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">トピック</label>
                  <Input
                    placeholder="例: SaaS事業の今後の展望について"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                  />
                </div>

                {/* Turns */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">ターン数: {turns}</label>
                  <input
                    type="range"
                    min={3}
                    max={10}
                    value={turns}
                    onChange={(e) => setTurns(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>3</span>
                    <span>10</span>
                  </div>
                </div>

                <Button onClick={handleStart} disabled={startMut.isPending || selectedTwinIds.length < 2 || !topic.trim()}>
                  {startMut.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />対話中...</>
                  ) : (
                    <><MessageSquare className="h-4 w-4 mr-2" />対話を開始</>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Dialogue Display */}
            {dialogue.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <MessageSquare className="h-5 w-5" />
                    対話内容
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px] pr-4">
                    <div className="space-y-3">
                      {dialogue.map((turn: any, i: number) => {
                        const twinIdx = selectedTwinIds.indexOf(turn.twinId);
                        const color = getTwinColor(twinIdx >= 0 ? twinIdx : i);
                        return (
                          <div key={i} className={`p-3 rounded-lg border ${color.bg} ${color.border}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <div className={`h-2.5 w-2.5 rounded-full ${color.dot}`} />
                              <span className={`text-sm font-medium ${color.text}`}>
                                {turn.twinName || `ツイン #${turn.twinId}`}
                              </span>
                              <span className="text-xs text-muted-foreground">ターン {turn.turn ?? i + 1}</span>
                            </div>
                            <p className="text-sm leading-relaxed">{turn.content}</p>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                  <div className="mt-4">
                    <Button onClick={handleAnalyze} disabled={analyzeMut.isPending}>
                      {analyzeMut.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />分析中...</>
                      ) : (
                        <><BarChart3 className="h-4 w-4 mr-2" />分析</>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Analysis Display */}
            {displayAnalysis && (
              <div className="space-y-4">
                {/* Agreements */}
                {displayAnalysis.agreements && displayAnalysis.agreements.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        合意点
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {displayAnalysis.agreements.map((item: string, i: number) => (
                          <li key={i} className="text-sm flex items-start gap-2">
                            <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Disagreements */}
                {displayAnalysis.disagreements && displayAnalysis.disagreements.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-red-500" />
                        意見の相違
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {displayAnalysis.disagreements.map((d: any, i: number) => (
                        <Card key={i} className="bg-muted/50">
                          <CardContent className="p-3">
                            <div className="font-medium text-sm mb-2">{d.topic || `相違点 ${i + 1}`}</div>
                            {d.positions && (
                              <div className="space-y-1">
                                {Object.entries(d.positions).map(([name, pos]: [string, any]) => (
                                  <div key={name} className="text-xs">
                                    <span className="font-medium">{name}:</span>{" "}
                                    <span className="text-muted-foreground">{String(pos)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Unique Perspectives */}
                {displayAnalysis.uniquePerspectives && displayAnalysis.uniquePerspectives.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Lightbulb className="h-4 w-4 text-yellow-500" />
                        ユニークな視点
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {displayAnalysis.uniquePerspectives.map((p: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 text-sm">
                            <Lightbulb className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                            <div>
                              {p.twinName && <span className="font-medium">{p.twinName}: </span>}
                              {typeof p === "string" ? p : p.perspective || p.content || JSON.stringify(p)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Consensus Areas */}
                {displayAnalysis.consensusAreas && displayAnalysis.consensusAreas.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Scale className="h-4 w-4 text-blue-500" />
                        合意形成エリア
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {displayAnalysis.consensusAreas.map((area: string, i: number) => (
                          <Badge key={i} variant="secondary">{area}</Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Mediation Suggestion */}
                {displayAnalysis.mediationSuggestion && (
                  <Card className="border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20">
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Scale className="h-5 w-5 text-purple-600" />
                        AI仲介提案
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-relaxed font-medium">{displayAnalysis.mediationSuggestion}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4">
            {historyLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {!historyLoading && historyList.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center">
                  <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">まだコラボレーション履歴がありません</p>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {historyList.map((collab: any) => (
                <Card key={collab.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => {
                  setSelectedHistoryId(collab.id);
                  setDetailDialogOpen(true);
                }}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-medium text-sm line-clamp-2">{collab.topic}</h3>
                      {collab.hasAnalysis && (
                        <Badge variant="secondary" className="ml-2 shrink-0">
                          <BarChart3 className="h-3 w-3 mr-1" />
                          分析済
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {(collab.twinNames ?? []).map((name: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs">{name}</Badge>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{collab.turnCount ?? 0}ターン</span>
                      <span>{collab.createdAt ? new Date(collab.createdAt).toLocaleDateString("ja-JP") : ""}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Detail Dialog */}
            <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
              <DialogContent className="max-w-2xl max-h-[80vh]">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5" />
                    {historyDetailData?.topic || "対話詳細"}
                  </DialogTitle>
                </DialogHeader>
                <ScrollArea className="h-[500px] pr-4">
                  <div className="space-y-3">
                    {(historyDetailData?.dialogue ?? []).map((turn: any, i: number) => {
                      const color = getTwinColor(i % TWIN_COLORS.length);
                      return (
                        <div key={i} className={`p-3 rounded-lg border ${color.bg} ${color.border}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <div className={`h-2.5 w-2.5 rounded-full ${color.dot}`} />
                            <span className={`text-sm font-medium ${color.text}`}>
                              {turn.twinName || `ツイン #${turn.twinId}`}
                            </span>
                          </div>
                          <p className="text-sm leading-relaxed">{turn.content}</p>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </DialogContent>
            </Dialog>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
