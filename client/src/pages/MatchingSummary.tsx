import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, FileText, Send, ThumbsUp, ThumbsDown, AlertTriangle, CheckCircle, ArrowRight, Mail } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";

export default function MatchingSummary() {
  usePageMeta({ title: "AI要約", description: "マッチング要約の生成と配信", path: "/matching-summary" });

  const [selectedSession, setSelectedSession] = useState<string>("");
  const [channels, setChannels] = useState<string[]>([]);
  const [rated, setRated] = useState<"up" | "down" | null>(null);

  const { data: sessions } = trpc.matching.sessions.useQuery();
  const { data: summaryData, isLoading: summaryLoading, refetch: refetchSummary } = trpc.matching.getMatchingSummary.useQuery(
    { sessionId: Number(selectedSession) },
    { enabled: !!selectedSession }
  );

  const generateMut = trpc.matching.generateMatchingSummary.useMutation({
    onSuccess: () => {
      toast.success("要約を生成しました");
      refetchSummary();
    },
    onError: (e: any) => toast.error(e.message || "要約生成に失敗しました"),
  });

  const distributeMut = trpc.matching.distributeSummary.useMutation({
    onSuccess: () => toast.success("要約を配信しました"),
    onError: (e: any) => toast.error(e.message || "配信に失敗しました"),
  });

  const rateMut = trpc.matching.rateSummary.useMutation({
    onSuccess: () => toast.success("フィードバックを送信しました"),
    onError: (e: any) => toast.error(e.message || "フィードバック送信に失敗しました"),
  });

  const completedSessions = (sessions ?? []).filter((s: any) => s.status === "completed");
  const summary = generateMut.data || summaryData;

  const toggleChannel = (ch: string) => {
    setChannels((prev) => prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]);
  };

  const handleRate = (rating: "up" | "down") => {
    if (!selectedSession || !summary) return;
    setRated(rating);
    rateMut.mutate({ sessionId: Number(selectedSession), rating });
  };

  const priorityColor = (p: string) => {
    switch (p) {
      case "high": return "destructive";
      case "medium": return "secondary";
      case "low": return "outline";
      default: return "secondary";
    }
  };

  const priorityLabel = (p: string) => {
    switch (p) {
      case "high": return "高";
      case "medium": return "中";
      case "low": return "低";
      default: return p;
    }
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6" /> AI要約
          </h1>
          <p className="text-muted-foreground text-sm mt-1">マッチング対話からAIが要約・合意事項・課題を抽出</p>
        </div>

        <Tabs defaultValue="generate">
          <TabsList>
            <TabsTrigger value="generate">要約生成</TabsTrigger>
            <TabsTrigger value="history">履歴</TabsTrigger>
          </TabsList>

          {/* Tab 1: Generate Summary */}
          <TabsContent value="generate" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">セッション選択</CardTitle>
                <CardDescription>完了済みマッチングセッションから要約を生成</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <Select value={selectedSession} onValueChange={setSelectedSession}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="セッションを選択..." />
                    </SelectTrigger>
                    <SelectContent>
                      {completedSessions.map((s: any) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          #{s.id} - {s.theme || "テーマなし"} ({s.status})
                        </SelectItem>
                      ))}
                      {completedSessions.length === 0 && (
                        <SelectItem value="_none" disabled>完了済みセッションがありません</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => generateMut.mutate({ sessionId: Number(selectedSession) })}
                    disabled={!selectedSession || generateMut.isPending}
                  >
                    {generateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
                    要約生成
                  </Button>
                </div>
              </CardContent>
            </Card>

            {summaryLoading && selectedSession && (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            )}

            {summary && (
              <>
                {/* Summary Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-5 w-5" /> 要約
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{summary.summary || "要約データなし"}</p>
                  </CardContent>
                </Card>

                {/* Agreements */}
                {summary.agreements && summary.agreements.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <CheckCircle className="h-5 w-5 text-green-500" /> 合意事項
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {summary.agreements.map((a: string, i: number) => (
                          <Badge key={i} variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-800">
                            <CheckCircle className="h-3 w-3 mr-1" />{a}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Open Issues */}
                {summary.openIssues && summary.openIssues.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-yellow-500" /> 未解決課題
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {summary.openIssues.map((issue: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                          <Badge variant={priorityColor(issue.priority) as any}>
                            {priorityLabel(issue.priority)}
                          </Badge>
                          <span className="text-sm">{issue.description || issue}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Next Steps */}
                {summary.nextSteps && summary.nextSteps.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <ArrowRight className="h-5 w-5 text-blue-500" /> ネクストステップ
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {summary.nextSteps.map((step: any, i: number) => (
                        <Card key={i} className="border-l-4 border-l-blue-500">
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="space-y-1">
                                <p className="text-sm font-medium">{step.action || step}</p>
                                {step.owner && (
                                  <p className="text-xs text-muted-foreground">担当: {step.owner}</p>
                                )}
                              </div>
                              {step.deadline && (
                                <Badge variant="outline" className="text-xs shrink-0">{step.deadline}</Badge>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Risks */}
                {summary.risks && summary.risks.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-red-500" /> リスク
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {summary.risks.map((risk: any, i: number) => (
                        <Card key={i} className="border border-red-200 dark:border-red-800">
                          <CardContent className="p-3 space-y-1">
                            <p className="text-sm font-medium text-red-600 dark:text-red-400">
                              <AlertTriangle className="h-3 w-3 inline mr-1" />{risk.description || risk}
                            </p>
                            {risk.mitigation && (
                              <p className="text-xs text-muted-foreground">対策: {risk.mitigation}</p>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Distribution & Feedback */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Send className="h-5 w-5" /> 配信 & フィードバック
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Channel selection */}
                    <div className="space-y-2">
                      <p className="text-sm font-medium">配信チャネル</p>
                      <div className="flex flex-wrap gap-4">
                        {[
                          { id: "email", label: "メール", icon: Mail },
                          { id: "slack", label: "Slack", icon: Send },
                          { id: "line", label: "LINE", icon: Send },
                          { id: "app", label: "アプリ内", icon: FileText },
                        ].map((ch) => (
                          <label key={ch.id} className="flex items-center gap-2 cursor-pointer">
                            <Checkbox
                              checked={channels.includes(ch.id)}
                              onCheckedChange={() => toggleChannel(ch.id)}
                            />
                            <ch.icon className="h-4 w-4" />
                            <span className="text-sm">{ch.label}</span>
                          </label>
                        ))}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => distributeMut.mutate({ sessionId: Number(selectedSession), channels: channels as ("email" | "slack" | "app" | "line")[] })}
                        disabled={channels.length === 0 || distributeMut.isPending}
                      >
                        {distributeMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                        配信する
                      </Button>
                    </div>

                    {/* Feedback */}
                    <div className="flex items-center gap-3 pt-2 border-t">
                      <p className="text-sm font-medium">この要約は役に立ちましたか？</p>
                      <Button
                        size="sm"
                        variant={rated === "up" ? "default" : "outline"}
                        onClick={() => handleRate("up")}
                        disabled={rateMut.isPending}
                      >
                        <ThumbsUp className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant={rated === "down" ? "destructive" : "outline"}
                        onClick={() => handleRate("down")}
                        disabled={rateMut.isPending}
                      >
                        <ThumbsDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* Tab 2: History */}
          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">要約履歴</CardTitle>
                <CardDescription>セッションを選択すると、最後に生成した要約を表示します</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Select value={selectedSession} onValueChange={setSelectedSession}>
                  <SelectTrigger>
                    <SelectValue placeholder="セッションを選択..." />
                  </SelectTrigger>
                  <SelectContent>
                    {completedSessions.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        #{s.id} - {s.theme || "テーマなし"}
                      </SelectItem>
                    ))}
                    {completedSessions.length === 0 && (
                      <SelectItem value="_none" disabled>完了済みセッションがありません</SelectItem>
                    )}
                  </SelectContent>
                </Select>

                {summaryLoading && selectedSession && (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}

                {summary && !summaryLoading && (
                  <div className="space-y-3">
                    <Card className="bg-muted/30">
                      <CardContent className="p-4">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{summary.summary || "要約なし"}</p>
                      </CardContent>
                    </Card>
                    {summary.agreements && summary.agreements.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {summary.agreements.map((a: string, i: number) => (
                          <Badge key={i} variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                            <CheckCircle className="h-3 w-3 mr-1" />{a}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {summary.createdAt && (
                      <p className="text-xs text-muted-foreground">生成日時: {new Date(summary.createdAt).toLocaleString("ja-JP")}</p>
                    )}
                  </div>
                )}

                {!summary && !summaryLoading && selectedSession && (
                  <p className="text-sm text-muted-foreground text-center py-4">このセッションの要約はまだ生成されていません</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
