import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc, API_BASE } from "@/lib/trpc";
import { useParams, Link } from "wouter";
import { useState } from "react";
import { ArrowLeft, Bot, Loader2, BarChart3, MessageSquare, Lightbulb, AlertTriangle, CheckCircle, Download, Users, Calendar, DollarSign, Target, Rocket, Share2, Link as LinkIcon, ExternalLink, Search, Globe } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LazyStreamdown as Streamdown } from "@/components/LazyStreamdown";
import { toast } from "sonner";

export default function MatchingSession() {
  const { id } = useParams<{ id: string }>();
  const sessionId = parseInt(id || "0");
  usePageMeta({ title: `マッチングセッション #${sessionId}`, description: "マッチング結果の詳細を確認。スコア、対話履歴、分析レポートを閲覧できます。", ogImage: "https://bunshin-ai.pages.dev/og/matching.svg", path: `/matching/${id}` });

  const { data, isLoading, isError } = trpc.matching.getSession.useQuery(
    { id: sessionId },
    { enabled: sessionId > 0 }
  );

  const { data: reportData, refetch: fetchReport, isFetching: isExporting } = trpc.matching.exportReport.useQuery(
    { sessionId },
    { enabled: false }
  );

  const [searchQuery, setSearchQuery] = useState("");
  const webSearchMutation = trpc.matching.webSearch.useMutation();
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const handleWebSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      const result = await webSearchMutation.mutateAsync({ query: searchQuery, sessionId });
      setSearchResults(prev => [result, ...prev]);
      setSearchQuery("");
    } catch (e: any) {
      toast.error(e.message || "検索に失敗しました");
    }
  };

  const handleExportPdf = async () => {
    try {
      const result = await fetchReport();
      if (result.data?.html) {
        // Open HTML in new window for printing
        const printWindow = window.open("", "_blank");
        if (printWindow) {
          printWindow.document.write(result.data.html);
          printWindow.document.close();
          toast.success("レポートを新しいタブで開きました。印刷またはPDF保存してください。");
        }
      }
    } catch (error) {
      toast.error("レポートの生成に失敗しました");
    }
  };

  const shareUrl = `https://bunshin-ai.pages.dev/matching/${sessionId}`;

  const handleShare = async () => {
    const shareText = data?.result
      ? `「${data.session.theme}」のマッチング結果: 相性 ${parseFloat(data.result.compatibilityScore || "0")}%`
      : `「${data?.session.theme}」のマッチングセッション`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "分身AI - マッチング結果",
          text: shareText,
          url: shareUrl,
        });
      } catch {
        // User cancelled
      }
    } else {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      toast.success("リンクをクリップボードにコピーしました");
    }
  };

  const handleShareLine = () => {
    const text = encodeURIComponent(
      data?.result
        ? `「${data.session.theme}」のマッチング結果: 相性 ${parseFloat(data.result.compatibilityScore || "0")}%\n${shareUrl}`
        : `「${data?.session.theme}」のマッチングセッション\n${shareUrl}`
    );
    window.open(`https://line.me/R/share?text=${text}`, "_blank");
  };

  const handleShareTwitter = () => {
    const text = encodeURIComponent(
      data?.result
        ? `「${data.session.theme}」のマッチング結果: 相性 ${parseFloat(data.result.compatibilityScore || "0")}% #分身AI`
        : `「${data?.session.theme}」のマッチングセッション #分身AI`
    );
    const url = encodeURIComponent(shareUrl);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank");
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    toast.success("リンクをクリップボードにコピーしました");
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (isError || !data?.session) {
    return (
      <DashboardLayout>
        <div className="text-center py-16">
          <p className="text-muted-foreground">セッションが見つかりません</p>
          <Link href="/matching">
            <Button className="mt-4">一覧に戻る</Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  const { session, twin1, twin2, dialogues, result } = data;
  const compatibilityScore = result?.compatibilityScore ? parseFloat(result.compatibilityScore) : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/matching">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">{session.theme}</h1>
              <p className="text-muted-foreground">
                {twin1?.name || `Twin #${session.twin1Id}`} × {twin2?.name || `Twin #${session.twin2Id}`}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Share Button */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Share2 className="h-4 w-4 mr-2" />
                  共有
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleShare}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  共有...
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleShareLine}>
                  <MessageSquare className="h-4 w-4 mr-2" />
                  LINEで共有
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleShareTwitter}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Xで共有
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyLink}>
                  <LinkIcon className="h-4 w-4 mr-2" />
                  リンクをコピー
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Export Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPdf}
              disabled={isExporting}
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              PDF印刷
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`${API_BASE}/api/export/matching/${sessionId}/csv`, '_blank')}
            >
              <Download className="h-4 w-4 mr-2" />
              CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`${API_BASE}/api/export/matching/${sessionId}/pdf`, '_blank')}
            >
              <Download className="h-4 w-4 mr-2" />
              レポート
            </Button>
          </div>
        </div>

        {/* Score Overview */}
        {result && (
          <Card className="border-primary/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                マッチング結果
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-muted-foreground">相性スコア</span>
                      <span className="text-2xl font-bold text-primary">{compatibilityScore}%</span>
                    </div>
                    <Progress value={compatibilityScore} className="h-3" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">総合評価</p>
                    <p className="font-medium">{result.summary}</p>
                  </div>
                </div>
                
                {/* Score Breakdown */}
                {result.scoreBreakdown && (
                  <div className="border-t pt-4">
                    <h4 className="text-sm font-medium mb-4">スコア内訳（5つの観点×20点満点）</h4>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {/* Skill Match */}
                      <div className="bg-muted/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">スキルマッチ度</span>
                          <span className="text-sm font-bold text-primary">
                            {result.scoreBreakdown.skillMatch?.score || 0}/20
                          </span>
                        </div>
                        <Progress value={(result.scoreBreakdown.skillMatch?.score || 0) * 5} className="h-2 mb-2" />
                        <p className="text-xs text-muted-foreground">
                          {result.scoreBreakdown.skillMatch?.reason || "データなし"}
                        </p>
                      </div>
                      
                      {/* Value Alignment */}
                      <div className="bg-muted/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">価値観の一致度</span>
                          <span className="text-sm font-bold text-primary">
                            {result.scoreBreakdown.valueAlignment?.score || 0}/20
                          </span>
                        </div>
                        <Progress value={(result.scoreBreakdown.valueAlignment?.score || 0) * 5} className="h-2 mb-2" />
                        <p className="text-xs text-muted-foreground">
                          {result.scoreBreakdown.valueAlignment?.reason || "データなし"}
                        </p>
                      </div>
                      
                      {/* Communication Style */}
                      <div className="bg-muted/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">コミュニケーション</span>
                          <span className="text-sm font-bold text-primary">
                            {result.scoreBreakdown.communicationStyle?.score || 0}/20
                          </span>
                        </div>
                        <Progress value={(result.scoreBreakdown.communicationStyle?.score || 0) * 5} className="h-2 mb-2" />
                        <p className="text-xs text-muted-foreground">
                          {result.scoreBreakdown.communicationStyle?.reason || "データなし"}
                        </p>
                      </div>
                      
                      {/* Business Goal Fit */}
                      <div className="bg-muted/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">ビジネス目標適合度</span>
                          <span className="text-sm font-bold text-primary">
                            {result.scoreBreakdown.businessGoalFit?.score || 0}/20
                          </span>
                        </div>
                        <Progress value={(result.scoreBreakdown.businessGoalFit?.score || 0) * 5} className="h-2 mb-2" />
                        <p className="text-xs text-muted-foreground">
                          {result.scoreBreakdown.businessGoalFit?.reason || "データなし"}
                        </p>
                      </div>
                      
                      {/* Complementary Strengths */}
                      <div className="bg-muted/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">相互補完性</span>
                          <span className="text-sm font-bold text-primary">
                            {result.scoreBreakdown.complementaryStrengths?.score || 0}/20
                          </span>
                        </div>
                        <Progress value={(result.scoreBreakdown.complementaryStrengths?.score || 0) * 5} className="h-2 mb-2" />
                        <p className="text-xs text-muted-foreground">
                          {result.scoreBreakdown.complementaryStrengths?.reason || "データなし"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="dialogue">
          <TabsList>
            <TabsTrigger value="dialogue">
              <MessageSquare className="h-4 w-4 mr-2" />
              対話内容
            </TabsTrigger>
            <TabsTrigger value="analysis" disabled={!result}>
              <BarChart3 className="h-4 w-4 mr-2" />
              詳細分析
            </TabsTrigger>
            <TabsTrigger value="websearch">
              <Search className="h-4 w-4 mr-2" />
              Web検索
            </TabsTrigger>
          </TabsList>

          {/* Dialogue Tab */}
          <TabsContent value="dialogue">
            <Card>
              <CardHeader>
                <CardTitle>対話履歴</CardTitle>
                <CardDescription>
                  分身AI同士の対話内容（{dialogues?.length || 0}ターン）
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px] pr-4">
                  <div className="space-y-4">
                    {dialogues && dialogues.length > 0 ? (
                      dialogues.map((dialogue, i) => {
                        const isTwin1 = dialogue.speakerTwinId === session.twin1Id;
                        const speakerName = isTwin1 ? twin1?.name : twin2?.name;

                        return (
                          <div
                            key={dialogue.id}
                            className={`flex gap-3 ${isTwin1 ? "" : "flex-row-reverse"}`}
                          >
                            <div
                              className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                                isTwin1 ? "bg-primary/20" : "bg-accent/20"
                              }`}
                            >
                              <Bot className={`h-5 w-5 ${isTwin1 ? "text-primary" : "text-accent"}`} />
                            </div>
                            <div
                              className={`flex-1 max-w-[80%] ${isTwin1 ? "" : "text-right"}`}
                            >
                              <p className="text-sm font-medium mb-1">
                                {speakerName || `Twin #${dialogue.speakerTwinId}`}
                              </p>
                              <div
                                className={`rounded-lg p-3 ${
                                  isTwin1 ? "bg-muted" : "bg-accent/10"
                                }`}
                              >
                                <Streamdown>{dialogue.content}</Streamdown>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center py-8">
                        <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                        <p className="text-muted-foreground">対話がまだ行われていません</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Web Search Tab */}
          <TabsContent value="websearch">
            <div className="space-y-4">
              {/* Auto search results from dialogue */}
              {data?.session?.settings?.webSearchResults && data.session.settings.webSearchResults.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="h-5 w-5 text-blue-500" />
                      対話中のリアルタイム検索結果
                    </CardTitle>
                    <CardDescription>マッチング対話中に自動で検索された情報</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {data.session.settings.webSearchResults.map((sr: any, i: number) => (
                        <div key={i} className="border rounded-lg p-3 space-y-2">
                          <p className="text-sm font-medium text-primary">"{sr.query}"</p>
                          {sr.answer && <p className="text-sm text-muted-foreground">{sr.answer}</p>}
                          {sr.sources?.map((s: any, j: number) => (
                            <a key={j} href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-blue-500 hover:underline">
                              <ExternalLink className="h-3 w-3" />
                              {s.title}
                            </a>
                          ))}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Manual search */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Search className="h-5 w-5 text-primary" />
                    追加検索
                  </CardTitle>
                  <CardDescription>テーマに関連する情報を検索</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="検索キーワードを入力..."
                      onKeyDown={(e) => e.key === "Enter" && handleWebSearch()}
                    />
                    <Button onClick={handleWebSearch} disabled={webSearchMutation.isPending || !searchQuery.trim()}>
                      {webSearchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                  </div>

                  {searchResults.length > 0 && (
                    <div className="mt-4 space-y-4">
                      {searchResults.map((sr, i) => (
                        <div key={i} className="border rounded-lg p-4 space-y-3">
                          <p className="text-sm font-medium">"{sr.query}"</p>
                          {sr.answer && (
                            <div className="bg-primary/5 rounded-lg p-3">
                              <p className="text-sm">{sr.answer}</p>
                            </div>
                          )}
                          <div className="space-y-2">
                            {sr.results?.map((r: any, j: number) => (
                              <div key={j} className="border-l-2 border-primary/30 pl-3">
                                <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-500 hover:underline">
                                  {r.title}
                                </a>
                                <p className="text-xs text-muted-foreground mt-1">{r.content}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Analysis Tab */}
          <TabsContent value="analysis">
            {result && (
              <div className="grid gap-6 md:grid-cols-2">
                {/* Collaboration Potential */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Lightbulb className="h-5 w-5 text-yellow-500" />
                      協業可能性
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">{result.collaborationPotential}</p>
                  </CardContent>
                </Card>

                {/* Strengths */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                      強み
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {result.strengths && result.strengths.length > 0 ? (
                      <ul className="space-y-2">
                        {result.strengths.map((strength: string, i: number) => (
                          <li key={i} className="flex items-start gap-2">
                            <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                            <span className="text-sm">{strength}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">データなし</p>
                    )}
                  </CardContent>
                </Card>

                {/* Challenges */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      課題
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {result.challenges && result.challenges.length > 0 ? (
                      <ul className="space-y-2">
                        {result.challenges.map((challenge: string, i: number) => (
                          <li key={i} className="flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                            <span className="text-sm">{challenge}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">データなし</p>
                    )}
                  </CardContent>
                </Card>

                {/* Recommendations */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Lightbulb className="h-5 w-5 text-primary" />
                      提案
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {result.recommendations && result.recommendations.length > 0 ? (
                      <ul className="space-y-2">
                        {result.recommendations.map((rec: string, i: number) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="h-5 w-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center flex-shrink-0">
                              {i + 1}
                            </span>
                            <span className="text-sm">{rec}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">データなし</p>
                    )}
                  </CardContent>
                </Card>

                {/* Role Distribution */}
                {result.roleDistribution && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-blue-500" />
                        役割分担
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Streamdown>{result.roleDistribution}</Streamdown>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Timeline */}
                {result.timeline && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Calendar className="h-5 w-5 text-purple-500" />
                        タイムライン
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Streamdown>{result.timeline}</Streamdown>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Resources */}
                {result.resources && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <DollarSign className="h-5 w-5 text-green-500" />
                        必要リソース
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Streamdown>{result.resources}</Streamdown>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* KPIs */}
                {result.kpis && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Target className="h-5 w-5 text-red-500" />
                        期待成果・KPI
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Streamdown>{result.kpis}</Streamdown>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Next Steps */}
                {result.nextSteps && (
                  <Card className="md:col-span-2 border-primary/50 bg-primary/5">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Rocket className="h-5 w-5 text-primary" />
                        明日からできるアクション
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Streamdown>{result.nextSteps}</Streamdown>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Detailed Analysis */}
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle>詳細分析</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <Streamdown>{result.detailedAnalysis || "詳細分析データがありません"}</Streamdown>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
