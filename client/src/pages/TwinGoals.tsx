import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Goal, Loader2, Plus, Trash2, ArrowUp, CheckCircle2, Sparkles, Target, Trophy, BarChart3 } from "lucide-react";

type GoalType = "skill" | "score" | "matching_count" | "knowledge" | "feedback" | "custom";

const goalTypeLabels: Record<string, string> = {
  skill: "スキル",
  score: "スコア",
  matching_count: "マッチング回数",
  knowledge: "知識",
  feedback: "フィードバック",
  custom: "カスタム",
};

const goalTypeColors: Record<string, string> = {
  skill: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  score: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  matching_count: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  knowledge: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  feedback: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  custom: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

export default function TwinGoals() {
  usePageMeta({ title: "ツイン目標", description: "成長目標の設定と進捗", path: "/goals" });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [goalType, setGoalType] = useState<GoalType>("skill");
  const [title, setTitle] = useState("");
  const [targetValue, setTargetValue] = useState<number>(10);
  const [unit, setUnit] = useState("");
  const [deadline, setDeadline] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);

  const { data: goalsRaw, refetch: refetchGoals } = trpc.myTwin.listGoals.useQuery();
  const goals = (goalsRaw as any[]) || [];
  const activeGoals = goals.filter((g: any) => !g.completed && g.status !== "completed");
  const completedGoals = goals.filter((g: any) => g.completed || g.status === "completed");

  const completionRate = goals.length > 0 ? Math.round((completedGoals.length / goals.length) * 100) : 0;

  const createMut = trpc.myTwin.createGoal.useMutation({
    onSuccess: () => {
      toast.success("目標を作成しました");
      setDialogOpen(false);
      setTitle("");
      setTargetValue(10);
      setUnit("");
      setDeadline("");
      refetchGoals();
    },
    onError: (err: any) => toast.error(err.message || "目標の作成に失敗しました"),
  });

  const updateProgressMut = trpc.myTwin.updateGoalProgress.useMutation({
    onSuccess: (data: any) => {
      if (data?.completed) {
        toast.success("目標を達成しました! " + (data.pointsAwarded ? `+${data.pointsAwarded}ポイント` : ""));
      } else {
        toast.success("進捗を更新しました");
      }
      refetchGoals();
    },
    onError: (err: any) => toast.error(err.message || "更新に失敗しました"),
  });

  const deleteMut = trpc.myTwin.deleteGoal.useMutation({
    onSuccess: () => {
      toast.success("目標を削除しました");
      refetchGoals();
    },
    onError: (err: any) => toast.error(err.message || "削除に失敗しました"),
  });

  const suggestionsMut = trpc.myTwin.getGoalSuggestions.useMutation({
    onError: (err: any) => toast.error(err.message || "提案の取得に失敗しました"),
  });

  const suggestionsData = suggestionsMut.data as { suggestions: any[] } | undefined;
  const suggestions = suggestionsData?.suggestions || [];

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <Goal className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold">ツイン目標</h1>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="py-4 text-center">
              <Target className="h-5 w-5 mx-auto mb-1 text-blue-500" />
              <div className="text-2xl font-bold">{goals.length}</div>
              <div className="text-xs text-muted-foreground">合計目標</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <Trophy className="h-5 w-5 mx-auto mb-1 text-green-500" />
              <div className="text-2xl font-bold">{completedGoals.length}</div>
              <div className="text-xs text-muted-foreground">達成数</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <BarChart3 className="h-5 w-5 mx-auto mb-1 text-purple-500" />
              <div className="text-2xl font-bold">{completionRate}%</div>
              <div className="text-xs text-muted-foreground">達成率</div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="manage">
          <TabsList>
            <TabsTrigger value="manage">目標管理</TabsTrigger>
            <TabsTrigger value="suggestions">AI提案</TabsTrigger>
          </TabsList>

          {/* 目標管理タブ */}
          <TabsContent value="manage" className="space-y-4 mt-4">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  目標を追加
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>新しい目標を追加</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>目標タイプ</Label>
                    <Select value={goalType} onValueChange={(v) => setGoalType(v as GoalType)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(goalTypeLabels).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>タイトル</Label>
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: マッチングスコア平均80点" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>目標値</Label>
                      <Input type="number" value={targetValue} onChange={(e) => setTargetValue(Number(e.target.value))} />
                    </div>
                    <div>
                      <Label>単位</Label>
                      <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="例: 点, 回, 件" />
                    </div>
                  </div>
                  <div>
                    <Label>期限</Label>
                    <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => createMut.mutate({ goalType, title, targetValue, unit, deadline: deadline || undefined })}
                    disabled={!title || createMut.isPending}
                  >
                    {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    作成
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Active goals */}
            {activeGoals.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Target className="h-12 w-12 mx-auto mb-3 opacity-40" />
                  <p>アクティブな目標がありません。</p>
                  <p className="text-sm mt-1">「目標を追加」で新しい目標を設定しましょう。</p>
                </CardContent>
              </Card>
            )}

            <div className="space-y-3">
              {activeGoals.map((goal: any) => {
                const current = goal.currentValue || 0;
                const target = goal.targetValue || 1;
                const pct = Math.min(100, Math.round((current / target) * 100));
                return (
                  <Card key={goal.id}>
                    <CardContent className="py-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold">{goal.title}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge className={goalTypeColors[goal.goalType] || goalTypeColors.custom}>
                              {goalTypeLabels[goal.goalType] || goal.goalType}
                            </Badge>
                            {goal.deadline && (
                              <span className="text-xs text-muted-foreground">期限: {goal.deadline.substring(0, 10)}</span>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => deleteMut.mutate({ goalId: goal.id })}
                          disabled={deleteMut.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span>{current} / {target} {goal.unit || ""}</span>
                          <span className="font-medium">{pct}%</span>
                        </div>
                        <Progress value={pct} />
                      </div>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          updateProgressMut.mutate({ goalId: goal.id });
                        }}
                        disabled={updateProgressMut.isPending}
                      >
                        {updateProgressMut.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <ArrowUp className="h-4 w-4 mr-1" />
                            進捗更新
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Completed goals */}
            {completedGoals.length > 0 && (
              <div>
                <Button variant="ghost" size="sm" onClick={() => setShowCompleted(!showCompleted)}>
                  <CheckCircle2 className="h-4 w-4 mr-1 text-green-500" />
                  達成済み ({completedGoals.length})
                </Button>
                {showCompleted && (
                  <div className="space-y-2 mt-2">
                    {completedGoals.map((goal: any) => (
                      <Card key={goal.id} className="border-green-200 dark:border-green-800 opacity-75">
                        <CardContent className="py-3 flex items-center gap-3">
                          <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                          <div className="flex-1">
                            <span className="font-medium">{goal.title}</span>
                            <Badge className={`ml-2 ${goalTypeColors[goal.goalType] || goalTypeColors.custom}`}>
                              {goalTypeLabels[goal.goalType] || goal.goalType}
                            </Badge>
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {goal.targetValue} {goal.unit || ""}
                          </span>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* AI提案タブ */}
          <TabsContent value="suggestions" className="space-y-4 mt-4">
            <Button
              onClick={() => suggestionsMut.mutate()}
              disabled={suggestionsMut.isPending}
            >
              {suggestionsMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  分析中...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  AI目標提案を取得
                </>
              )}
            </Button>

            {suggestions.length === 0 && !suggestionsMut.isPending && (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-40" />
                  <p>AIからの提案を取得するには上のボタンをクリックしてください。</p>
                </CardContent>
              </Card>
            )}

            <div className="space-y-3">
              {suggestions.map((sug: any, idx: number) => (
                <Card key={idx}>
                  <CardContent className="py-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold">{sug.title}</h3>
                        <Badge className={goalTypeColors[sug.goalType] || goalTypeColors.custom}>
                          {goalTypeLabels[sug.goalType] || sug.goalType}
                        </Badge>
                      </div>
                      <span className="text-sm font-medium">
                        目標: {sug.targetValue} {sug.unit || ""}
                      </span>
                    </div>
                    {sug.reason && (
                      <p className="text-sm text-muted-foreground">{sug.reason}</p>
                    )}
                    <Button
                      size="sm"
                      onClick={() => {
                        const gt = (sug.goalType || "custom") as GoalType;
                        createMut.mutate({
                          goalType: gt,
                          title: sug.title,
                          targetValue: sug.targetValue || 10,
                          unit: sug.unit || "",
                          deadline: sug.deadline || undefined,
                        });
                      }}
                      disabled={createMut.isPending}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      この目標を採用
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
