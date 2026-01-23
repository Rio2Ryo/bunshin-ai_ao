import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
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
  Link2
} from "lucide-react";

export default function ClawdbotPage() {
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
