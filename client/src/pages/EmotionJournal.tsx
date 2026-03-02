import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { BookHeart, Loader2, AlertTriangle, Lightbulb, SmilePlus, Angry, Frown, Laugh, ShieldAlert, Sparkles, X } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

const emotionLabels: Record<string, string> = {
  joy: "喜び",
  anger: "怒り",
  sadness: "悲しみ",
  happiness: "楽しさ",
  anxiety: "不安",
  confidence: "自信",
};

const emotionColors: Record<string, string> = {
  joy: "#eab308",
  anger: "#ef4444",
  sadness: "#3b82f6",
  happiness: "#22c55e",
  anxiety: "#a855f7",
  confidence: "#f97316",
};

const emotionIcons: Record<string, typeof SmilePlus> = {
  joy: SmilePlus,
  anger: Angry,
  sadness: Frown,
  happiness: Laugh,
  anxiety: ShieldAlert,
  confidence: Sparkles,
};

export default function EmotionJournal() {
  usePageMeta({ title: "感情ジャーナル", description: "ツインの感情マッピング", path: "/emotion-journal" });

  const [emotions, setEmotions] = useState({ joy: [0.5], anger: [0.2], sadness: [0.1], happiness: [0.5], anxiety: [0.2], confidence: [0.5] });
  const [context, setContext] = useState("");
  const [sourceType, setSourceType] = useState<"manual" | "matching" | "chat" | "coaching">("manual");
  const [analysisSourceType, setAnalysisSourceType] = useState<"matching" | "chat">("matching");
  const [analysisSourceId, setAnalysisSourceId] = useState("");
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [adviceResult, setAdviceResult] = useState<any>(null);

  const { data: journalData } = trpc.myTwin.getEmotionJournal.useQuery({ limit: 30 });
  const { data: timelineData } = trpc.myTwin.getEmotionTimeline.useQuery();
  const { data: alertsData, refetch: refetchAlerts } = trpc.myTwin.getEmotionAlerts.useQuery();

  const journalEntries = (journalData as any[]) || [];
  const timelineRaw = (timelineData as any[]) || [];
  const alerts = (alertsData as any[]) || [];

  // Transform timeline data for chart: flatten emotions into top-level fields
  const timelinePoints = timelineRaw.map((r: any) => {
    const emos = r.emotions || {};
    return {
      date: r.createdAt?.substring?.(0, 10) || "",
      joy: emos.joy ?? 0,
      anger: emos.anger ?? 0,
      sadness: emos.sadness ?? 0,
      happiness: emos.happiness ?? 0,
      anxiety: emos.anxiety ?? 0,
      confidence: emos.confidence ?? 0,
    };
  });

  const recordEmotion = trpc.myTwin.recordEmotion.useMutation({
    onSuccess: () => {
      toast.success("感情を記録しました");
      setContext("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const analyzeSession = trpc.myTwin.analyzeSessionEmotions.useMutation({
    onSuccess: (data: any) => {
      setAnalysisResult(data);
      toast.success("分析が完了しました");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const getAdvice = trpc.myTwin.getEmotionAdvice.useMutation({
    onSuccess: (data: any) => {
      setAdviceResult(data);
      toast.success("アドバイスを取得しました");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const markAlertRead = trpc.myTwin.markEmotionAlertRead.useMutation({
    onSuccess: () => refetchAlerts(),
  });

  const handleRecord = () => {
    recordEmotion.mutate({
      sourceType,
      emotions: {
        joy: emotions.joy[0],
        anger: emotions.anger[0],
        sadness: emotions.sadness[0],
        happiness: emotions.happiness[0],
        anxiety: emotions.anxiety[0],
        confidence: emotions.confidence[0],
      },
      context,
    });
  };

  const getStressBadge = (level: string) => {
    switch (level) {
      case "low": return <Badge className="bg-green-500 text-white">低</Badge>;
      case "medium": return <Badge className="bg-yellow-500 text-white">中</Badge>;
      case "high": return <Badge className="bg-red-500 text-white">高</Badge>;
      default: return <Badge variant="secondary">{level}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "high": return <Badge className="bg-red-100 text-red-700">高優先</Badge>;
      case "medium": return <Badge className="bg-yellow-100 text-yellow-700">中優先</Badge>;
      case "low": return <Badge className="bg-green-100 text-green-700">低優先</Badge>;
      default: return <Badge variant="secondary">{priority}</Badge>;
    }
  };

  const getDominantEmotionIcon = (emotion: string) => {
    const Icon = emotionIcons[emotion] || SmilePlus;
    return <Icon className="h-5 w-5" />;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <BookHeart className="h-7 w-7 text-pink-500" />
          <h1 className="text-2xl font-bold">感情ジャーナル</h1>
        </div>

        {alerts.length > 0 && (
          <div className="space-y-2">
            {alerts.map((alert: any) => (
              <Card key={alert.id} className="border-yellow-300 bg-yellow-50">
                <CardContent className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                    <span className="text-sm">{alert.message}</span>
                    <Badge variant="outline" className="text-xs">{alert.alertType}</Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => markAlertRead.mutate({ alertId: alert.id })}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Tabs defaultValue="timeline">
          <TabsList>
            <TabsTrigger value="timeline">タイムライン</TabsTrigger>
            <TabsTrigger value="record">記録</TabsTrigger>
            <TabsTrigger value="advice">アドバイス</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>感情推移</CardTitle>
              </CardHeader>
              <CardContent>
                {timelinePoints.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">まだデータがありません</p>
                ) : (
                  <ResponsiveContainer width="100%" height={350}>
                    <AreaChart data={timelinePoints}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      <YAxis domain={[0, 1]} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      {Object.entries(emotionColors).map(([key, color]) => (
                        <Area
                          key={key}
                          type="monotone"
                          dataKey={key}
                          name={emotionLabels[key]}
                          stroke={color}
                          fill={color}
                          fillOpacity={0.1}
                          strokeWidth={2}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <div className="space-y-3">
              {journalEntries.map((entry: any) => (
                <Card key={entry.id}>
                  <CardContent className="py-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-1">{getDominantEmotionIcon(entry.dominantEmotion)}</div>
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{emotionLabels[entry.dominantEmotion] || entry.dominantEmotion}</span>
                          <Badge variant="outline" className="text-xs">{entry.sourceType}</Badge>
                          <span className="text-xs text-muted-foreground ml-auto">
                            {new Date(entry.createdAt).toLocaleDateString("ja-JP")}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-primary rounded-full h-2"
                            style={{ width: `${Math.round((entry.intensity ?? 0) * 100)}%` }}
                          />
                        </div>
                        {entry.context && (
                          <p className="text-sm text-muted-foreground">{entry.context}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {journalEntries.length === 0 && (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    まだジャーナルエントリがありません。「記録」タブから感情を記録しましょう。
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="record" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>感情を記録</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(emotionLabels).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between">
                      <Label>{label}</Label>
                      <span className="text-sm text-muted-foreground">
                        {(emotions[key as keyof typeof emotions][0]).toFixed(2)}
                      </span>
                    </div>
                    <Slider
                      value={emotions[key as keyof typeof emotions]}
                      onValueChange={(v) => setEmotions((prev) => ({ ...prev, [key]: v }))}
                      min={0}
                      max={1}
                      step={0.01}
                    />
                  </div>
                ))}

                <div className="space-y-2">
                  <Label>コンテキスト</Label>
                  <Textarea
                    placeholder="どのような状況で感じた感情ですか？"
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>ソースタイプ</Label>
                  <Select value={sourceType} onValueChange={(v) => setSourceType(v as typeof sourceType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">手動</SelectItem>
                      <SelectItem value="matching">マッチング</SelectItem>
                      <SelectItem value="chat">チャット</SelectItem>
                      <SelectItem value="coaching">コーチング</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button onClick={handleRecord} disabled={recordEmotion.isPending} className="w-full">
                  {recordEmotion.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />記録中...</>
                  ) : (
                    "記録"
                  )}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>セッションから自動分析</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>ソースタイプ</Label>
                  <Select value={analysisSourceType} onValueChange={(v) => setAnalysisSourceType(v as "matching" | "chat")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="matching">マッチング</SelectItem>
                      <SelectItem value="chat">チャット</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>ソースID</Label>
                  <Input
                    placeholder="セッションIDを入力"
                    value={analysisSourceId}
                    onChange={(e) => setAnalysisSourceId(e.target.value)}
                  />
                </div>
                <Button
                  onClick={() => analyzeSession.mutate({ sourceType: analysisSourceType, sourceId: Number(analysisSourceId) })}
                  disabled={analyzeSession.isPending || !analysisSourceId}
                  variant="outline"
                  className="w-full"
                >
                  {analyzeSession.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />分析中...</>
                  ) : (
                    "分析"
                  )}
                </Button>

                {analysisResult && (
                  <Card className="bg-muted/50">
                    <CardContent className="py-4 space-y-3">
                      <h4 className="font-semibold">分析結果</h4>
                      <div className="grid grid-cols-3 gap-2">
                        {Object.entries(analysisResult.emotions || {}).map(([key, val]) => (
                          <div key={key} className="text-center">
                            <p className="text-xs text-muted-foreground">{emotionLabels[key] || key}</p>
                            <p className="font-bold">{typeof val === "number" ? val.toFixed(2) : String(val)}</p>
                          </div>
                        ))}
                      </div>
                      {analysisResult.summary && (
                        <p className="text-sm text-muted-foreground">{analysisResult.summary}</p>
                      )}
                      {analysisResult.transitions?.length > 0 && (
                        <div>
                          <p className="text-sm font-medium">感情の遷移:</p>
                          <ul className="list-disc list-inside text-sm text-muted-foreground">
                            {analysisResult.transitions.map((t: any, i: number) => (
                              <li key={i}>{typeof t === "string" ? t : `Turn ${t.turn}: ${t.emotion} (${t.intensity})`}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {analysisResult.stressIndicators?.length > 0 && (
                        <div>
                          <p className="text-sm font-medium">ストレス指標:</p>
                          <ul className="list-disc list-inside text-sm text-muted-foreground">
                            {analysisResult.stressIndicators.map((s: string, i: number) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="advice" className="space-y-6">
            <Button
              onClick={() => getAdvice.mutate()}
              disabled={getAdvice.isPending}
              className="w-full"
            >
              {getAdvice.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />アドバイス取得中...</>
              ) : (
                <><Lightbulb className="h-4 w-4 mr-2" />AIアドバイスを取得</>
              )}
            </Button>

            {adviceResult && (
              <div className="space-y-4">
                <Card>
                  <CardContent className="py-4">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="text-sm text-muted-foreground">全体的な気分</p>
                        <p className="font-semibold">{adviceResult.overallMood}</p>
                      </div>
                      <div className="ml-auto">
                        <p className="text-sm text-muted-foreground">ストレスレベル</p>
                        {getStressBadge(adviceResult.stressLevel)}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {adviceResult.advice?.map((item: any, i: number) => (
                  <Card key={i}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{item.title}</CardTitle>
                        {getPriorityBadge(item.priority)}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">{item.description || item.content}</p>
                    </CardContent>
                  </Card>
                ))}

                {adviceResult.recommendation && (
                  <Card className="border-primary/30 bg-primary/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Lightbulb className="h-4 w-4" />
                        おすすめのまとめ
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm">{adviceResult.recommendation}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {!adviceResult && !getAdvice.isPending && (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  ボタンを押してAIからの感情アドバイスを取得しましょう
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
