import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { FileText, Share2, Mail, Download, Sparkles, Brain, Trophy, TrendingUp, Loader2 } from "lucide-react";
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer } from "recharts";

const SCORE_LABELS: Record<string, string> = {
  overall: "総合",
  communication: "コミュニケーション",
  expertise: "専門性",
  adaptability: "適応力",
  leadership: "リーダーシップ",
};

const SCORE_COLORS: Record<string, string> = {
  overall: "bg-amber-500/20 text-amber-400",
  communication: "bg-blue-500/20 text-blue-400",
  expertise: "bg-purple-500/20 text-purple-400",
  adaptability: "bg-green-500/20 text-green-400",
  leadership: "bg-red-500/20 text-red-400",
};

export default function PersonalityReport() {
  usePageMeta({ title: "人格レポート", description: "AIパーソナリティ分析レポート", path: "/personality-report" });

  const [activeTab, setActiveTab] = useState("report");

  const reportQuery = trpc.myTwin.getPersonalityReport.useQuery();

  const generateMutation = trpc.myTwin.generatePersonalityReport.useMutation({
    onSuccess: () => {
      reportQuery.refetch();
      toast.success("レポートを生成しました");
    },
    onError: (err: any) => toast.error(err.message || "生成に失敗しました"),
  });

  const shareMutation = trpc.myTwin.sharePersonalityReport.useMutation({
    onSuccess: (data: any) => {
      if (data?.shareCode) {
        navigator.clipboard.writeText(data.shareCode);
        toast.success(`共有コード: ${data.shareCode} (コピー済み)`);
      } else {
        toast.success("共有リンクを生成しました");
      }
    },
    onError: (err: any) => toast.error(err.message || "共有に失敗しました"),
  });

  const emailMutation = trpc.myTwin.sendPersonalityReportEmail.useMutation({
    onSuccess: () => toast.success("メールを送信しました"),
    onError: (err: any) => toast.error(err.message || "送信に失敗しました"),
  });

  const report = reportQuery.data as any;
  const scores = report?.scores ?? {};
  const radarData = Object.entries(SCORE_LABELS).map(([key, label]) => ({
    subject: label,
    value: scores[key] ?? 0,
    fullMark: 100,
  }));

  const handleDownloadHtml = () => {
    if (!report?.reportHtml) return;
    const blob = new Blob([report.reportHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "personality-report.html";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/20">
            <FileText className="h-6 w-6 text-purple-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">人格レポート</h1>
            <p className="text-sm text-muted-foreground">AIによるパーソナリティ分析レポート</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="report">
              <Sparkles className="h-4 w-4 mr-1" />
              レポート生成
            </TabsTrigger>
            <TabsTrigger value="preview">
              <FileText className="h-4 w-4 mr-1" />
              プレビュー
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Report */}
          <TabsContent value="report" className="space-y-4">
            <div className="flex gap-2">
              <Button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
              >
                {generateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                レポート生成
              </Button>
              {report && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => shareMutation.mutate()}
                    disabled={shareMutation.isPending}
                  >
                    <Share2 className="h-4 w-4 mr-2" />
                    共有
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => emailMutation.mutate()}
                    disabled={emailMutation.isPending}
                  >
                    <Mail className="h-4 w-4 mr-2" />
                    メール
                  </Button>
                </>
              )}
            </div>

            {!report ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>レポートを生成してパーソナリティ分析を確認しましょう</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Executive Summary */}
                {report.executiveSummary && (
                  <Card className="border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-pink-500/5">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-purple-400" />
                        エグゼクティブサマリー
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-relaxed">{report.executiveSummary}</p>
                    </CardContent>
                  </Card>
                )}

                {/* Score Bars */}
                <Card>
                  <CardHeader>
                    <CardTitle>スコア概要</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {Object.entries(SCORE_LABELS).map(([key, label]) => (
                      <div key={key} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{label}</span>
                          <Badge variant="outline" className={SCORE_COLORS[key]}>
                            {scores[key] ?? 0}
                          </Badge>
                        </div>
                        <Progress value={scores[key] ?? 0} className="h-2" />
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Radar Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle>レーダーチャート</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={radarData}>
                          <PolarGrid stroke="hsl(var(--border))" />
                          <PolarAngleAxis
                            dataKey="subject"
                            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                          />
                          <PolarRadiusAxis
                            angle={90}
                            domain={[0, 100]}
                            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                          />
                          <Radar
                            name="スコア"
                            dataKey="value"
                            stroke="hsl(280, 80%, 60%)"
                            fill="hsl(280, 80%, 60%)"
                            fillOpacity={0.3}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                {/* Strengths & Growth */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card className="border-green-500/30">
                    <CardHeader>
                      <CardTitle className="text-green-400 flex items-center gap-2">
                        <Trophy className="h-5 w-5" />
                        強み
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {(report.strengths ?? []).map((s: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="text-green-400">●</span>
                            <span>{s}</span>
                          </li>
                        ))}
                        {(!report.strengths || report.strengths.length === 0) && (
                          <li className="text-sm text-muted-foreground">データなし</li>
                        )}
                      </ul>
                    </CardContent>
                  </Card>
                  <Card className="border-orange-500/30">
                    <CardHeader>
                      <CardTitle className="text-orange-400 flex items-center gap-2">
                        <TrendingUp className="h-5 w-5" />
                        成長エリア
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {(report.growthAreas ?? []).map((g: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="text-orange-400">●</span>
                            <span>{g}</span>
                          </li>
                        ))}
                        {(!report.growthAreas || report.growthAreas.length === 0) && (
                          <li className="text-sm text-muted-foreground">データなし</li>
                        )}
                      </ul>
                    </CardContent>
                  </Card>
                </div>

                {/* Communication Style */}
                {report.communicationStyle && (
                  <Card>
                    <CardHeader>
                      <CardTitle>コミュニケーションスタイル</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-relaxed">{report.communicationStyle}</p>
                    </CardContent>
                  </Card>
                )}

                {/* Matching Advice */}
                {report.matchingAdvice && (
                  <Card>
                    <CardHeader>
                      <CardTitle>マッチングアドバイス</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-relaxed">{report.matchingAdvice}</p>
                    </CardContent>
                  </Card>
                )}

                {/* Future Outlook */}
                {report.futureOutlook && (
                  <Card>
                    <CardHeader>
                      <CardTitle>今後の展望</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-relaxed">{report.futureOutlook}</p>
                    </CardContent>
                  </Card>
                )}

                {/* Big Five */}
                {report.bigFive && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Brain className="h-5 w-5 text-blue-400" />
                        Big Five
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {Object.entries(report.bigFive as Record<string, number>).map(([trait, value]) => (
                        <div key={trait} className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="capitalize">{trait}</span>
                            <span>{value}%</span>
                          </div>
                          <Progress value={value} className="h-2" />
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* MBTI */}
                {report.mbtiType && (
                  <Card>
                    <CardHeader>
                      <CardTitle>MBTI</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-center">
                        <p className="text-4xl font-bold text-primary">{report.mbtiType}</p>
                        {report.mbtiDescription && (
                          <p className="text-sm text-muted-foreground mt-2">{report.mbtiDescription}</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Matching Stats */}
                {report.matchingStats && (
                  <Card>
                    <CardHeader>
                      <CardTitle>マッチング統計</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <p className="text-2xl font-bold text-primary">
                            {report.matchingStats.total ?? 0}
                          </p>
                          <p className="text-xs text-muted-foreground">総マッチング</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-green-400">
                            {report.matchingStats.avgScore ?? 0}
                          </p>
                          <p className="text-xs text-muted-foreground">平均スコア</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-amber-400">
                            {report.matchingStats.bestScore ?? 0}
                          </p>
                          <p className="text-xs text-muted-foreground">最高スコア</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* Tab 2: Preview */}
          <TabsContent value="preview" className="space-y-4">
            {!report?.reportHtml ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>レポートを生成するとHTMLプレビューが表示されます</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex justify-end">
                  <Button variant="outline" onClick={handleDownloadHtml}>
                    <Download className="h-4 w-4 mr-2" />
                    HTMLダウンロード
                  </Button>
                </div>
                <Card>
                  <CardContent className="p-0">
                    <iframe
                      srcDoc={report.reportHtml}
                      className="w-full min-h-[600px] rounded-lg border-0"
                      title="レポートプレビュー"
                      sandbox="allow-same-origin"
                    />
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
