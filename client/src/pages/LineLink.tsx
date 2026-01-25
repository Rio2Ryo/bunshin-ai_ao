import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { 
  MessageCircle, 
  Link2, 
  Unlink, 
  Settings, 
  History, 
  QrCode,
  CheckCircle2,
  XCircle,
  Pause,
  Play,
  RefreshCw,
  AlertCircle,
  Smartphone,
  Bot
} from "lucide-react";

export default function LineLink() {
  const [linkCode, setLinkCode] = useState("");
  const [isLinking, setIsLinking] = useState(false);
  
  // LINE連携状態を取得
  const { data: connection, isLoading, refetch } = trpc.line.getConnection.useQuery();
  
  // LINE連携コードで紐付け
  const linkMutation = trpc.line.linkByCode.useMutation({
    onSuccess: () => {
      toast.success("LINE連携が完了しました！");
      setLinkCode("");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message);
    },
    onSettled: () => {
      setIsLinking(false);
    },
  });
  
  // LINE連携を解除
  const disconnectMutation = trpc.line.disconnect.useMutation({
    onSuccess: () => {
      toast.success("LINE連携を解除しました");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
  
  // 設定を更新
  const updateSettingsMutation = trpc.line.updateSettings.useMutation({
    onSuccess: () => {
      toast.success("設定を更新しました");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
  
  // ステータスを切り替え
  const toggleStatusMutation = trpc.line.toggleStatus.useMutation({
    onSuccess: () => {
      toast.success("ステータスを更新しました");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
  
  // メッセージ履歴を取得
  const { data: messageHistory } = trpc.line.getMessageHistory.useQuery(
    { limit: 50 },
    { enabled: !!connection && connection.status === "active" }
  );
  
  const handleLink = () => {
    if (!linkCode || linkCode.length !== 6) {
      toast.error("6桁の連携コードを入力してください");
      return;
    }
    setIsLinking(true);
    linkMutation.mutate({ code: linkCode.toUpperCase() });
  };
  
  const handleDisconnect = () => {
    if (confirm("LINE連携を解除しますか？")) {
      disconnectMutation.mutate();
    }
  };
  
  const handleToggleStatus = () => {
    if (!connection) return;
    const newStatus = connection.status === "active" ? "paused" : "active";
    toggleStatusMutation.mutate({ status: newStatus });
  };
  
  const settings = connection?.settings as {
    receiveHeartbeat?: boolean;
    receiveNotifications?: boolean;
    allowVoiceMessages?: boolean;
    language?: string;
  } | null;
  
  const getStatusBadge = () => {
    if (!connection) return null;
    
    switch (connection.status) {
      case "active":
        return <Badge className="bg-green-500"><CheckCircle2 className="w-3 h-3 mr-1" />連携中</Badge>;
      case "paused":
        return <Badge variant="secondary"><Pause className="w-3 h-3 mr-1" />一時停止</Badge>;
      case "pending":
        return <Badge variant="outline"><AlertCircle className="w-3 h-3 mr-1" />未連携</Badge>;
      case "disconnected":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />解除済み</Badge>;
      default:
        return null;
    }
  };
  
  return (
    <DashboardLayout>
      <div className="container max-w-4xl py-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-green-500/10 rounded-lg">
            <MessageCircle className="w-6 h-6 text-green-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">LINE連携</h1>
            <p className="text-muted-foreground">
              LINE公式アカウントと分身AIを連携して、LINEから会話できます
            </p>
          </div>
        </div>
        
        {isLoading ? (
          <Card>
            <CardContent className="py-8 text-center">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
              <p className="mt-2 text-muted-foreground">読み込み中...</p>
            </CardContent>
          </Card>
        ) : !connection || connection.status === "disconnected" ? (
          // 未連携状態
          <div className="space-y-6">
            <Alert>
              <Smartphone className="w-4 h-4" />
              <AlertTitle>LINE連携の手順</AlertTitle>
              <AlertDescription className="mt-2">
                <ol className="list-decimal list-inside space-y-2">
                  <li>分身AI公式LINEアカウントを友だち追加</li>
                  <li>LINEで送られてくる6桁の連携コードを確認</li>
                  <li>下のフォームに連携コードを入力</li>
                </ol>
              </AlertDescription>
            </Alert>
            
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="w-5 h-5" />
                  連携コードを入力
                </CardTitle>
                <CardDescription>
                  LINE公式アカウントから送られた6桁のコードを入力してください
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <Input
                      placeholder="例: ABC123"
                      value={linkCode}
                      onChange={(e) => setLinkCode(e.target.value.toUpperCase())}
                      maxLength={6}
                      className="text-center text-2xl tracking-widest font-mono"
                    />
                  </div>
                  <Button 
                    onClick={handleLink} 
                    disabled={isLinking || linkCode.length !== 6}
                  >
                    {isLinking ? (
                      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Link2 className="w-4 h-4 mr-2" />
                    )}
                    連携する
                  </Button>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <QrCode className="w-5 h-5" />
                  公式LINEを友だち追加
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-4">
                  <p className="text-muted-foreground mb-4">
                    以下のボタンから分身AI公式LINEを友だち追加してください
                  </p>
                  <Button variant="outline" size="lg" asChild>
                    <a 
                      href="https://line.me/R/ti/p/@bunshin-ai" 
                      target="_blank" 
                      rel="noopener noreferrer"
                    >
                      <MessageCircle className="w-5 h-5 mr-2 text-green-500" />
                      友だち追加
                    </a>
                  </Button>
                  <p className="text-xs text-muted-foreground mt-4">
                    ※公式LINEアカウントは管理者が設定する必要があります
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          // 連携済み状態
          <Tabs defaultValue="status" className="space-y-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="status">
                <Bot className="w-4 h-4 mr-2" />
                ステータス
              </TabsTrigger>
              <TabsTrigger value="settings">
                <Settings className="w-4 h-4 mr-2" />
                設定
              </TabsTrigger>
              <TabsTrigger value="history">
                <History className="w-4 h-4 mr-2" />
                履歴
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="status">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>LINE連携ステータス</CardTitle>
                    {getStatusBadge()}
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <p className="text-sm text-muted-foreground">LINE表示名</p>
                      <p className="font-medium">{connection.lineDisplayName || "未設定"}</p>
                    </div>
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <p className="text-sm text-muted-foreground">総メッセージ数</p>
                      <p className="font-medium">{connection.totalMessages}件</p>
                    </div>
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <p className="text-sm text-muted-foreground">連携日時</p>
                      <p className="font-medium">
                        {connection.connectedAt 
                          ? new Date(connection.connectedAt).toLocaleString("ja-JP")
                          : "未連携"}
                      </p>
                    </div>
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <p className="text-sm text-muted-foreground">最終メッセージ</p>
                      <p className="font-medium">
                        {connection.lastMessageAt 
                          ? new Date(connection.lastMessageAt).toLocaleString("ja-JP")
                          : "なし"}
                      </p>
                    </div>
                  </div>
                  
                  <Separator />
                  
                  <div className="flex gap-4">
                    <Button
                      variant={connection.status === "active" ? "secondary" : "default"}
                      onClick={handleToggleStatus}
                      disabled={toggleStatusMutation.isPending}
                    >
                      {connection.status === "active" ? (
                        <>
                          <Pause className="w-4 h-4 mr-2" />
                          一時停止
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-2" />
                          再開
                        </>
                      )}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDisconnect}
                      disabled={disconnectMutation.isPending}
                    >
                      <Unlink className="w-4 h-4 mr-2" />
                      連携解除
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="settings">
              <Card>
                <CardHeader>
                  <CardTitle>LINE連携設定</CardTitle>
                  <CardDescription>
                    LINE経由での分身AIの動作を設定します
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>通知を受信</Label>
                      <p className="text-sm text-muted-foreground">
                        分身AIからの通知をLINEで受け取る
                      </p>
                    </div>
                    <Switch
                      checked={settings?.receiveNotifications ?? true}
                      onCheckedChange={(checked) => 
                        updateSettingsMutation.mutate({ receiveNotifications: checked })
                      }
                    />
                  </div>
                  
                  <Separator />
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>ハートビート</Label>
                      <p className="text-sm text-muted-foreground">
                        定期的な接続確認メッセージを受け取る
                      </p>
                    </div>
                    <Switch
                      checked={settings?.receiveHeartbeat ?? true}
                      onCheckedChange={(checked) => 
                        updateSettingsMutation.mutate({ receiveHeartbeat: checked })
                      }
                    />
                  </div>
                  
                  <Separator />
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>音声メッセージ</Label>
                      <p className="text-sm text-muted-foreground">
                        音声メッセージの送受信を許可（将来機能）
                      </p>
                    </div>
                    <Switch
                      checked={settings?.allowVoiceMessages ?? true}
                      onCheckedChange={(checked) => 
                        updateSettingsMutation.mutate({ allowVoiceMessages: checked })
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="history">
              <Card>
                <CardHeader>
                  <CardTitle>メッセージ履歴</CardTitle>
                  <CardDescription>
                    LINE経由での会話履歴
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {messageHistory && messageHistory.length > 0 ? (
                    <div className="space-y-4 max-h-96 overflow-y-auto">
                      {messageHistory.map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex ${msg.direction === "outgoing" ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[80%] p-3 rounded-lg ${
                              msg.direction === "outgoing"
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted"
                            }`}
                          >
                            <p className="text-sm">{msg.content}</p>
                            <p className="text-xs opacity-70 mt-1">
                              {new Date(msg.createdAt).toLocaleString("ja-JP")}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <History className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>まだメッセージがありません</p>
                      <p className="text-sm">LINEから分身AIに話しかけてみましょう</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  );
}
