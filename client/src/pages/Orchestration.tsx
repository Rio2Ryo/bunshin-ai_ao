import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Bot, Zap, MessageSquare, BarChart3, FileText, Brain } from "lucide-react";

const TASK_TYPES = [
  {
    id: "conversation",
    name: "会話・対話",
    description: "分身AIとのチャット、日常的な会話",
    icon: MessageSquare,
  },
  {
    id: "analysis",
    name: "分析・評価",
    description: "マッチング分析、相性評価、レポート生成",
    icon: BarChart3,
  },
  {
    id: "knowledge",
    name: "知識処理",
    description: "ドキュメント解析、知識ベース構築",
    icon: FileText,
  },
  {
    id: "reasoning",
    name: "推論・判断",
    description: "複雑な意思決定、戦略立案",
    icon: Brain,
  },
];

const AI_PROVIDERS = [
  { id: "builtin", name: "ビルトイン", description: "デフォルトのAIモデル" },
  { id: "openai", name: "OpenAI GPT", description: "高度な推論能力" },
  { id: "gemini", name: "Google Gemini", description: "マルチモーダル対応" },
  { id: "anthropic", name: "Claude", description: "長文処理に強い" },
  { id: "grok", name: "Grok", description: "リアルタイム情報" },
];

export default function Orchestration() {
  usePageMeta({ title: "オーケストレーション", description: "AIモデルのタスク別割り当て設定", path: "/orchestration" });
  const { data: settings, isLoading, isError, refetch } = trpc.orchestration.getSettings.useQuery();
  const updateSettings = trpc.orchestration.updateSettings.useMutation();

  const [defaultProvider, setDefaultProvider] = useState<string>("builtin");

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({
        defaultProvider: defaultProvider as "openai" | "gemini" | "anthropic" | "grok" | "builtin",
      });
      toast.success("設定を保存しました");
      refetch();
    } catch (error) {
      toast.error("保存に失敗しました");
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

  if (isError) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <p className="text-muted-foreground">オーケストレーション設定の読み込みに失敗しました</p>
          <button onClick={() => window.location.reload()} className="text-primary underline text-sm">再読み込み</button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">AIオーケストレーション</h1>
            <p className="text-muted-foreground mt-2">
              複数のAIモデルを使い分け、タスクに最適なAIを選択します
            </p>
          </div>
          <Button onClick={handleSave} disabled={updateSettings.isPending}>
            {updateSettings.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Save className="h-4 w-4 mr-2" />
            保存
          </Button>
        </div>

        {/* オーケストレーションの説明 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              Manusのオーケストレーション
            </CardTitle>
            <CardDescription>
              Manusは単独のAIではなく、複数のAI（Claude、GPT、Geminiなど）を使い分けるオーケストレーターです
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              タスクの種類に応じて最適なAIモデルを自動選択し、全体をプロジェクトマネジメントします。
              外部AIのAPIキーを設定すると、より高度な処理が可能になります。
            </p>
          </CardContent>
        </Card>

        {/* デフォルトプロバイダー設定 */}
        <Card>
          <CardHeader>
            <CardTitle>デフォルトAIプロバイダー</CardTitle>
            <CardDescription>
              特に指定がない場合に使用するAIプロバイダーを選択します
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>プロバイダー</Label>
              <Select value={defaultProvider} onValueChange={setDefaultProvider}>
                <SelectTrigger className="w-full md:w-[300px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_PROVIDERS.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      <div className="flex flex-col">
                        <span>{provider.name}</span>
                        <span className="text-xs text-muted-foreground">{provider.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* タスクタイプ一覧 */}
        <Card>
          <CardHeader>
            <CardTitle>タスクタイプ</CardTitle>
            <CardDescription>
              各タスクタイプに対して、どのAIが使用されるかを確認できます
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              {TASK_TYPES.map((task) => {
                const Icon = task.icon;
                return (
                  <div key={task.id} className="p-4 rounded-lg border bg-muted/30">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">{task.name}</p>
                        <p className="text-xs text-muted-foreground">{task.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Bot className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        使用AI: {AI_PROVIDERS.find(p => p.id === defaultProvider)?.name || "ビルトイン"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* 登録済みロール */}
        {settings?.roles && settings.roles.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>登録済みの役割設定</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {settings.roles.map((role) => (
                  <div key={role.id} className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <p className="font-medium">{role.roleName}</p>
                      <p className="text-sm text-muted-foreground">{role.roleDescription}</p>
                    </div>
                    <div className="text-sm">
                      <span className="px-2 py-1 rounded bg-primary/10 text-primary">
                        {AI_PROVIDERS.find(p => p.id === role.assignedProvider)?.name || role.assignedProvider}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
