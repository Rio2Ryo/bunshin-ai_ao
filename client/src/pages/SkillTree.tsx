import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import {
  Loader2, TreePine, Brain, BookOpen, TrendingUp, Sparkles,
  ArrowRight, CheckCircle, AlertTriangle, Zap,
} from "lucide-react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

const SKILL_LABELS: Record<string, string> = {
  skillMatch: "スキルマッチ",
  valueAlignment: "価値観一致",
  communicationStyle: "コミュニケーション",
  businessGoalFit: "目標適合",
  complementaryStrengths: "相互補完",
  personalityCompatibility: "人格互換",
};

const IMPACT_COLORS: Record<string, string> = {
  high: "text-red-500 bg-red-500/10",
  medium: "text-yellow-500 bg-yellow-500/10",
  low: "text-green-500 bg-green-500/10",
};

export default function SkillTree() {
  usePageMeta({ title: "スキルツリー", description: "ツインのスキルマップと成長パスを可視化", path: "/skill-tree" });
  const { data: tree, isLoading } = trpc.myTwin.getSkillTree.useQuery();
  const growthMut = trpc.myTwin.getGrowthPath.useMutation();
  const [growthData, setGrowthData] = useState<any>(null);

  const handleGetGrowth = async () => {
    try {
      const result = await growthMut.mutateAsync();
      setGrowthData(result);
    } catch (e: any) {
      toast.error(e.message || "成長パスの取得に失敗しました");
    }
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

  if (!tree) {
    return (
      <DashboardLayout>
        <div className="text-center py-16">
          <TreePine className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">分身AIを作成してください</p>
        </div>
      </DashboardLayout>
    );
  }

  const radarData = tree.skills.map((s: any) => ({
    skill: SKILL_LABELS[s.name] || s.name,
    score: s.avgScore,
    fullMark: 20,
  }));

  const barData = tree.skills.map((s: any) => ({
    name: SKILL_LABELS[s.name] || s.name,
    平均スコア: s.avgScore,
    マッチ数: s.matchCount,
  }));

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TreePine className="h-6 w-6 text-green-500" />
              スキルツリー
            </h1>
            <p className="text-muted-foreground">{tree.twin.name}のスキルマップと成長パス</p>
          </div>
          <Button onClick={handleGetGrowth} disabled={growthMut.isPending}>
            {growthMut.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" />分析中...</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" />AI成長パス提案</>
            )}
          </Button>
        </div>

        {/* Stats row */}
        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold text-primary">{tree.skills.length}</p>
              <p className="text-xs text-muted-foreground">スキル領域</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold">{tree.totalMatchings}</p>
              <p className="text-xs text-muted-foreground">マッチング数</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold text-blue-500">{tree.totalKnowledge}</p>
              <p className="text-xs text-muted-foreground">ナレッジ数</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold text-green-500">{tree.feedback?.up || 0}</p>
              <p className="text-xs text-muted-foreground">高評価数</p>
            </CardContent>
          </Card>
        </div>

        {/* Skill Radar + Bar */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-purple-500" />
                スキルレーダー
              </CardTitle>
              <CardDescription>マッチングスコアから算出した能力マップ</CardDescription>
            </CardHeader>
            <CardContent>
              {radarData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="skill" tick={{ fontSize: 11 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 20]} tick={{ fontSize: 10 }} />
                    <Radar name="スコア" dataKey="score" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.3} />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>マッチングデータがまだありません</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                スキル別スコア
              </CardTitle>
              <CardDescription>各領域の平均スコアとマッチング回数</CardDescription>
            </CardHeader>
            <CardContent>
              {barData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={barData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 20]} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                    <Tooltip />
                    <Bar dataKey="平均スコア" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <TrendingUp className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>スコアデータがまだありません</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Knowledge nodes */}
        {tree.knowledge.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-blue-500" />
                ナレッジマップ ({tree.knowledge.length}件)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {tree.knowledge.slice(0, 12).map((kb: any) => (
                  <div key={kb.id} className="border rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs">{kb.type}</Badge>
                      <span className="text-xs text-muted-foreground">{kb.createdAt?.slice(0, 10)}</span>
                    </div>
                    <p className="text-sm font-medium truncate">{kb.name}</p>
                    {kb.summary && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{kb.summary}</p>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tags */}
        {tree.twin.tags?.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">スキルタグ</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {tree.twin.tags.map((tag: string, i: number) => (
                  <Badge key={i} variant="secondary">{tag}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* AI Growth Path */}
        {growthData && (
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                AI成長パス提案
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Strengths & Weaknesses */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h4 className="text-sm font-medium flex items-center gap-1 mb-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />強み
                  </h4>
                  <ul className="space-y-1">
                    {growthData.strengths?.map((s: string, i: number) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-center gap-2">
                        <Zap className="h-3 w-3 text-green-500 shrink-0" />{s}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="text-sm font-medium flex items-center gap-1 mb-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />改善点
                  </h4>
                  <ul className="space-y-1">
                    {growthData.weaknesses?.map((w: string, i: number) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-center gap-2">
                        <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />{w}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Growth path steps */}
              {growthData.growthPath?.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">成長ステップ</h4>
                  {growthData.growthPath.map((step: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 bg-muted/50 rounded-lg p-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-sm font-bold text-primary">{step.step}</span>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium">{step.action}</span>
                          <Badge variant="outline" className={`text-xs ${IMPACT_COLORS[step.impact] || ""}`}>
                            {step.impact}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">領域: {step.area}</p>
                      </div>
                      {i < growthData.growthPath.length - 1 && (
                        <ArrowRight className="h-4 w-4 text-muted-foreground mt-2 shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Recommendation */}
              {growthData.recommendation && (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                  <p className="text-sm">{growthData.recommendation}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
