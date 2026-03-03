import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ListTodo, Plus, Trash2, Loader2, Calendar, CheckCircle2 } from "lucide-react";
import { useState } from "react";

const priorityColors: Record<string, string> = {
  high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

export default function ActionPlans() {
  const [selectedSession, setSelectedSession] = useState<number | null>(null);

  const sessions = trpc.matching.sessions.useQuery();
  const plans = trpc.matching.getActionPlans.useQuery();
  const generateMutation = trpc.matching.generateActionPlan.useMutation();
  const updateMutation = trpc.matching.updatePlanItem.useMutation();
  const deleteMutation = trpc.matching.deleteActionPlan.useMutation();

  const completedSessions = (sessions.data || []).filter((s: any) => s.status === "completed");

  const handleGenerate = async () => {
    if (!selectedSession) { toast.error("セッションを選択してください"); return; }
    try {
      await generateMutation.mutateAsync({ sessionId: selectedSession });
      toast.success("アクションプランを生成しました");
      plans.refetch();
    } catch (e: any) { toast.error(e.message || "生成に失敗しました"); }
  };

  const handleToggle = async (planId: number, itemId: number, done: boolean) => {
    try {
      await updateMutation.mutateAsync({ planId, itemId, done });
      plans.refetch();
    } catch (e: any) { toast.error(e.message || "更新に失敗しました"); }
  };

  const handleDelete = async (planId: number) => {
    try {
      await deleteMutation.mutateAsync({ planId });
      toast.success("プランを削除しました");
      plans.refetch();
    } catch (e: any) { toast.error(e.message || "削除に失敗しました"); }
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-4 max-w-4xl space-y-6">
        <div className="flex items-center gap-2">
          <ListTodo className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">アクションプラン</h1>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">マッチング結果からプラン生成</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select onValueChange={(v) => setSelectedSession(Number(v))}>
              <SelectTrigger><SelectValue placeholder="セッションを選択" /></SelectTrigger>
              <SelectContent>
                {completedSessions.map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>#{s.id} {s.theme}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleGenerate} disabled={generateMutation.isPending || !selectedSession} className="w-full">
              {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              AIアクションプラン生成
            </Button>
          </CardContent>
        </Card>

        {plans.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (plans.data || []).length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">アクションプランがありません</CardContent></Card>
        ) : (
          <div className="space-y-4">
            {(plans.data || []).map((plan: any) => {
              const items = plan.items || [];
              const doneCount = items.filter((i: any) => i.done).length;
              const progress = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

              return (
                <Card key={plan.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-sm">{plan.title}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">
                          {plan.theme && <>テーマ: {plan.theme} | </>}
                          {doneCount}/{items.length} 完了 ({progress}%)
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {progress === 100 && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(plan.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5 mt-2">
                      <div className="bg-primary rounded-full h-1.5 transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {items.map((item: any) => (
                      <div key={item.id} className={`flex items-start gap-3 p-2 rounded-lg ${item.done ? 'opacity-60' : ''}`}>
                        <Checkbox
                          checked={item.done}
                          onCheckedChange={(checked) => handleToggle(plan.id, item.id, !!checked)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${item.done ? 'line-through' : ''}`}>{item.text}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-xs px-1.5 py-0.5 rounded ${priorityColors[item.priority] || priorityColors.medium}`}>
                              {item.priority === 'high' ? '高' : item.priority === 'low' ? '低' : '中'}
                            </span>
                            {item.dueDate && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Calendar className="h-3 w-3" />{item.dueDate}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
