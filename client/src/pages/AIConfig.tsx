import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Key, Trash2, CheckCircle, XCircle, ExternalLink } from "lucide-react";

const AI_PROVIDERS = [
  {
    id: "openai" as const,
    name: "OpenAI (ChatGPT)",
    description: "GPT-4、GPT-3.5などのモデルを使用",
    docsUrl: "https://platform.openai.com/api-keys",
    placeholder: "sk-...",
  },
  {
    id: "gemini" as const,
    name: "Google Gemini",
    description: "Gemini Pro、Gemini Ultraなどのモデルを使用",
    docsUrl: "https://aistudio.google.com/app/apikey",
    placeholder: "AIza...",
  },
  {
    id: "anthropic" as const,
    name: "Anthropic (Claude)",
    description: "Claude 3、Claude 2などのモデルを使用",
    docsUrl: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-...",
  },
  {
    id: "grok" as const,
    name: "xAI (Grok)",
    description: "Grokモデルを使用",
    docsUrl: "https://console.x.ai/",
    placeholder: "xai-...",
  },
];

export default function AIConfig() {
  const { data: configs, isLoading, refetch } = trpc.aiConfig.list.useQuery();
  const upsertConfig = trpc.aiConfig.upsert.useMutation();
  const deleteConfig = trpc.aiConfig.delete.useMutation();

  const [newKeys, setNewKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  const getConfigForProvider = (providerId: string) => {
    return configs?.find((c) => c.provider === providerId);
  };

  const handleSaveKey = async (providerId: "openai" | "gemini" | "anthropic" | "grok") => {
    const apiKey = newKeys[providerId];
    if (!apiKey?.trim()) {
      toast.error("APIキーを入力してください");
      return;
    }

    try {
      await upsertConfig.mutateAsync({
        provider: providerId,
        apiKey: apiKey.trim(),
      });
      toast.success("APIキーを保存しました");
      setNewKeys({ ...newKeys, [providerId]: "" });
      refetch();
    } catch (error) {
      toast.error("保存に失敗しました");
    }
  };

  const handleDeleteKey = async (providerId: "openai" | "gemini" | "anthropic" | "grok") => {
    if (!confirm("このAPIキーを削除しますか？")) return;

    try {
      await deleteConfig.mutateAsync({ provider: providerId });
      toast.success("削除しました");
      refetch();
    } catch (error) {
      toast.error("削除に失敗しました");
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-3xl font-bold">AI API設定</h1>
          <p className="text-muted-foreground mt-2">
            外部AIサービスのAPIキーを設定して、分身AIの機能を拡張します。
          </p>
        </div>

        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <Key className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">ビルトインAI</h3>
                <p className="text-sm text-muted-foreground">
                  基本的なAI機能はビルトインで提供されています。
                  外部APIキーを設定すると、追加のAIモデルを使用できます。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4">
            {AI_PROVIDERS.map((provider) => {
              const config = getConfigForProvider(provider.id);
              const hasKey = !!config;

              return (
                <Card key={provider.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          {provider.name}
                          {hasKey ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-muted-foreground" />
                          )}
                        </CardTitle>
                        <CardDescription>{provider.description}</CardDescription>
                      </div>
                      <a
                        href={provider.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline flex items-center gap-1"
                      >
                        APIキーを取得
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {hasKey ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
                          <div>
                            <p className="text-sm font-medium">登録済み</p>
                            <p className="text-xs text-muted-foreground font-mono">
                              {config.apiKey}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-2">
                              <Label htmlFor={`active-${provider.id}`} className="text-sm">
                                有効
                              </Label>
                              <Switch
                                id={`active-${provider.id}`}
                                checked={config.isActive === 1}
                                onCheckedChange={async (checked) => {
                                  await upsertConfig.mutateAsync({
                                    provider: provider.id,
                                    apiKey: config.apiKey.includes("...") 
                                      ? config.apiKey 
                                      : config.apiKey,
                                    isActive: checked ? 1 : 0,
                                  });
                                  refetch();
                                }}
                              />
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteKey(provider.id)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>新しいAPIキーで更新</Label>
                          <div className="flex gap-2">
                            <Input
                              type={showKeys[provider.id] ? "text" : "password"}
                              value={newKeys[provider.id] || ""}
                              onChange={(e) =>
                                setNewKeys({ ...newKeys, [provider.id]: e.target.value })
                              }
                              placeholder={provider.placeholder}
                            />
                            <Button
                              variant="outline"
                              onClick={() =>
                                setShowKeys({ ...showKeys, [provider.id]: !showKeys[provider.id] })
                              }
                            >
                              {showKeys[provider.id] ? "隠す" : "表示"}
                            </Button>
                            <Button
                              onClick={() => handleSaveKey(provider.id)}
                              disabled={upsertConfig.isPending}
                            >
                              {upsertConfig.isPending && (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              )}
                              更新
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label>APIキー</Label>
                        <div className="flex gap-2">
                          <Input
                            type={showKeys[provider.id] ? "text" : "password"}
                            value={newKeys[provider.id] || ""}
                            onChange={(e) =>
                              setNewKeys({ ...newKeys, [provider.id]: e.target.value })
                            }
                            placeholder={provider.placeholder}
                          />
                          <Button
                            variant="outline"
                            onClick={() =>
                              setShowKeys({ ...showKeys, [provider.id]: !showKeys[provider.id] })
                            }
                          >
                            {showKeys[provider.id] ? "隠す" : "表示"}
                          </Button>
                          <Button
                            onClick={() => handleSaveKey(provider.id)}
                            disabled={upsertConfig.isPending}
                          >
                            {upsertConfig.isPending && (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            )}
                            保存
                          </Button>
                        </div>
                      </div>
                    )}
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
