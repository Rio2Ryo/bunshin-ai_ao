import { useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { trpc } from "../lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { 
  Settings, 
  Cpu, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Zap,
  MessageSquare,
  Brain,
  Target,
  Heart,
  BookOpen,
  Users
} from "lucide-react";

// プロバイダー情報
const PROVIDERS = {
  manus: { name: "Manus内蔵LLM", description: "Manusプラットフォーム提供のLLM", color: "bg-cyan-500" },
  gemini: { name: "Google Gemini", description: "Googleの最新AIモデル", color: "bg-blue-500" },
  openai: { name: "OpenAI (ChatGPT)", description: "OpenAIのGPTモデル", color: "bg-green-500" },
  anthropic: { name: "Anthropic (Claude)", description: "AnthropicのClaudeモデル", color: "bg-orange-500" },
  grok: { name: "xAI (Grok)", description: "xAIのGrokモデル", color: "bg-purple-500" },
};

// 機能情報
const FEATURES = {
  default: { name: "デフォルト", description: "他の設定がない場合に使用", icon: Settings },
  chat: { name: "分身AIとの会話", description: "日常的な会話・質問応答", icon: MessageSquare },
  personality: { name: "性格診断", description: "ビッグファイブ・MBTI診断", icon: Brain },
  value_scenario: { name: "価値観シナリオ", description: "価値観シナリオの評価", icon: Target },
  matching: { name: "マッチング分析", description: "相性分析・マッチング", icon: Heart },
  memory: { name: "記憶・要約", description: "会話の記憶と要約", icon: BookOpen },
  prediction: { name: "友達予測", description: "友達の分身AIによる予測", icon: Users },
};

type Provider = keyof typeof PROVIDERS;
type Feature = keyof typeof FEATURES;

export default function AdminAIProvider() {
  const [selectedFeature, setSelectedFeature] = useState<Feature>("default");
  const [testingProvider, setTestingProvider] = useState<Provider | null>(null);

  // 利用可能なプロバイダー一覧を取得
  const { data: availableProviders, isLoading: loadingProviders } = trpc.aiProvider.getAvailableProviders.useQuery();
  
  // 現在の設定を取得
  const { data: settings, isLoading: loadingSettings, refetch: refetchSettings } = trpc.aiProvider.getSettings.useQuery();

  // 設定更新
  const updateSetting = trpc.aiProvider.updateSetting.useMutation({
    onSuccess: () => {
      toast.success("設定を更新しました");
      refetchSettings();
    },
    onError: (error) => {
      toast.error(`設定の更新に失敗しました: ${error.message}`);
    },
  });

  // プロバイダーテスト
  const testProvider = trpc.aiProvider.testProvider.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`接続成功 (${result.latency}ms)`);
      } else {
        toast.error(`接続失敗: ${result.error}`);
      }
      setTestingProvider(null);
    },
    onError: (error) => {
      toast.error(`テスト失敗: ${error.message}`);
      setTestingProvider(null);
    },
  });

  const handleProviderChange = (feature: Feature, provider: Provider) => {
    updateSetting.mutate({ feature, provider });
  };

  const handleTestProvider = (provider: Provider) => {
    setTestingProvider(provider);
    testProvider.mutate({ provider });
  };

  if (loadingProviders || loadingSettings) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* ヘッダー */}
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Cpu className="w-6 h-6 text-cyan-400" />
            AIプロバイダー設定
          </h1>
          <p className="text-gray-400 mt-1">
            機能ごとに使用するAIプロバイダーを設定できます（管理者専用）
          </p>
        </div>

        <Tabs defaultValue="providers" className="space-y-4">
          <TabsList className="bg-gray-800">
            <TabsTrigger value="providers">プロバイダー一覧</TabsTrigger>
            <TabsTrigger value="settings">機能別設定</TabsTrigger>
          </TabsList>

          {/* プロバイダー一覧タブ */}
          <TabsContent value="providers" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(Object.entries(PROVIDERS) as [Provider, typeof PROVIDERS[Provider]][]).map(([key, provider]) => {
                const availability = availableProviders?.find(p => p.provider === key);
                const isAvailable = availability?.available ?? false;

                return (
                  <Card key={key} className="bg-gray-800/50 border-gray-700">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-3 h-3 rounded-full ${provider.color}`} />
                          <CardTitle className="text-lg text-white">{provider.name}</CardTitle>
                        </div>
                        {isAvailable ? (
                          <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            利用可能
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30">
                            <XCircle className="w-3 h-3 mr-1" />
                            未設定
                          </Badge>
                        )}
                      </div>
                      <CardDescription className="text-gray-400">
                        {provider.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        disabled={!isAvailable || testingProvider === key}
                        onClick={() => handleTestProvider(key)}
                      >
                        {testingProvider === key ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            テスト中...
                          </>
                        ) : (
                          <>
                            <Zap className="w-4 h-4 mr-2" />
                            接続テスト
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card className="bg-gray-800/50 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white">APIキーの設定方法</CardTitle>
              </CardHeader>
              <CardContent className="text-gray-400 space-y-2">
                <p>各プロバイダーを使用するには、対応する環境変数にAPIキーを設定してください：</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li><code className="bg-gray-700 px-1 rounded">GEMINI_API_KEY</code> - Google Gemini</li>
                  <li><code className="bg-gray-700 px-1 rounded">OPENAI_API_KEY</code> - OpenAI (ChatGPT)</li>
                  <li><code className="bg-gray-700 px-1 rounded">ANTHROPIC_API_KEY</code> - Anthropic (Claude)</li>
                  <li><code className="bg-gray-700 px-1 rounded">XAI_API_KEY</code> - xAI (Grok)</li>
                </ul>
                <p className="text-cyan-400 text-sm mt-2">
                  ※ Manus内蔵LLMは自動で設定されています
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 機能別設定タブ */}
          <TabsContent value="settings" className="space-y-4">
            <Card className="bg-gray-800/50 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white">機能別AIプロバイダー設定</CardTitle>
                <CardDescription className="text-gray-400">
                  各機能で使用するAIプロバイダーを選択できます。場面に応じて最適なAIを使い分けることができます。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {(Object.entries(FEATURES) as [Feature, typeof FEATURES[Feature]][]).map(([key, feature]) => {
                  const Icon = feature.icon;
                  const currentProvider = settings?.[key]?.provider || "manus";

                  return (
                    <div key={key} className="flex items-center justify-between p-4 bg-gray-900/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-cyan-500/10 rounded-lg">
                          <Icon className="w-5 h-5 text-cyan-400" />
                        </div>
                        <div>
                          <p className="font-medium text-white">{feature.name}</p>
                          <p className="text-sm text-gray-400">{feature.description}</p>
                        </div>
                      </div>
                      <Select
                        value={currentProvider}
                        onValueChange={(value) => handleProviderChange(key, value as Provider)}
                      >
                        <SelectTrigger className="w-48 bg-gray-800 border-gray-600">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-gray-800 border-gray-700">
                          {(Object.entries(PROVIDERS) as [Provider, typeof PROVIDERS[Provider]][]).map(([providerKey, provider]) => {
                            const isAvailable = availableProviders?.find(p => p.provider === providerKey)?.available ?? false;
                            return (
                              <SelectItem 
                                key={providerKey} 
                                value={providerKey}
                                disabled={!isAvailable}
                                className="text-white"
                              >
                                <div className="flex items-center gap-2">
                                  <div className={`w-2 h-2 rounded-full ${provider.color}`} />
                                  {provider.name}
                                  {!isAvailable && <span className="text-gray-500 text-xs">(未設定)</span>}
                                </div>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border-cyan-500/30">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Zap className="w-5 h-5 text-yellow-400" />
                  推奨設定
                </CardTitle>
              </CardHeader>
              <CardContent className="text-gray-300 space-y-2">
                <p>各機能に最適なプロバイダーの推奨設定：</p>
                <ul className="space-y-1 text-sm">
                  <li>• <strong>会話</strong>: Manus内蔵LLM（バランスが良い）</li>
                  <li>• <strong>性格診断</strong>: Google Gemini（分析力が高い）</li>
                  <li>• <strong>価値観シナリオ</strong>: Anthropic Claude（倫理的判断に強い）</li>
                  <li>• <strong>マッチング分析</strong>: OpenAI GPT-4（総合的な判断力）</li>
                  <li>• <strong>記憶・要約</strong>: Google Gemini（長文処理に強い）</li>
                  <li>• <strong>友達予測</strong>: Manus内蔵LLM（コスト効率が良い）</li>
                </ul>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
