import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Scale, Loader2, Trophy, Swords, Crown, ThumbsUp, ThumbsDown, Minus } from "lucide-react";

export default function DebateMode() {
  usePageMeta({ title: "ディベートモード", description: "ツイン同士のディベート", path: "/debate" });

  const [topic, setTopic] = useState("");
  const [stance, setStance] = useState<"pro" | "con">("pro");
  const [turns, setTurns] = useState([4]);
  const [debateResult, setDebateResult] = useState<any>(null);
  const [selectedDebateId, setSelectedDebateId] = useState<number | null>(null);

  const createDebate = trpc.matching.createDebate.useMutation({
    onSuccess: (data: any) => {
      setDebateResult(data);
      toast.success("ディベートが完了しました");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const { data: debateHistory } = trpc.matching.listDebates.useQuery();
  const { data: selectedDebate } = trpc.matching.getDebate.useQuery(
    { debateId: selectedDebateId! },
    { enabled: !!selectedDebateId }
  );
  const { data: rankings } = trpc.matching.getDebateRankings.useQuery();

  const historyItems = (debateHistory as any[]) || [];
  const rankingData = (rankings as any) || { rankings: [], myRank: null };

  const handleStartDebate = () => {
    if (!topic.trim()) {
      toast.error("論題を入力してください");
      return;
    }
    createDebate.mutate({ topic: topic.trim(), stance, turnCount: turns[0] });
  };

  const getResultFromJudge = (judgeResult: any, myStance: string): string => {
    if (!judgeResult) return "draw";
    if (judgeResult.winner === "draw") return "draw";
    return judgeResult.winner === myStance ? "win" : "loss";
  };

  const getResultBadge = (result: string) => {
    switch (result) {
      case "win": return <Badge className="bg-green-500 text-white">勝利</Badge>;
      case "loss": return <Badge className="bg-red-500 text-white">敗北</Badge>;
      default: return <Badge variant="secondary">引き分け</Badge>;
    }
  };

  const getWinnerBanner = (winner: string, myStance: string) => {
    if (winner === "draw") return { icon: <Minus className="h-8 w-8" />, label: "引き分け", color: "text-gray-500" };
    if (winner === myStance) return { icon: <Crown className="h-8 w-8" />, label: "勝利", color: "text-yellow-500" };
    return { icon: <ThumbsDown className="h-8 w-8" />, label: "敗北", color: "text-red-500" };
  };

  const renderScoreCard = (label: string, score: any) => {
    if (!score) return null;
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{label}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between"><span>論理性</span><span className="font-bold">{score.logic ?? 0}</span></div>
          <div className="flex justify-between"><span>説得力</span><span className="font-bold">{score.persuasion ?? 0}</span></div>
          <div className="flex justify-between"><span>反論力</span><span className="font-bold">{score.rebuttal ?? 0}</span></div>
          <div className="flex justify-between"><span>独創性</span><span className="font-bold">{score.originality ?? 0}</span></div>
          <div className="flex justify-between border-t pt-1 font-bold">
            <span>合計</span>
            <span>{score.total ?? ((score.logic ?? 0) + (score.persuasion ?? 0) + (score.rebuttal ?? 0) + (score.originality ?? 0))}</span>
          </div>
        </CardContent>
      </Card>
    );
  };

  const displayResult = selectedDebate || debateResult;
  const displayDialogues = displayResult?.dialogues || [];
  const displayJudge = displayResult?.judgeResult || null;
  const displayStance = (displayResult as any)?.stance || stance;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Scale className="h-7 w-7 text-purple-500" />
          <h1 className="text-2xl font-bold">ディベートモード</h1>
        </div>

        <Tabs defaultValue="debate">
          <TabsList>
            <TabsTrigger value="debate">ディベート</TabsTrigger>
            <TabsTrigger value="history">履歴</TabsTrigger>
            <TabsTrigger value="ranking">ランキング</TabsTrigger>
          </TabsList>

          <TabsContent value="debate" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Swords className="h-5 w-5" />
                  新しいディベート
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>論題</Label>
                  <Input
                    placeholder="例: リモートワークはオフィスワークより生産性が高い"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>立場</Label>
                  <Select value={stance} onValueChange={(v) => setStance(v as "pro" | "con")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pro">賛成</SelectItem>
                      <SelectItem value="con">反対</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>ターン数: {turns[0]}</Label>
                  <Slider value={turns} onValueChange={setTurns} min={2} max={8} step={1} />
                </div>
                <Button onClick={handleStartDebate} disabled={createDebate.isPending} className="w-full">
                  {createDebate.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />ディベート進行中...</>
                  ) : (
                    <><Swords className="h-4 w-4 mr-2" />ディベート開始</>
                  )}
                </Button>
              </CardContent>
            </Card>

            {displayResult && (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>ディベート: {displayResult.topic || topic}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {displayDialogues.map((d: any, i: number) => (
                      <div key={i} className={`flex ${d.stance === "pro" ? "justify-start" : "justify-end"}`}>
                        <div className={`max-w-[75%] rounded-lg p-3 ${d.stance === "pro" ? "bg-blue-50 border-blue-200 border" : "bg-red-50 border-red-200 border"}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-sm">{d.speaker}</span>
                            <Badge variant={d.stance === "pro" ? "default" : "destructive"} className="text-xs">
                              {d.stance === "pro" ? "賛成" : "反対"}
                            </Badge>
                          </div>
                          <p className="text-sm">{d.content}</p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {displayJudge && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Trophy className="h-5 w-5 text-yellow-500" />
                        判定結果
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {(() => {
                        const banner = getWinnerBanner(displayJudge.winner, displayStance);
                        return (
                          <div className={`text-center py-4 ${banner.color}`}>
                            {banner.icon}
                            <p className="text-2xl font-bold mt-2">{banner.label}</p>
                          </div>
                        );
                      })()}

                      <div className="grid grid-cols-2 gap-4">
                        {renderScoreCard("賛成側スコア", displayJudge.proScore)}
                        {renderScoreCard("反対側スコア", displayJudge.conScore)}
                      </div>

                      {displayJudge.keyPoints?.length > 0 && (
                        <div>
                          <h4 className="font-semibold mb-2">注目ポイント</h4>
                          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                            {displayJudge.keyPoints.map((p: any, i: number) => (
                              <li key={i}>{typeof p === "string" ? p : p.point || JSON.stringify(p)}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {displayJudge.summary && (
                        <div>
                          <h4 className="font-semibold mb-2">総評</h4>
                          <p className="text-sm text-muted-foreground">{displayJudge.summary}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            {historyItems.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  まだディベート履歴がありません
                </CardContent>
              </Card>
            ) : (
              historyItems.map((item: any) => {
                const result = getResultFromJudge(item.judgeResult, item.stance);
                const myScore = item.stance === "pro" ? item.judgeResult?.proScore : item.judgeResult?.conScore;
                return (
                  <Card
                    key={item.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => setSelectedDebateId(item.id)}
                  >
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <p className="font-semibold">{item.topic}</p>
                          <div className="flex items-center gap-2">
                            <Badge variant={item.stance === "pro" ? "default" : "destructive"}>
                              {item.stance === "pro" ? "賛成" : "反対"}
                            </Badge>
                            {getResultBadge(result)}
                            {myScore?.total != null && (
                              <span className="text-sm text-muted-foreground">スコア: {myScore.total}</span>
                            )}
                          </div>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {new Date(item.createdAt).toLocaleDateString("ja-JP")}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </TabsContent>

          <TabsContent value="ranking" className="space-y-4">
            {rankingData.myRank && (
              <Card className="border-primary">
                <CardContent className="py-4">
                  <div className="flex items-center gap-3">
                    <ThumbsUp className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-semibold">あなたの成績</p>
                      <p className="text-sm text-muted-foreground">
                        {rankingData.myRank.wins}勝 {rankingData.myRank.losses}敗 {rankingData.myRank.draws}分 / 合計スコア: {rankingData.myRank.totalScore}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  ランキング
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!rankingData.rankings?.length ? (
                  <p className="text-center text-muted-foreground py-4">まだランキングデータがありません</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="py-2 text-left">順位</th>
                          <th className="py-2 text-left">ユーザー</th>
                          <th className="py-2 text-center">勝</th>
                          <th className="py-2 text-center">敗</th>
                          <th className="py-2 text-center">分</th>
                          <th className="py-2 text-right">スコア</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rankingData.rankings.map((r: any, idx: number) => (
                          <tr key={idx} className={`border-b last:border-0 ${r.userId === rankingData.myRank?.userId ? "bg-primary/5" : ""}`}>
                            <td className="py-2">
                              {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}`}
                            </td>
                            <td className="py-2 font-medium">{r.userName || "ユーザー"}</td>
                            <td className="py-2 text-center">{r.wins}</td>
                            <td className="py-2 text-center">{r.losses}</td>
                            <td className="py-2 text-center">{r.draws}</td>
                            <td className="py-2 text-right font-bold">{r.totalScore}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
