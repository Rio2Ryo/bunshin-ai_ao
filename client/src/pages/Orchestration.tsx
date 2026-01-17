import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
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

const AI_MODELS = [
  { id: "builtin", name: "ビルトイン", description: "デフォルトのAIモデル" },
  { id: "openai", name: "OpenAI GPT-4", description: "高度な推論能力" },
  { id: "openai-fast", name: "OpenAI GPT-3.5", description: "高速レスポンス" },
  { id: "gemini", name: "Google Gemini", description: "マルチモーダル対応" },
  { id: "anthropic", name: "Claude", description: "長文処理に強い" },
  { id: "grok", name: "Grok", description: "リアルタイム情報" },
];

export default function Orchestration() {
  const { data: settings, isLoading, refetch } = trpc.orchestration.getSettings.useQuery();
  const updateSettings = trpc.orchestration.updateSettings.useMutation();

  const [taskAssignments, setTaskAssignments] = useState<Record<string, string>>({
    conversation: "builtin",
    analysis: "builtin",
    knowledge: "builtin",
    reasoning: "builtin",
  });

  const [autoSelect, setAutoSelect] = useState(true);
  const [costOptimization, setCostOptimization] = useState(50);
  const [qualityPriority, setQualityPriority] = useState(50);

  useEffect(() => {
    if (settings) {
      setTaskAssignments(settings.taskAssignments || taskAssignments);
      setAutoSelect(settings.autoSelect ?? true);
      setCostOptimization(settings.costOptimization ?? 50);
      setQualityPriority(settings.qualityPriority ?? 50);
    }
  }, [settings]);

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({
        taskAssignments,
        autoSelect,
        costOptimization,
        qualityPriority,
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

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-3xl font-bold">AIオーケストレーション</h1>
          <p className="text-muted-foreground mt-2">
            複数のAIモデルに役割を割り当て、タスクに応じて最適なAIを自動選択します。
          </p>
        </div>

        {/* Concept Explanation */}
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold mb-2">AIオーケストレーションとは</h3>
                <p className="text-sm text-muted-foreground">
                  単一のAIに頼るのではなく、Claude、GPT、Geminiなど複数の異なるAIを使い分け、
                  それぞれに最適な役割を割り当てて全体をプロジェクトマネジメントする仕組みです。
                  タスクの種類に応じて最適なAIを自動選択し、効率的かつ高品質な結果を実現します。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Auto Selection */}
        <Card>
          <CardHeader>
            <CardTitle>自動選択モード</CardTitle>
            <CardDescription>
              タスクの内容を分析し、最適なAIモデルを自動的に選択します
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="auto-select">自動選択を有効にする</Label>
                <p className="text-sm text-muted-foreground">
                  オフにすると、下記の手動設定が優先されます
                </p>
              </div>
              <Switch
                id="auto-select"
                checked={autoSelect}
                onCheckedChange={setAutoSelect}
              />
            </div>
          </CardContent>
        </Card>

        {/* Task Assignments */}
        <Card>
          <CardHeader>
            <CardTitle>タスク別AI割り当て</CardTitle>
            <CardDescription>
              各タスクタイプに使用するAIモデルを設定します
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {TASK_TYPES.map((task) => {
                const Icon = task.icon;
                return (
                  <div key={task.id} className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <Label className="font-medium">{task.name}</Label>
                      <p className="text-sm text-muted-foreground">{task.description}</p>
                    </div>
                    <Select
                      value={taskAssignments[task.id]}
                      onValueChange={(value) =>
                        setTaskAssignments({ ...taskAssignments, [task.id]: value })
                      }
                      disabled={autoSelect}
                    >
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AI_MODELS.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            <div>
                              <p>{model.name}</p>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Optimization Settings */}
        <Card>
          <CardHeader>
            <CardTitle>最適化設定</CardTitle>
            <CardDescription>
              コストと品質のバランスを調整します
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>コスト最適化</Label>
                <span className="text-sm text-muted-foreground">{costOptimization}%</span>
              </div>
              <Slider
                value={[costOptimization]}
                onValueChange={([value]) => setCostOptimization(value)}
                max={100}
                step={10}
              />
              <p className="text-xs text-muted-foreground">
                高い値: 低コストのモデルを優先 / 低い値: 高性能モデルを優先
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>品質優先度</Label>
                <span className="text-sm text-muted-foreground">{qualityPriority}%</span>
              </div>
              <Slider
                value={[qualityPriority]}
                onValueChange={([value]) => setQualityPriority(value)}
                max={100}
                step={10}
              />
              <p className="text-xs text-muted-foreground">
                高い値: 品質重視（時間がかかる場合あり） / 低い値: 速度重視
              </p>
            </div>
          </CardContent>
        </Card>

        {/* AI Models Overview */}
        <Card>
          <CardHeader>
            <CardTitle>利用可能なAIモデル</CardTitle>
            <CardDescription>
              設定されているAPIキーに基づいて利用可能なモデルを表示
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              {AI_MODELS.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                >
                  <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{model.name}</p>
                    <p className="text-xs text-muted-foreground">{model.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={updateSettings.isPending}>
            {updateSettings.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Save className="h-4 w-4 mr-2" />
            設定を保存
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
