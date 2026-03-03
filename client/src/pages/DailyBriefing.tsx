import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Loader2, Sun, ArrowLeft, Target, Users, CheckCircle, Sparkles, X, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-500/10 text-red-600 border-red-500/30",
  medium: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
  low: "bg-green-500/10 text-green-600 border-green-500/30",
};

const TYPE_ICONS: Record<string, any> = {
  matching: Users,
  followup: ArrowRight,
  goal: Target,
  social: Users,
};

export default function DailyBriefing() {
  usePageMeta({ title: "デイリーブリーフィング", description: "AIが毎日の推奨アクションをパーソナライズ提案", path: "/daily-briefing" });

  const { data: briefing, isLoading, refetch } = trpc.matching.getBriefing.useQuery();
  const generateMut = trpc.matching.generateBriefing.useMutation();
  const dismissMut = trpc.matching.dismissBriefing.useMutation();

  const handleGenerate = async () => {
    try {
      await generateMut.mutateAsync();
      toast.success("ブリーフィングを生成しました");
      refetch();
    } catch (e: any) {
      toast.error(e.message || "生成に失敗しました");
    }
  };

  const handleDismiss = async () => {
    if (!briefing?.id) return;
    try {
      await dismissMut.mutateAsync({ id: briefing.id });
      toast.success("ブリーフィングを閉じました");
      refetch();
    } catch (e: any) {
      toast.error(e.message || "操作に失敗しました");
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Sun className="h-6 w-6 text-yellow-500" />
              デイリーブリーフィング
            </h1>
            <p className="text-muted-foreground">AIが今日の推奨アクションを提案</p>
          </div>
          <Button onClick={handleGenerate} disabled={generateMut.isPending}>
            {generateMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {briefing ? "再生成" : "生成"}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !briefing ? (
          <Card>
            <CardContent className="text-center py-12">
              <Sun className="h-12 w-12 mx-auto mb-4 text-yellow-500 opacity-50" />
              <p className="text-muted-foreground">今日のブリーフィングはまだ生成されていません</p>
              <Button onClick={handleGenerate} disabled={generateMut.isPending} className="mt-4">
                {generateMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                AIブリーフィングを生成
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Greeting & Summary */}
            <Card className="border-yellow-500/30 bg-yellow-500/5">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Sun className="h-5 w-5 text-yellow-500" />
                      {briefing.briefingDate}
                    </CardTitle>
                  </div>
                  <Button variant="ghost" size="icon" onClick={handleDismiss} className="text-muted-foreground">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{briefing.content}</p>
              </CardContent>
            </Card>

            {/* Recommendations */}
            {briefing.recommendations?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5 text-primary" />
                    今日の推奨アクション
                  </CardTitle>
                  <CardDescription>{briefing.recommendations.length}件のアクション提案</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {briefing.recommendations.map((rec: any, i: number) => {
                      const Icon = TYPE_ICONS[rec.type] || CheckCircle;
                      return (
                        <div key={i} className="flex items-start gap-3 rounded-lg border p-3">
                          <Icon className="h-5 w-5 text-primary mt-0.5" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm">{rec.title}</span>
                              <Badge className={`text-xs ${PRIORITY_COLORS[rec.priority] || ""}`}>
                                {rec.priority === "high" ? "高" : rec.priority === "medium" ? "中" : "低"}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{rec.description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Follow-ups */}
            {briefing.followUps?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-blue-500" />
                    フォローアップ
                  </CardTitle>
                  <CardDescription>連絡すべき友達</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {briefing.followUps.map((fu: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 rounded-lg border p-3">
                        <Users className="h-5 w-5 text-blue-500 mt-0.5" />
                        <div className="flex-1">
                          <p className="font-medium text-sm">{fu.friendName || "友達"}</p>
                          <p className="text-xs text-muted-foreground">{fu.reason}</p>
                          <p className="text-xs text-primary mt-1">{fu.suggestedAction}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
