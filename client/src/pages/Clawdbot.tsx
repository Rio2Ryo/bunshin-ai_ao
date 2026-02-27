import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { 
  Bot, 
  Settings, 
  MessageSquare, 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  Trash2,
  Send,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
  Brain,
  Link2,
  GraduationCap,
  TrendingUp,
  Heart,
  ThumbsDown,
  Star,
  MessageCircle,
  Sparkles,
  BarChart3,
  Edit3,
  Save
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function ClawdbotPage() {
  usePageMeta({ title: "Clawdbot連携", description: "Clawdbotゲートウェイとの連携設定", path: "/clawdbot" });
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [agentId, setAgentId] = useState("main");
  const [chatMessage, setChatMessage] = useState("");
  const [sessionKey, setSessionKey] = useState<string | undefined>();
  
  const [settings, setSettings] = useState({
    enableMemorySync: true,
    enableSkillAccess: true,
    enableChannelBridge: true,
    preferredModel: "claude-3-5-sonnet",
    sessionPersistence: true,
  });

  const { data: connection, refetch: refetchConnection } = trpc.clawdbot.getConnection.useQuery();
  const { data: messageHistory, refetch: refetchHistory } = trpc.clawdbot.getMessageHistory.useQuery({ limit: 50 });
  const { data: models } = trpc.clawdbot.getModels.useQuery(undefined, {
    enabled: connection?.status === "active",
  });

  // 学習状況の取得
  const { data: learningStatus, refetch: refetchLearningStatus } = trpc.clawdbot.getLearningStatus.useQuery();
  const { data: learnedTraits, refetch: refetchLearnedTraits } = trpc.clawdbot.getLearnedTraits.useQuery();

  // 会話同期
  const syncConversations = trpc.clawdbot.syncConversations.useMutation({
    onSuccess: (result) => {
      toast.success(`${result.synced}件の会話を同期しました`);
      refetchLearningStatus();
    },
    onError: (error) => {
      toast.error(`同期エラー: ${error.message}`);
    },
  });

  // 人格分析
  const analyzePersonality = trpc.clawdbot.analyzePersonality.useMutation({
    onSuccess: (result) => {
      toast.success(typeof result.analyzed === "number" ? `${result.analyzed}件の会話を分析しました` : "人格分析を実行しました");
      refetchLearningStatus();
      refetchLearnedTraits();
    },
    onError: (error) => {
      toast.error(`分析エラー: ${error.message}`);
    },
  });

  // 学習設定更新
  const updateLearningSettings = trpc.clawdbot.updateLearningSettings.useMutation({
    onSuccess: () => {
      toast.success("学習設定を更新しました");
      refetchLearningStatus();
    },
    onError: (error) => {
      toast.error(`設定更新エラー: ${error.message}`);
    },
  });

  const createConnection = trpc.clawdbot.createConnection.useMutation({
    onSuccess: () => {
      toast.success("Clawdbot接続を作成しました！");
      refetchConnection();
    },
    onError: (error) => {
      toast.error(`接続作成エラー: ${error.message}`);
    },
  });

  const updateConnection = trpc.clawdbot.updateConnection.useMutation({
    onSuccess: () => {
      toast.success("接続設定を更新しました");
      refetchConnection();
    },
    onError: (error) => {
      toast.error(`更新エラー: ${error.message}`);
    },
  });

  const testConnection = trpc.clawdbot.testConnection.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
      refetchConnection();
    },
    onError: (error) => {
      toast.error(`テストエラー: ${error.message}`);
    },
  });

  const sendMessage = trpc.clawdbot.sendMessage.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        setChatMessage("");
        setSessionKey(result.sessionKey);
        refetchHistory();
      } else {
        toast.error(result.error || "メッセージ送信に失敗しました");
      }
    },
    onError: (error) => {
      toast.error(`送信エラー: ${error.message}`);
    },
  });

  const deleteConnection = trpc.clawdbot.deleteConnection.useMutation({
    onSuccess: () => {
      toast.success("接続を削除しました");
      refetchConnection();
    },
    onError: (error) => {
      toast.error(`削除エラー: ${error.message}`);
    },
  });

  const handleCreateConnection = () => {
    if (!gatewayUrl) {
      toast.error("Gateway URLを入力してください");
      return;
    }
    createConnection.mutate({
      gatewayUrl,
      authToken: authToken || undefined,
      agentId,
      settings,
    });
  };

  const handleSendMessage = () => {
    if (!chatMessage.trim()) return;
    sendMessage.mutate({
      message: chatMessage,
      sessionKey,
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />アクティブ</Badge>;
      case "testing":
        return <Badge className="bg-yellow-500"><RefreshCw className="w-3 h-3 mr-1 animate-spin" />テスト中</Badge>;
      case "error":
        return <Badge className="bg-red-500"><XCircle className="w-3 h-3 mr-1" />エラー</Badge>;
      case "disconnected":
        return <Badge className="bg-gray-500"><WifiOff className="w-3 h-3 mr-1" />切断</Badge>;
      default:
        return <Badge className="bg-blue-500"><Clock className="w-3 h-3 mr-1" />待機中</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Bot className="w-8 h-8" />
            Clawdbot連携
          </h1>
          <p className="text-muted-foreground mt-2">
            Clawdbotと連携して、分身AIをLINE・WhatsApp・Telegramなどから操作できるようにします
          </p>
        </div>

        <Tabs defaultValue={connection ? "status" : "setup"} className="space-y-4">
          <TabsList>
            <TabsTrigger value="setup">
              <Settings className="w-4 h-4 mr-2" />
              セットアップ
            </TabsTrigger>
            <TabsTrigger value="status" disabled={!connection}>
              <Wifi className="w-4 h-4 mr-2" />
              ステータス
            </TabsTrigger>
            <TabsTrigger value="chat" disabled={connection?.status !== "active"}>
              <MessageSquare className="w-4 h-4 mr-2" />
              チャット
            </TabsTrigger>
            <TabsTrigger value="learning">
              <GraduationCap className="w-4 h-4 mr-2" />
              学習状況
            </TabsTrigger>
          </TabsList>

          <TabsContent value="setup" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="w-5 h-5" />
                  Clawdbot Gateway接続
                </CardTitle>
                <CardDescription>
                  Clawdbotをセルフホストしている場合、Gateway URLを入力して接続します
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {connection ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                      <div>
                        <p className="font-medium">接続済み</p>
                        <p className="text-sm text-muted-foreground">{connection.gatewayUrl}</p>
                      </div>
                      {getStatusBadge(connection.status)}
                    </div>
                    
                    <div className="flex gap-2">
                      <Button
                        onClick={() => testConnection.mutate()}
                        disabled={testConnection.isPending}
                      >
                        <RefreshCw className={`w-4 h-4 mr-2 ${testConnection.isPending ? "animate-spin" : ""}`} />
                        接続テスト
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => {
                          if (confirm("接続を削除しますか？")) {
                            deleteConnection.mutate();
                          }
                        }}
                        disabled={deleteConnection.isPending}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        削除
                      </Button>
                    </div>

                    {connection.lastError && (
                      <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <p className="text-sm text-red-600 dark:text-red-400">
                          最後のエラー: {connection.lastError}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="gatewayUrl">Gateway URL *</Label>
                      <Input
                        id="gatewayUrl"
                        placeholder="http://localhost:4141 または ws://your-server:4141"
                        value={gatewayUrl}
                        onChange={(e) => setGatewayUrl(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        ClawdbotのGatewayサーバーのURLを入力してください
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="authToken">認証トークン（オプション）</Label>
                      <Input
                        id="authToken"
                        type="password"
                        placeholder="Bearer token"
                        value={authToken}
                        onChange={(e) => setAuthToken(e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="agentId">エージェントID</Label>
                      <Input
                        id="agentId"
                        placeholder="main"
                        value={agentId}
                        onChange={(e) => setAgentId(e.target.value)}
                      />
                    </div>

                    <Button
                      onClick={handleCreateConnection}
                      disabled={createConnection.isPending || !gatewayUrl}
                      className="w-full"
                    >
                      <Zap className="w-4 h-4 mr-2" />
                      {createConnection.isPending ? "接続中..." : "接続を作成"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {connection && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Brain className="w-5 h-5" />
                    連携設定
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>メモリ同期</Label>
                      <p className="text-sm text-muted-foreground">Clawdbotのメモリを分身AIと同期</p>
                    </div>
                    <Switch
                      checked={settings.enableMemorySync}
                      onCheckedChange={(checked) => {
                        setSettings({ ...settings, enableMemorySync: checked });
                        updateConnection.mutate({ settings: { ...settings, enableMemorySync: checked } });
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>スキルアクセス</Label>
                      <p className="text-sm text-muted-foreground">Clawdbotのスキルを分身AIから利用</p>
                    </div>
                    <Switch
                      checked={settings.enableSkillAccess}
                      onCheckedChange={(checked) => {
                        setSettings({ ...settings, enableSkillAccess: checked });
                        updateConnection.mutate({ settings: { ...settings, enableSkillAccess: checked } });
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>チャンネルブリッジ</Label>
                      <p className="text-sm text-muted-foreground">LINE/WhatsApp等からの分身AI操作</p>
                    </div>
                    <Switch
                      checked={settings.enableChannelBridge}
                      onCheckedChange={(checked) => {
                        setSettings({ ...settings, enableChannelBridge: checked });
                        updateConnection.mutate({ settings: { ...settings, enableChannelBridge: checked } });
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>セッション永続化</Label>
                      <p className="text-sm text-muted-foreground">会話コンテキストを保持</p>
                    </div>
                    <Switch
                      checked={settings.sessionPersistence}
                      onCheckedChange={(checked) => {
                        setSettings({ ...settings, sessionPersistence: checked });
                        updateConnection.mutate({ settings: { ...settings, sessionPersistence: checked } });
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="status" className="space-y-4">
            {connection && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>接続ステータス</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="text-center p-4 bg-muted rounded-lg">
                        <p className="text-2xl font-bold">{connection.totalMessages}</p>
                        <p className="text-sm text-muted-foreground">総メッセージ数</p>
                      </div>
                      <div className="text-center p-4 bg-muted rounded-lg">
                        <p className="text-2xl font-bold">{getStatusBadge(connection.status)}</p>
                        <p className="text-sm text-muted-foreground">ステータス</p>
                      </div>
                      <div className="text-center p-4 bg-muted rounded-lg">
                        <p className="text-sm font-medium">
                          {connection.lastConnectionTest
                            ? new Date(connection.lastConnectionTest).toLocaleString("ja-JP")
                            : "-"}
                        </p>
                        <p className="text-sm text-muted-foreground">最終テスト</p>
                      </div>
                      <div className="text-center p-4 bg-muted rounded-lg">
                        <p className="text-sm font-medium">
                          {connection.lastMessageAt
                            ? new Date(connection.lastMessageAt).toLocaleString("ja-JP")
                            : "-"}
                        </p>
                        <p className="text-sm text-muted-foreground">最終メッセージ</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {models?.success && models.models && (
                  <Card>
                    <CardHeader>
                      <CardTitle>利用可能なモデル</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {models.models.map((model) => (
                          <Badge key={model} variant="outline">
                            {model}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="chat" className="space-y-4">
            <Card className="h-[600px] flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5" />
                  Clawdbot経由チャット
                </CardTitle>
                <CardDescription>
                  Clawdbotを通じて分身AIと会話します
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <div className="flex-1 overflow-y-auto space-y-4 mb-4 p-4 bg-muted/50 rounded-lg">
                  {messageHistory?.length === 0 && (
                    <p className="text-center text-muted-foreground">
                      メッセージがありません。会話を始めましょう！
                    </p>
                  )}
                  {messageHistory?.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.direction === "to_clawdbot" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] p-3 rounded-lg ${
                          msg.direction === "to_clawdbot"
                            ? "bg-primary text-primary-foreground"
                            : "bg-background border"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        <p className="text-xs opacity-70 mt-1">
                          {new Date(msg.createdAt).toLocaleTimeString("ja-JP")}
                          {msg.responseTimeMs && ` (${msg.responseTimeMs}ms)`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <Textarea
                    placeholder="メッセージを入力..."
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    className="resize-none"
                    rows={2}
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={sendMessage.isPending || !chatMessage.trim()}
                    className="px-6"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="learning" className="space-y-4">
            {/* 学習サマリー */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">総会話数</p>
                      <p className="text-3xl font-bold">{learningStatus?.totalSnippets || 0}</p>
                    </div>
                    <MessageCircle className="w-8 h-8 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">分析済み</p>
                      <p className="text-3xl font-bold">{learningStatus?.analyzedSnippets || 0}</p>
                    </div>
                    <BarChart3 className="w-8 h-8 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">分析回数</p>
                      <p className="text-3xl font-bold">{learningStatus?.learning?.analysisCount || 0}</p>
                    </div>
                    <TrendingUp className="w-8 h-8 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 学習進捗 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5" />
                  学習進捗
                </CardTitle>
                <CardDescription>
                  会話が{learningStatus?.learning?.learningThreshold || 10}件貯まると自動で人格分析を実行します
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>未分析の会話</span>
                    <span>{learningStatus?.learning?.pendingConversations || 0} / {learningStatus?.learning?.learningThreshold || 10}</span>
                  </div>
                  <Progress 
                    value={((learningStatus?.learning?.pendingConversations || 0) / (learningStatus?.learning?.learningThreshold || 10)) * 100} 
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => syncConversations.mutate()}
                    disabled={syncConversations.isPending}
                    variant="outline"
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${syncConversations.isPending ? "animate-spin" : ""}`} />
                    会話を同期
                  </Button>
                  <Button
                    onClick={() => analyzePersonality.mutate()}
                    disabled={analyzePersonality.isPending || (learningStatus?.learning?.pendingConversations || 0) === 0}
                  >
                    <Brain className={`w-4 h-4 mr-2 ${analyzePersonality.isPending ? "animate-spin" : ""}`} />
                    今すぐ分析
                  </Button>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div>
                    <Label>自動学習</Label>
                    <p className="text-sm text-muted-foreground">閾値に達したら自動で分析</p>
                  </div>
                  <Switch
                    checked={learningStatus?.learning?.autoLearnEnabled === 1}
                    onCheckedChange={(checked) => {
                      updateLearningSettings.mutate({ autoLearnEnabled: checked });
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            {/* 学習した人格特性 */}
            {learnedTraits && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Brain className="w-5 h-5" />
                    学習した人格特性
                  </CardTitle>
                  <CardDescription>
                    会話から抽出されたあなたの特徴
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px] pr-4">
                    <div className="space-y-6">
                      {/* 好きなこと */}
                      {learnedTraits.likes?.length > 0 && (
                        <div>
                          <h4 className="font-medium flex items-center gap-2 mb-2">
                            <Heart className="w-4 h-4 text-pink-500" />
                            好きなこと
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {learnedTraits.likes.map((item: string, i: number) => (
                              <Badge key={i} variant="secondary" className="bg-pink-100 dark:bg-pink-900/30">
                                {item}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 苦手なこと */}
                      {learnedTraits.dislikes?.length > 0 && (
                        <div>
                          <h4 className="font-medium flex items-center gap-2 mb-2">
                            <ThumbsDown className="w-4 h-4 text-gray-500" />
                            苦手なこと
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {learnedTraits.dislikes.map((item: string, i: number) => (
                              <Badge key={i} variant="secondary" className="bg-gray-100 dark:bg-gray-800">
                                {item}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 価値観 */}
                      {learnedTraits.values?.length > 0 && (
                        <div>
                          <h4 className="font-medium flex items-center gap-2 mb-2">
                            <Star className="w-4 h-4 text-yellow-500" />
                            大切にしている価値観
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {learnedTraits.values.map((item: string, i: number) => (
                              <Badge key={i} variant="secondary" className="bg-yellow-100 dark:bg-yellow-900/30">
                                {item}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 興味・関心 */}
                      {learnedTraits.interests?.length > 0 && (
                        <div>
                          <h4 className="font-medium flex items-center gap-2 mb-2">
                            <Sparkles className="w-4 h-4 text-blue-500" />
                            興味・関心
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {learnedTraits.interests.map((item: string, i: number) => (
                              <Badge key={i} variant="secondary" className="bg-blue-100 dark:bg-blue-900/30">
                                {item}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 口癖 */}
                      {learnedTraits.catchphrases?.length > 0 && (
                        <div>
                          <h4 className="font-medium flex items-center gap-2 mb-2">
                            <MessageCircle className="w-4 h-4 text-green-500" />
                            口癖・よく使う表現
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {[...learnedTraits.catchphrases, ...(learnedTraits.frequentExpressions || [])].map((item: string, i: number) => (
                              <Badge key={i} variant="outline" className="border-green-500">
                                「{item}」
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* コミュニケーションスタイル */}
                      {learnedTraits.communicationStyle && (
                        <div>
                          <h4 className="font-medium flex items-center gap-2 mb-3">
                            <BarChart3 className="w-4 h-4 text-purple-500" />
                            コミュニケーションスタイル
                          </h4>
                          <div className="space-y-3">
                            <div>
                              <div className="flex justify-between text-sm mb-1">
                                <span>カジュアル</span>
                                <span>フォーマル</span>
                              </div>
                              <Progress value={learnedTraits.communicationStyle.formality} />
                            </div>
                            <div>
                              <div className="flex justify-between text-sm mb-1">
                                <span>簡潔</span>
                                <span>詳細</span>
                              </div>
                              <Progress value={learnedTraits.communicationStyle.verbosity} />
                            </div>
                            <div>
                              <div className="flex justify-between text-sm mb-1">
                                <span>論理的</span>
                                <span>感情的</span>
                              </div>
                              <Progress value={learnedTraits.communicationStyle.emotionality} />
                            </div>
                            <div>
                              <div className="flex justify-between text-sm mb-1">
                                <span>婉曲</span>
                                <span>直接的</span>
                              </div>
                              <Progress value={learnedTraits.communicationStyle.directness} />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 意思決定スタイル */}
                      {learnedTraits.decisionMakingStyle && learnedTraits.decisionMakingStyle !== "未分析" && (
                        <div>
                          <h4 className="font-medium mb-2">意思決定スタイル</h4>
                          <p className="text-muted-foreground">{learnedTraits.decisionMakingStyle}</p>
                        </div>
                      )}

                      {/* 最終分析日時 */}
                      {learnedTraits.lastAnalyzedAt && (
                        <div className="text-sm text-muted-foreground pt-4 border-t">
                          最終分析: {new Date(learnedTraits.lastAnalyzedAt).toLocaleString("ja-JP")}
                          （累計 {learnedTraits.totalConversationsAnalyzed} 回）
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* 学習データがない場合 */}
            {!learnedTraits && (
              <Card>
                <CardContent className="py-12 text-center">
                  <GraduationCap className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">まだ学習データがありません</h3>
                  <p className="text-muted-foreground mb-4">
                    Clawdbotで会話をすると、自動的にあなたの人格を学習します
                  </p>
                  <Button
                    onClick={() => syncConversations.mutate()}
                    disabled={syncConversations.isPending}
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${syncConversations.isPending ? "animate-spin" : ""}`} />
                    会話を同期して学習を開始
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Clawdbotの説明 */}
        <Card>
          <CardHeader>
            <CardTitle>Clawdbotとは？</CardTitle>
          </CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none">
            <p>
              <a href="https://clawd.bot" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Clawdbot
              </a>
              は、Peter Steinberger氏が開発したオープンソースのパーソナルAIアシスタントです。
            </p>
            <ul>
              <li><strong>セルフホスト</strong>: Mac/Windows/Linuxで動作、データは自分のマシンに保存</li>
              <li><strong>マルチチャネル</strong>: LINE、WhatsApp、Telegram、Discord、Slackなどに対応</li>
              <li><strong>永続的メモリ</strong>: 会話を重ねるほど賢くなる2層メモリシステム</li>
              <li><strong>スキルシステム</strong>: プラグインで機能を拡張可能</li>
            </ul>
            <p>
              分身AIとClawdbotを連携することで、LINEやWhatsAppから分身AIと会話したり、
              Clawdbotのスキル（カレンダー、リマインダーなど）を分身AIから利用できます。
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
