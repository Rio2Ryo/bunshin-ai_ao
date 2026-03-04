import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { ClipboardList, Target, DollarSign, TrendingUp, Plus, CheckCircle, Clock, Loader2, Trash2, Edit, Calendar } from "lucide-react";

const PIE_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#6366f1"];

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  high: { label: "高", color: "text-red-700 dark:text-red-400", bgColor: "bg-red-100 dark:bg-red-900/30" },
  medium: { label: "中", color: "text-yellow-700 dark:text-yellow-400", bgColor: "bg-yellow-100 dark:bg-yellow-900/30" },
  low: { label: "低", color: "text-green-700 dark:text-green-400", bgColor: "bg-green-100 dark:bg-green-900/30" },
};

const STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle }> = {
  pending: { label: "未着手", icon: Clock },
  in_progress: { label: "進行中", icon: Edit },
  done: { label: "完了", icon: CheckCircle },
};

const OUTCOME_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  meeting: { label: "ミーティング", color: "#3b82f6" },
  deal: { label: "商談", color: "#8b5cf6" },
  partnership: { label: "パートナーシップ", color: "#10b981" },
  referral: { label: "紹介", color: "#f59e0b" },
  other: { label: "その他", color: "#6366f1" },
};

export default function OutcomeTracker() {
  usePageMeta({ title: "成果トラッカー", description: "マッチングからのビジネス成果を管理・計測", path: "/outcomes" });

  const [activeTab, setActiveTab] = useState("actions");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);

  // New action form
  const [newActionSessionId, setNewActionSessionId] = useState("");
  const [newActionTitle, setNewActionTitle] = useState("");
  const [newActionDescription, setNewActionDescription] = useState("");
  const [newActionPriority, setNewActionPriority] = useState("medium");
  const [newActionDueDate, setNewActionDueDate] = useState("");

  // New outcome form
  const [newOutcomeSessionId, setNewOutcomeSessionId] = useState("");
  const [newOutcomeType, setNewOutcomeType] = useState("");
  const [newOutcomeDescription, setNewOutcomeDescription] = useState("");
  const [newOutcomeValue, setNewOutcomeValue] = useState("");

  // Queries
  const { data: sessionsData } = trpc.matching.sessions.useQuery();
  const { data: actionItemsData, isLoading: actionsLoading, refetch: refetchActions } = trpc.matching.listActionItems.useQuery(
    { status: statusFilter === "all" ? undefined : statusFilter as "pending" | "in_progress" | "done" | "cancelled" }
  );
  const { data: summaryData, isLoading: summaryLoading } = trpc.matching.getOutcomeSummary.useQuery(
    undefined,
    { enabled: activeTab === "roi" }
  );

  // Mutations
  const createActionMut = trpc.matching.createActionItem.useMutation();
  const updateActionMut = trpc.matching.updateActionItem.useMutation();
  const recordOutcomeMut = trpc.matching.recordOutcome.useMutation();

  const sessions = (sessionsData as any) ?? [];
  const completedSessions = sessions.filter((s: any) => s.status === "completed");
  const actionItems = (actionItemsData as any)?.items ?? actionItemsData ?? [];
  const summary = (summaryData as any) ?? null;

  const outcomes = summary?.outcomes ?? [];
  const monthlyData = summary?.monthlyData ?? [];
  const outcomesByType = summary?.outcomesByType ?? [];

  const handleCreateAction = async () => {
    if (!newActionTitle.trim()) {
      toast.error("タイトルを入力してください");
      return;
    }
    try {
      await createActionMut.mutateAsync({
        sessionId: newActionSessionId ? parseInt(newActionSessionId) : 0,
        title: newActionTitle,
        description: newActionDescription || undefined,
        priority: newActionPriority as "high" | "medium" | "low",
        dueDate: newActionDueDate || undefined,
      });
      toast.success("アクションアイテムを作成しました");
      setNewActionTitle("");
      setNewActionDescription("");
      setNewActionPriority("medium");
      setNewActionDueDate("");
      setNewActionSessionId("");
      setActionDialogOpen(false);
      refetchActions();
    } catch (e: any) {
      toast.error(e.message || "作成に失敗しました");
    }
  };

  const handleUpdateStatus = async (itemId: number, newStatus: string) => {
    try {
      await updateActionMut.mutateAsync({ itemId, status: newStatus as "pending" | "in_progress" | "done" | "cancelled" });
      toast.success("ステータスを更新しました");
      refetchActions();
    } catch (e: any) {
      toast.error(e.message || "更新に失敗しました");
    }
  };

  const handleRecordOutcome = async () => {
    if (!newOutcomeType || !newOutcomeDescription.trim()) {
      toast.error("種類と説明を入力してください");
      return;
    }
    try {
      await recordOutcomeMut.mutateAsync({
        sessionId: newOutcomeSessionId ? parseInt(newOutcomeSessionId) : 0,
        outcomeType: newOutcomeType as "meeting" | "deal" | "partnership" | "referral" | "other",
        description: newOutcomeDescription,
        monetaryValue: newOutcomeValue ? parseFloat(newOutcomeValue) : undefined,
      });
      toast.success("成果を記録しました");
      setNewOutcomeType("");
      setNewOutcomeDescription("");
      setNewOutcomeValue("");
      setNewOutcomeSessionId("");
      setOutcomeDialogOpen(false);
    } catch (e: any) {
      toast.error(e.message || "記録に失敗しました");
    }
  };

  const getNextStatus = (current: string): string => {
    if (current === "pending") return "in_progress";
    if (current === "in_progress") return "done";
    return "pending";
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-green-500" />
            マッチング成果トラッカー
          </h1>
          <p className="text-muted-foreground mt-1">
            マッチングから生まれたビジネス成果を管理・計測します
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="actions">
              <Target className="h-4 w-4 mr-1" />
              アクションアイテム
            </TabsTrigger>
            <TabsTrigger value="outcomes">
              <CheckCircle className="h-4 w-4 mr-1" />
              成果記録
            </TabsTrigger>
            <TabsTrigger value="roi">
              <TrendingUp className="h-4 w-4 mr-1" />
              ROI分析
            </TabsTrigger>
          </TabsList>

          {/* Actions Tab */}
          <TabsContent value="actions" className="space-y-4">
            <div className="flex items-center justify-between">
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); }}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="ステータスで絞込" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">すべて</SelectItem>
                  <SelectItem value="pending">未着手</SelectItem>
                  <SelectItem value="in_progress">進行中</SelectItem>
                  <SelectItem value="done">完了</SelectItem>
                </SelectContent>
              </Select>

              <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    新規アクション
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>新規アクションアイテム</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">関連セッション（任意）</label>
                      <Select value={newActionSessionId} onValueChange={setNewActionSessionId}>
                        <SelectTrigger>
                          <SelectValue placeholder="セッションを選択" />
                        </SelectTrigger>
                        <SelectContent>
                          {completedSessions.map((s: any) => (
                            <SelectItem key={s.id} value={String(s.id)}>
                              {s.theme || `セッション #${s.id}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">タイトル</label>
                      <Input
                        placeholder="アクションの内容"
                        value={newActionTitle}
                        onChange={(e) => setNewActionTitle(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">説明（任意）</label>
                      <Textarea
                        placeholder="詳細な説明"
                        value={newActionDescription}
                        onChange={(e) => setNewActionDescription(e.target.value)}
                        rows={3}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">優先度</label>
                        <Select value={newActionPriority} onValueChange={setNewActionPriority}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="high">高</SelectItem>
                            <SelectItem value="medium">中</SelectItem>
                            <SelectItem value="low">低</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">期限（任意）</label>
                        <Input
                          type="date"
                          value={newActionDueDate}
                          onChange={(e) => setNewActionDueDate(e.target.value)}
                        />
                      </div>
                    </div>
                    <Button onClick={handleCreateAction} disabled={createActionMut.isPending} className="w-full">
                      {createActionMut.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />作成中...</>
                      ) : "作成"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {actionsLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {!actionsLoading && actionItems.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center">
                  <Target className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">アクションアイテムがありません</p>
                </CardContent>
              </Card>
            )}

            <div className="space-y-2">
              {actionItems.map((item: any) => {
                const priority = PRIORITY_CONFIG[item.priority] ?? PRIORITY_CONFIG.medium;
                const statusCfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
                const StatusIcon = statusCfg.icon;
                const nextStatus = getNextStatus(item.status);
                return (
                  <Card key={item.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className={`font-medium text-sm ${item.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                              {item.title}
                            </h3>
                            <Badge variant="outline" className={`text-xs ${priority.color} ${priority.bgColor}`}>
                              {priority.label}
                            </Badge>
                          </div>
                          {item.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2 mb-1">{item.description}</p>
                          )}
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <StatusIcon className="h-3 w-3" />
                              {statusCfg.label}
                            </span>
                            {item.dueDate && (
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {new Date(item.dueDate).toLocaleDateString("ja-JP")}
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={item.status === "done" ? "outline" : "default"}
                          onClick={() => handleUpdateStatus(item.id, nextStatus)}
                          disabled={updateActionMut.isPending}
                        >
                          {nextStatus === "in_progress" ? "着手" : nextStatus === "done" ? "完了" : "戻す"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* Outcomes Tab */}
          <TabsContent value="outcomes" className="space-y-4">
            <div className="flex justify-end">
              <Dialog open={outcomeDialogOpen} onOpenChange={setOutcomeDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    成果を記録
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>成果を記録</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">関連セッション（任意）</label>
                      <Select value={newOutcomeSessionId} onValueChange={setNewOutcomeSessionId}>
                        <SelectTrigger>
                          <SelectValue placeholder="セッションを選択" />
                        </SelectTrigger>
                        <SelectContent>
                          {completedSessions.map((s: any) => (
                            <SelectItem key={s.id} value={String(s.id)}>
                              {s.theme || `セッション #${s.id}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">成果の種類</label>
                      <Select value={newOutcomeType} onValueChange={setNewOutcomeType}>
                        <SelectTrigger>
                          <SelectValue placeholder="種類を選択" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="meeting">ミーティング</SelectItem>
                          <SelectItem value="deal">商談</SelectItem>
                          <SelectItem value="partnership">パートナーシップ</SelectItem>
                          <SelectItem value="referral">紹介</SelectItem>
                          <SelectItem value="other">その他</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">説明</label>
                      <Textarea
                        placeholder="成果の詳細"
                        value={newOutcomeDescription}
                        onChange={(e) => setNewOutcomeDescription(e.target.value)}
                        rows={3}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">金額（任意・円）</label>
                      <Input
                        type="number"
                        placeholder="0"
                        value={newOutcomeValue}
                        onChange={(e) => setNewOutcomeValue(e.target.value)}
                      />
                    </div>
                    <Button onClick={handleRecordOutcome} disabled={recordOutcomeMut.isPending} className="w-full">
                      {recordOutcomeMut.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />記録中...</>
                      ) : "記録する"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {outcomes.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center">
                  <CheckCircle className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">まだ成果が記録されていません</p>
                </CardContent>
              </Card>
            )}

            <div className="space-y-2">
              {outcomes.map((outcome: any, i: number) => {
                const typeConfig = OUTCOME_TYPE_CONFIG[outcome.type] ?? OUTCOME_TYPE_CONFIG.other;
                return (
                  <Card key={outcome.id || i}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge style={{ backgroundColor: typeConfig.color + "20", color: typeConfig.color, borderColor: typeConfig.color }}>
                              {typeConfig.label}
                            </Badge>
                            {outcome.monetaryValue != null && outcome.monetaryValue > 0 && (
                              <span className="text-sm font-medium flex items-center gap-1">
                                <DollarSign className="h-3.5 w-3.5" />
                                {Number(outcome.monetaryValue).toLocaleString("ja-JP")}円
                              </span>
                            )}
                          </div>
                          <p className="text-sm">{outcome.description}</p>
                          {outcome.createdAt && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Date(outcome.createdAt).toLocaleDateString("ja-JP")}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* ROI Tab */}
          <TabsContent value="roi" className="space-y-4">
            {summaryLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {!summaryLoading && (
              <>
                {/* KPI Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4 text-center">
                      <CheckCircle className="h-8 w-8 mx-auto text-green-500 mb-2" />
                      <div className="text-2xl font-bold">{summary?.totalOutcomes ?? 0}</div>
                      <div className="text-xs text-muted-foreground">成果件数</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <DollarSign className="h-8 w-8 mx-auto text-blue-500 mb-2" />
                      <div className="text-2xl font-bold">
                        {summary?.totalValue != null ? `¥${Number(summary.totalValue).toLocaleString("ja-JP")}` : "¥0"}
                      </div>
                      <div className="text-xs text-muted-foreground">総成果金額</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <Target className="h-8 w-8 mx-auto text-purple-500 mb-2" />
                      <div className="text-2xl font-bold">
                        {summary?.outcomeRate != null ? `${summary.outcomeRate}%` : "0%"}
                      </div>
                      <div className="text-xs text-muted-foreground">成果率</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <TrendingUp className="h-8 w-8 mx-auto text-orange-500 mb-2" />
                      <div className="text-2xl font-bold">
                        {summary?.matchingROI != null ? `${summary.matchingROI}x` : "0x"}
                      </div>
                      <div className="text-xs text-muted-foreground">マッチングROI</div>
                    </CardContent>
                  </Card>
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Pie Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">成果の種類別内訳</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {outcomesByType.length > 0 ? (
                        <ResponsiveContainer width="100%" height={250}>
                          <PieChart>
                            <Pie
                              data={outcomesByType}
                              dataKey="count"
                              nameKey="type"
                              cx="50%"
                              cy="50%"
                              outerRadius={80}
                              label={({ type, count }: any) => `${OUTCOME_TYPE_CONFIG[type]?.label ?? type}: ${count}`}
                            >
                              {outcomesByType.map((_: any, index: number) => (
                                <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
                          データがありません
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Bar Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">月別成果金額</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {monthlyData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={250}>
                          <BarChart data={monthlyData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `¥${(v / 1000).toFixed(0)}k`} />
                            <Tooltip formatter={(value: number) => [`¥${value.toLocaleString("ja-JP")}`, "金額"]} />
                            <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
                          データがありません
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
