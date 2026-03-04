import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Settings, Zap, Play, Trash2, ClipboardList, Plus, Pencil, CheckCircle, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";

const CONDITION_TYPES = [
  { value: "industry", label: "業種" },
  { value: "theme_keyword", label: "テーマキーワード" },
  { value: "friend_attribute", label: "友達属性" },
  { value: "score_range", label: "スコア範囲" },
  { value: "time_of_day", label: "時間帯" },
] as const;

const ACTION_TYPES = [
  { value: "persona", label: "ペルソナ切替" },
  { value: "knowledge_set", label: "ナレッジセット" },
  { value: "style", label: "会話スタイル" },
  { value: "system_prompt_append", label: "プロンプト追記" },
] as const;

interface RuleFormState {
  name: string;
  conditionType: string;
  conditionValue: string;
  actionType: string;
  actionValue: string;
  priority: number;
}

const emptyForm: RuleFormState = {
  name: "",
  conditionType: "",
  conditionValue: "",
  actionType: "",
  actionValue: "",
  priority: 0,
};

export default function ContextSwitcher() {
  usePageMeta({ title: "コンテキスト切替", description: "ツインのコンテキスト自動切替ルール", path: "/context-switcher" });

  const [form, setForm] = useState<RuleFormState>({ ...emptyForm });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [testTheme, setTestTheme] = useState("");
  const [testFriendId, setTestFriendId] = useState<string>("");

  // Queries
  const { data: rules, isLoading: rulesLoading, refetch: refetchRules } = trpc.myTwin.listContextRules.useQuery();
  const { data: logs, isLoading: logsLoading } = trpc.myTwin.getContextSwitchLogs.useQuery();
  const { data: friends } = trpc.friends.list.useQuery();

  // Mutations
  const createMut = trpc.myTwin.createContextRule.useMutation({
    onSuccess: () => {
      toast.success("ルールを作成しました");
      setForm({ ...emptyForm });
      refetchRules();
    },
    onError: (e: any) => toast.error(e.message || "作成に失敗しました"),
  });

  const updateMut = trpc.myTwin.updateContextRule.useMutation({
    onSuccess: () => {
      toast.success("ルールを更新しました");
      setEditingId(null);
      setForm({ ...emptyForm });
      refetchRules();
    },
    onError: (e: any) => toast.error(e.message || "更新に失敗しました"),
  });

  const deleteMut = trpc.myTwin.deleteContextRule.useMutation({
    onSuccess: () => {
      toast.success("ルールを削除しました");
      refetchRules();
    },
    onError: (e: any) => toast.error(e.message || "削除に失敗しました"),
  });

  const evaluateMut = trpc.myTwin.evaluateContextRules.useMutation({
    onError: (e: any) => toast.error(e.message || "評価に失敗しました"),
  });

  const handleSubmit = () => {
    if (!form.name || !form.conditionType || !form.conditionValue || !form.actionType || !form.actionValue) {
      toast.error("すべてのフィールドを入力してください");
      return;
    }
    if (editingId) {
      updateMut.mutate({
        ruleId: editingId,
        name: form.name,
        conditionType: form.conditionType,
        conditionValue: form.conditionValue,
        actionType: form.actionType,
        actionValue: form.actionValue,
        priority: form.priority,
      });
    } else {
      createMut.mutate({
        name: form.name,
        conditionType: form.conditionType,
        conditionValue: form.conditionValue,
        actionType: form.actionType,
        actionValue: form.actionValue,
        priority: form.priority,
      });
    }
  };

  const startEdit = (rule: any) => {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      conditionType: rule.conditionType,
      conditionValue: rule.conditionValue,
      actionType: rule.actionType,
      actionValue: rule.actionValue,
      priority: rule.priority || 0,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
  };

  const toggleActive = (rule: any) => {
    updateMut.mutate({
      ruleId: rule.id,
      active: rule.active ? 0 : 1,
    });
  };

  const conditionLabel = (type: string) => CONDITION_TYPES.find((c) => c.value === type)?.label || type;
  const actionLabel = (type: string) => ACTION_TYPES.find((a) => a.value === type)?.label || type;

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="h-6 w-6" /> コンテキスト切替
          </h1>
          <p className="text-muted-foreground text-sm mt-1">条件に基づいてツインの振る舞いを自動切替するルールを管理</p>
        </div>

        <Tabs defaultValue="rules">
          <TabsList>
            <TabsTrigger value="rules">ルール管理</TabsTrigger>
            <TabsTrigger value="test">テスト実行</TabsTrigger>
            <TabsTrigger value="logs">適用ログ</TabsTrigger>
          </TabsList>

          {/* Tab 1: Rule Management */}
          <TabsContent value="rules" className="space-y-4">
            {/* Create / Edit Form */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Plus className="h-5 w-5" />
                  {editingId ? "ルール編集" : "新規ルール作成"}
                </CardTitle>
                <CardDescription>条件と実行アクションを設定してルールを作成</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>ルール名</Label>
                    <Input
                      placeholder="例: IT業界向けペルソナ"
                      value={form.name}
                      onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>優先度</Label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={form.priority}
                      onChange={(e) => setForm((p) => ({ ...p, priority: Number(e.target.value) }))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>条件タイプ</Label>
                    <Select value={form.conditionType} onValueChange={(v) => setForm((p) => ({ ...p, conditionType: v }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="条件タイプを選択..." />
                      </SelectTrigger>
                      <SelectContent>
                        {CONDITION_TYPES.map((ct) => (
                          <SelectItem key={ct.value} value={ct.value}>{ct.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>条件値</Label>
                    <Input
                      placeholder="例: IT, テクノロジー"
                      value={form.conditionValue}
                      onChange={(e) => setForm((p) => ({ ...p, conditionValue: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>アクションタイプ</Label>
                    <Select value={form.actionType} onValueChange={(v) => setForm((p) => ({ ...p, actionType: v }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="アクションを選択..." />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTION_TYPES.map((at) => (
                          <SelectItem key={at.value} value={at.value}>{at.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>アクション値</Label>
                    <Input
                      placeholder="例: フォーマルな口調で対応"
                      value={form.actionValue}
                      onChange={(e) => setForm((p) => ({ ...p, actionValue: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handleSubmit}
                    disabled={createMut.isPending || updateMut.isPending}
                  >
                    {(createMut.isPending || updateMut.isPending) ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : editingId ? (
                      <CheckCircle className="h-4 w-4 mr-2" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    {editingId ? "更新" : "作成"}
                  </Button>
                  {editingId && (
                    <Button variant="outline" onClick={cancelEdit}>
                      <X className="h-4 w-4 mr-2" /> キャンセル
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Rules List */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">ルール一覧</CardTitle>
              </CardHeader>
              <CardContent>
                {rulesLoading && (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!rulesLoading && (!rules || rules.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">ルールがまだありません</p>
                )}
                {rules && rules.length > 0 && (
                  <div className="space-y-3">
                    {rules.map((rule: any) => (
                      <div key={rule.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                        <Switch
                          checked={!!rule.active}
                          onCheckedChange={() => toggleActive(rule)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{rule.name}</span>
                            <Badge variant="outline" className="text-xs">{conditionLabel(rule.conditionType)}: {rule.conditionValue}</Badge>
                            <Badge variant="secondary" className="text-xs">{actionLabel(rule.actionType)}</Badge>
                            {rule.applyCount != null && (
                              <Badge variant="outline" className="text-xs">
                                <Zap className="h-3 w-3 mr-1" />{rule.applyCount}回適用
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 truncate">
                            アクション: {rule.actionValue} | 優先度: {rule.priority || 0}
                          </p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button size="icon" variant="ghost" onClick={() => startEdit(rule)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => deleteMut.mutate({ ruleId: rule.id })}
                            disabled={deleteMut.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 2: Test Execution */}
          <TabsContent value="test" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Play className="h-5 w-5" /> ルール評価テスト
                </CardTitle>
                <CardDescription>テーマや友達を指定して、どのルールがマッチするかシミュレーション</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>テーマ</Label>
                    <Input
                      placeholder="例: AI技術の活用"
                      value={testTheme}
                      onChange={(e) => setTestTheme(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>友達 (任意)</Label>
                    <Select value={testFriendId} onValueChange={setTestFriendId}>
                      <SelectTrigger>
                        <SelectValue placeholder="友達を選択 (任意)..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">指定なし</SelectItem>
                        {(friends ?? []).map((f: any) => (
                          <SelectItem key={f.friendId || f.id} value={String(f.friendId || f.id)}>
                            {f.friendName || f.displayName || `ユーザー#${f.friendId || f.id}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button
                  onClick={() => evaluateMut.mutate({
                    theme: testTheme,
                    friendId: testFriendId && testFriendId !== "_none" ? Number(testFriendId) : undefined,
                  })}
                  disabled={!testTheme || evaluateMut.isPending}
                >
                  {evaluateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
                  ルール評価
                </Button>

                {evaluateMut.data && (
                  <div className="space-y-3 pt-4 border-t">
                    <p className="text-sm font-medium">評価結果: {evaluateMut.data.matchedRules?.length || 0}件マッチ</p>
                    {evaluateMut.data.matchedRules?.length === 0 && (
                      <p className="text-sm text-muted-foreground">マッチするルールはありませんでした</p>
                    )}
                    {evaluateMut.data.matchedRules?.map((match: any, i: number) => (
                      <Card key={i} className="border-l-4 border-l-green-500 bg-green-50/50 dark:bg-green-900/10">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <CheckCircle className="h-4 w-4 text-green-500" />
                            <span className="font-medium text-sm">{match.ruleName || match.name}</span>
                            <Badge variant="outline" className="text-xs">
                              {conditionLabel(match.conditionType)}: {match.conditionValue}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            適用アクション: {actionLabel(match.actionType)} → {match.actionValue}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                    {evaluateMut.data.appliedActions && evaluateMut.data.appliedActions.length > 0 && (
                      <div className="pt-2">
                        <p className="text-sm font-medium mb-2">適用されるアクション:</p>
                        {evaluateMut.data.appliedActions.map((action: any, i: number) => (
                          <Badge key={i} variant="secondary" className="mr-2 mb-1">
                            <Zap className="h-3 w-3 mr-1" />{actionLabel(action.type)}: {action.value}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 3: Application Logs */}
          <TabsContent value="logs" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" /> 適用ログ
                </CardTitle>
                <CardDescription>ルールが実際に適用された履歴</CardDescription>
              </CardHeader>
              <CardContent>
                {logsLoading && (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!logsLoading && (!logs || logs.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">適用ログがまだありません</p>
                )}
                {logs && logs.length > 0 && (
                  <div className="space-y-2">
                    {logs.map((log: any, i: number) => (
                      <div key={log.id || i} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                        <div className="flex-shrink-0 mt-1">
                          <Zap className="h-4 w-4 text-yellow-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{log.ruleName}</span>
                            <Badge variant="outline" className="text-xs">
                              {conditionLabel(log.conditionType)}: {log.conditionValue}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            アクション: {actionLabel(log.actionType)} → {log.actionValue}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {log.appliedAt ? new Date(log.appliedAt).toLocaleString("ja-JP") : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
