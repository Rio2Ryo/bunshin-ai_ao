import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { GraduationCap, BookOpen, CheckCircle2, Lock, Play, Trash2, Loader2, Target, Brain } from "lucide-react";

const t = trpc as any;

export default function LearningCurriculum() {
  const [selectedCurriculumId, setSelectedCurriculumId] = useState<number | null>(null);
  const curricula = t.myTwin.listCurricula.useQuery();
  const curriculumDetail = t.myTwin.getCurriculum.useQuery(
    { curriculumId: selectedCurriculumId! },
    { enabled: !!selectedCurriculumId }
  );
  const generateMutation = t.myTwin.generateCurriculum.useMutation();
  const completeLessonMutation = t.myTwin.completeLesson.useMutation();
  const deleteMutation = t.myTwin.deleteCurriculum.useMutation();

  const handleGenerate = async () => {
    try {
      const result = await generateMutation.mutateAsync({});
      toast.success("カリキュラムを生成しました");
      if (result.id) setSelectedCurriculumId(Number(result.id));
      curricula.refetch();
    } catch (e: any) { toast.error(e.message || "生成に失敗しました"); }
  };

  const handleCompleteLesson = async (curriculumId: number, lessonIndex: number) => {
    try {
      const result = await completeLessonMutation.mutateAsync({ curriculumId, lessonIndex, score: 80 });
      toast.success(result.allComplete ? "全レッスン完了！おめでとうございます！" : "レッスン完了！次のレッスンが解放されました");
      curriculumDetail.refetch();
      curricula.refetch();
    } catch (e: any) { toast.error(e.message || "完了処理に失敗しました"); }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ curriculumId: id });
      toast.success("カリキュラムを削除しました");
      if (selectedCurriculumId === id) setSelectedCurriculumId(null);
      curricula.refetch();
    } catch (e: any) { toast.error(e.message || "削除に失敗しました"); }
  };

  const activeCurriculum = (curricula.data || []).find((c: any) => c.status === "active");
  const detail = curriculumDetail.data;
  const completedCount = detail?.progress?.filter((p: any) => p.status === "completed").length || 0;
  const totalLessons = detail?.lessons?.length || 0;
  const progressPercent = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <GraduationCap className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">学習カリキュラム</h1>
            <p className="text-sm text-muted-foreground">ツインの弱点を診断し、段階的な学習プランを自動生成</p>
          </div>
        </div>

        <Tabs defaultValue="generate">
          <TabsList>
            <TabsTrigger value="generate">カリキュラム生成</TabsTrigger>
            <TabsTrigger value="progress">進捗管理</TabsTrigger>
            <TabsTrigger value="history">履歴</TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Brain className="h-5 w-5" />AI弱点診断 & カリキュラム生成</CardTitle>
                <CardDescription>マッチングスコア、フィードバック、ナレッジベースを統合的に分析し、最適な学習プランを提案します</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={handleGenerate} disabled={generateMutation.isPending}>
                  {generateMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />分析中...</> : <><Target className="h-4 w-4 mr-2" />カリキュラムを生成</>}
                </Button>
              </CardContent>
            </Card>

            {activeCurriculum && (
              <Card>
                <CardHeader>
                  <CardTitle>{activeCurriculum.title}</CardTitle>
                  <CardDescription>{activeCurriculum.diagnosis}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(activeCurriculum.lessons || []).map((lesson: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg border">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm">{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{lesson.title}</p>
                        <p className="text-xs text-muted-foreground">{lesson.goal}</p>
                      </div>
                      <Badge variant={lesson.difficulty === "hard" ? "destructive" : lesson.difficulty === "normal" ? "default" : "secondary"}>
                        {lesson.difficulty === "hard" ? "上級" : lesson.difficulty === "normal" ? "中級" : "初級"}
                      </Badge>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setSelectedCurriculumId(activeCurriculum.id)}>
                    進捗管理へ
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="progress" className="space-y-4 mt-4">
            {!selectedCurriculumId && activeCurriculum && (
              <Button variant="outline" onClick={() => setSelectedCurriculumId(activeCurriculum.id)}>
                アクティブなカリキュラムを表示
              </Button>
            )}
            {selectedCurriculumId && curriculumDetail.isLoading && (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
            )}
            {detail && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>{detail.title}</CardTitle>
                    <CardDescription>進捗: {completedCount} / {totalLessons} レッスン完了</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Progress value={progressPercent} className="h-3" />
                    <p className="text-sm text-muted-foreground mt-1">{progressPercent}% 完了</p>
                  </CardContent>
                </Card>

                <div className="space-y-3">
                  {(detail.lessons || []).map((lesson: any, i: number) => {
                    const prog = (detail.progress || []).find((p: any) => p.lessonIndex === i);
                    const status = prog?.status || "pending";
                    return (
                      <Card key={i} className={status === "completed" ? "border-green-500/30 bg-green-500/5" : status === "in_progress" ? "border-primary/30 bg-primary/5" : "opacity-60"}>
                        <CardContent className="flex items-center gap-4 p-4">
                          <div className="flex items-center justify-center w-10 h-10 rounded-full border-2" style={{ borderColor: status === "completed" ? "#22c55e" : status === "in_progress" ? "hsl(var(--primary))" : "#888" }}>
                            {status === "completed" ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : status === "in_progress" ? <Play className="h-5 w-5 text-primary" /> : <Lock className="h-5 w-5 text-muted-foreground" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{lesson.title}</p>
                            <p className="text-sm text-muted-foreground">{lesson.exerciseTheme}</p>
                            <p className="text-xs text-muted-foreground mt-1">評価基準: {lesson.evaluationCriteria}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {prog?.score != null && <Badge variant="outline">{prog.score}点</Badge>}
                            <Badge variant={status === "completed" ? "default" : status === "in_progress" ? "secondary" : "outline"}>
                              {status === "completed" ? "完了" : status === "in_progress" ? "進行中" : "未開放"}
                            </Badge>
                            {status === "in_progress" && (
                              <Button size="sm" onClick={() => handleCompleteLesson(selectedCurriculumId!, i)} disabled={completeLessonMutation.isPending}>
                                完了
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-4 mt-4">
            {(curricula.data || []).length === 0 && (
              <p className="text-center text-muted-foreground py-8">カリキュラムがまだありません</p>
            )}
            {(curricula.data || []).map((c: any) => (
              <Card key={c.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelectedCurriculumId(c.id)}>
                <CardContent className="flex items-center gap-4 p-4">
                  <BookOpen className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{c.title}</p>
                    <p className="text-sm text-muted-foreground">{c.twinName} • {(c.lessons || []).length}レッスン</p>
                  </div>
                  <Badge variant={c.status === "completed" ? "default" : c.status === "active" ? "secondary" : "outline"}>
                    {c.status === "completed" ? "完了" : c.status === "active" ? "進行中" : "一時停止"}
                  </Badge>
                  <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
