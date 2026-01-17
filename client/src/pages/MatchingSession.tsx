import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { useParams, Link } from "wouter";
import { ArrowLeft, Bot, Loader2, BarChart3, MessageSquare, Lightbulb, AlertTriangle, CheckCircle, Download, FileText, Users, Calendar, DollarSign, Target, Rocket, Presentation, Image, FileDown } from "lucide-react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";

export default function MatchingSession() {
  const { id } = useParams<{ id: string }>();
  const sessionId = parseInt(id || "0");

  const { data, isLoading } = trpc.matching.getSession.useQuery(
    { id: sessionId },
    { enabled: sessionId > 0 }
  );

  const { data: reportData, refetch: fetchReport, isFetching: isExporting } = trpc.matching.exportReport.useQuery(
    { sessionId },
    { enabled: false }
  );

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

  const handleExportHtml = async () => {
    try {
      const result = await fetchReport();
      if (result.data?.html) {
        const blob = new Blob([result.data.html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `matching-report-${sessionId}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("HTMLレポートをダウンロードしました");
      }
    } catch (error) {
      toast.error("レポートの生成に失敗しました");
    }
  };

  const generatePresentationMutation = trpc.matching.generatePresentation.useMutation({
    onSuccess: (data) => {
      // Store the slide content and trigger the presentation generation
      const slideContent = data.slideContent;
      // Save to localStorage for the slides page to pick up
      localStorage.setItem(`presentation-${sessionId}`, JSON.stringify({
        markdown: slideContent.markdown,
        slideCount: slideContent.slideCount,
        sessionId,
      }));
      // Open presentation page
      window.open(`/presentation/${sessionId}`, "_blank");
      toast.success("プレゼン資料を生成しました");
    },
    onError: () => {
      toast.error("プレゼン資料の生成に失敗しました");
    },
  });

  const handleGeneratePresentation = () => {
    generatePresentationMutation.mutate({ sessionId });
  };

  const generateNanoBananaMutation = trpc.matching.generateNanoBananaSlides.useMutation({
    onSuccess: (data) => {
      // Save slide data for nano banana generation
      localStorage.setItem(`nano-banana-${sessionId}`, JSON.stringify({
        slideContentFile: data.slideContentFile,
        slideCount: data.slideCount,
        slides: data.slides,
        theme: data.theme,
        twin1Name: data.twin1Name,
        twin2Name: data.twin2Name,
        compatibilityScore: data.compatibilityScore,
        sessionId,
      }));
      // Open nano banana presentation page
      window.open(`/nano-banana/${sessionId}`, "_blank");
      toast.success("画像ベースのプレゼン資料を生成しました");
    },
    onError: () => {
      toast.error("プレゼン資料の生成に失敗しました");
    },
  });

  const handleGenerateNanoBanana = () => {
    generateNanoBananaMutation.mutate({ sessionId });
  };

  const exportPptxMutation = trpc.matching.exportPptx.useMutation({
    onSuccess: (data) => {
      window.open(data.url, "_blank");
      toast.success("PPTXファイルをダウンロードしました");
    },
    onError: () => {
      toast.error("PPTXの生成に失敗しました");
    },
  });

  const handleExportPptx = () => {
    exportPptxMutation.mutate({ sessionId });
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

  if (!data?.session) {
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
          
          {/* Export Buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportHtml}
              disabled={isExporting}
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileText className="h-4 w-4 mr-2" />
              )}
              HTML
            </Button>
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
              onClick={handleGeneratePresentation}
              disabled={generatePresentationMutation.isPending}
            >
              {generatePresentationMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Presentation className="h-4 w-4 mr-2" />
              )}
              スライド
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleGenerateNanoBanana}
              disabled={generateNanoBananaMutation.isPending}
            >
              {generateNanoBananaMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Image className="h-4 w-4 mr-2" />
              )}
              画像スライド
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPptx}
              disabled={exportPptxMutation.isPending}
            >
              {exportPptxMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4 mr-2" />
              )}
              PPTX
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
                        {result.strengths.map((strength, i) => (
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
                        {result.challenges.map((challenge, i) => (
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
                        {result.recommendations.map((rec, i) => (
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
