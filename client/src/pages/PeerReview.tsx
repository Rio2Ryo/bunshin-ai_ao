import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend } from "recharts";
import { Star, Loader2, Send, MessageSquare, TrendingUp, Lightbulb } from "lucide-react";

const DIMENSIONS = ["説得力", "誠実さ", "専門性", "柔軟性", "独自性"] as const;
const DIMENSION_KEYS = ["persuasion", "sincerity", "expertise", "flexibility", "originality"] as const;

export default function PeerReview() {
  usePageMeta({ title: "360度フィードバック", description: "マッチング相互評価", path: "/peer-review" });

  const [activeTab, setActiveTab] = useState("evaluate");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [scores, setScores] = useState<Record<string, number[]>>({
    persuasion: [3],
    sincerity: [3],
    expertise: [3],
    flexibility: [3],
    originality: [3],
  });
  const [comment, setComment] = useState("");

  const { data: sessions } = trpc.matching.sessions.useQuery();
  const { data: peerReviews } = trpc.matching.getPeerReviews.useQuery(
    {},
    { enabled: activeTab === "received" }
  );
  const { data: gapData } = trpc.matching.getSelfVsPeerGap.useQuery(undefined, {
    enabled: activeTab === "gap",
  });

  const submitMut = trpc.matching.submitPeerReview.useMutation({
    onSuccess: () => {
      toast.success("評価を送信しました");
      setSelectedSessionId("");
      setComment("");
      setScores({
        persuasion: [3],
        sincerity: [3],
        expertise: [3],
        flexibility: [3],
        originality: [3],
      });
    },
    onError: (err) => toast.error(err.message),
  });

  const aiSuggestionsMut = trpc.matching.getPeerReviewAISuggestions.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const getTargetUserId = (session: any): number => {
    // The other user's userId: check twin2's userId first, fallback to twin1's
    if (session.twin2?.userId && session.twin2.userId !== session.initiatorUserId) {
      return session.twin2.userId;
    }
    if (session.twin1?.userId && session.twin1.userId !== session.initiatorUserId) {
      return session.twin1.userId;
    }
    return session.twin2?.userId ?? 0;
  };

  const handleSubmit = () => {
    if (!selectedSessionId) {
      toast.error("セッションを選択してください");
      return;
    }
    const selectedSession = sessions?.find((s: any) => String(s.id) === selectedSessionId);
    if (!selectedSession) return;

    submitMut.mutate({
      sessionId: Number(selectedSessionId),
      targetUserId: getTargetUserId(selectedSession),
      persuasion: scores.persuasion[0],
      sincerity: scores.sincerity[0],
      expertise: scores.expertise[0],
      flexibility: scores.flexibility[0],
      originality: scores.originality[0],
      comment: comment.trim() || undefined,
    });
  };

  const averageScores = useMemo(() => {
    if (!peerReviews || peerReviews.length === 0) return null;
    const totals: Record<string, number> = {};
    DIMENSION_KEYS.forEach((k) => (totals[k] = 0));
    peerReviews.forEach((r: any) => {
      DIMENSION_KEYS.forEach((k) => {
        totals[k] += (r as any)[k] || 0;
      });
    });
    const count = peerReviews.length;
    const result: Record<string, number> = {};
    DIMENSION_KEYS.forEach((k) => {
      result[k] = Math.round((totals[k] / count) * 10) / 10;
    });
    return result;
  }, [peerReviews]);

  const radarData = useMemo(() => {
    if (!gapData) return [];
    return DIMENSIONS.map((dim, i) => ({
      dimension: dim,
      peer: gapData.peer?.[DIMENSION_KEYS[i]] ?? 0,
      selfGiven: gapData.selfGiven?.[DIMENSION_KEYS[i]] ?? 0,
    }));
  }, [gapData]);

  const priorityColor = (p: string): "destructive" | "default" | "secondary" => {
    if (p === "high") return "destructive";
    if (p === "medium") return "default";
    return "secondary";
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <Star className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">360度フィードバック</h1>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="evaluate">評価する</TabsTrigger>
            <TabsTrigger value="received">受けた評価</TabsTrigger>
            <TabsTrigger value="gap">ギャップ分析</TabsTrigger>
          </TabsList>

          {/* 評価するタブ */}
          <TabsContent value="evaluate" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Send className="h-5 w-5" />
                  評価を送信
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>マッチングセッション</Label>
                  <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
                    <SelectTrigger>
                      <SelectValue placeholder="セッションを選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {sessions?.filter((s) => s.status === "completed").map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.theme || `セッション #${s.id}`} ({new Date(s.completedAt || s.createdAt).toLocaleDateString("ja-JP")})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {DIMENSIONS.map((dim, i) => (
                  <div key={dim} className="space-y-2">
                    <Label className="flex justify-between">
                      <span>{dim}</span>
                      <span className="text-muted-foreground">{scores[DIMENSION_KEYS[i]][0]}/5</span>
                    </Label>
                    <Slider
                      value={scores[DIMENSION_KEYS[i]]}
                      onValueChange={(val) =>
                        setScores((prev) => ({ ...prev, [DIMENSION_KEYS[i]]: val }))
                      }
                      min={1}
                      max={5}
                      step={1}
                      className="w-full"
                    />
                  </div>
                ))}

                <div className="space-y-2">
                  <Label>コメント（任意）</Label>
                  <Textarea
                    placeholder="相手のツインとの対話で感じたことを自由に記述してください"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                  />
                </div>

                <Button
                  onClick={handleSubmit}
                  disabled={submitMut.isPending || !selectedSessionId}
                  className="w-full"
                >
                  {submitMut.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  評価を送信
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 受けた評価タブ */}
          <TabsContent value="received" className="space-y-4 mt-4">
            {averageScores && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    平均スコア
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-5 gap-2 text-center">
                    {DIMENSIONS.map((dim, i) => (
                      <div key={dim} className="space-y-1">
                        <p className="text-xs text-muted-foreground">{dim}</p>
                        <p className="text-xl font-bold">{averageScores[DIMENSION_KEYS[i]]}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {!peerReviews || peerReviews.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Star className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>まだ評価を受けていません</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {peerReviews.map((review: any, idx: number) => (
                  <Card key={review.id || idx}>
                    <CardContent className="py-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{review.reviewerName || "匿名"}</p>
                        <span className="text-xs text-muted-foreground">
                          {review.createdAt ? new Date(review.createdAt).toLocaleDateString("ja-JP") : ""}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {DIMENSIONS.map((dim, i) => (
                          <Badge
                            key={dim}
                            variant={review[DIMENSION_KEYS[i]] >= 4 ? "default" : "secondary"}
                          >
                            {dim}: {review[DIMENSION_KEYS[i]] || "-"}
                          </Badge>
                        ))}
                      </div>
                      {review.comment && (
                        <div className="flex items-start gap-2 mt-1">
                          <MessageSquare className="h-3 w-3 mt-1 text-muted-foreground shrink-0" />
                          <p className="text-sm text-muted-foreground">{review.comment}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ギャップ分析タブ */}
          <TabsContent value="gap" className="space-y-4 mt-4">
            {radarData.length > 0 ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">自己 vs 他者 レーダー</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <RadarChart data={radarData}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="dimension" />
                        <PolarRadiusAxis domain={[0, 5]} />
                        <Radar
                          name="他者からの評価"
                          dataKey="peer"
                          stroke="#3b82f6"
                          fill="#3b82f6"
                          fillOpacity={0.3}
                        />
                        <Radar
                          name="自分が他者に付けた評価"
                          dataKey="selfGiven"
                          stroke="#f97316"
                          fill="#f97316"
                          fillOpacity={0.3}
                        />
                        <Legend />
                      </RadarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {DIMENSIONS.map((dim, i) => {
                    const peerVal = gapData?.peer?.[DIMENSION_KEYS[i]] ?? 0;
                    const selfVal = gapData?.selfGiven?.[DIMENSION_KEYS[i]] ?? 0;
                    const gap = Math.round((peerVal - selfVal) * 10) / 10;
                    return (
                      <Card key={dim}>
                        <CardContent className="py-3">
                          <p className="font-medium text-sm">{dim}</p>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-muted-foreground">他者: {peerVal}</span>
                            <span className="text-xs text-muted-foreground">自分: {selfVal}</span>
                            <Badge variant={Math.abs(gap) > 1 ? "destructive" : "secondary"}>
                              差: {gap > 0 ? "+" : ""}{gap}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                <Card>
                  <CardContent className="py-4">
                    <Button
                      onClick={() => aiSuggestionsMut.mutate()}
                      disabled={aiSuggestionsMut.isPending}
                      className="w-full"
                    >
                      {aiSuggestionsMut.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Lightbulb className="h-4 w-4 mr-2" />
                      )}
                      AI改善提案を取得
                    </Button>
                  </CardContent>
                </Card>

                {aiSuggestionsMut.data && (
                  <div className="space-y-2">
                    {(aiSuggestionsMut.data.suggestions || []).map((s: any, i: number) => (
                      <Card key={i}>
                        <CardContent className="py-3">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant={priorityColor(s.priority)}>
                              {s.priority === "high" ? "高" : s.priority === "medium" ? "中" : "低"}
                            </Badge>
                            <p className="font-medium text-sm">{s.title || s.dimension}</p>
                          </div>
                          <p className="text-sm text-muted-foreground">{s.suggestion}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>評価データが不足しています</p>
                  <p className="text-xs mt-1">評価の送受信後にギャップ分析が利用可能になります</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
