import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import {
  Bell, Loader2, CheckCircle, MessageSquare, Mail, Smartphone,
  Globe, Zap, Settings, Filter, Inbox, BellRing,
} from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  matching_complete: "マッチング完了",
  matching_invite: "マッチング招待",
  friend_request: "友達リクエスト",
  matching_request: "マッチングリクエスト",
  system: "システム",
};

export default function NotificationDashboard() {
  usePageMeta({ title: "通知管理", description: "通知設定と通知履歴", path: "/notifications" });
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);

  const { data: channels, isLoading: loadingChannels } = trpc.notification.channelStatus.useQuery();
  const { data: history, isLoading: loadingHistory, refetch } = trpc.notification.history.useQuery({ type: typeFilter, limit: 50 });
  const updateMut = trpc.notification.updateSettings.useMutation();
  const markAllMut = trpc.notification.markAllRead.useMutation();
  const markMut = trpc.notification.markRead.useMutation();

  const handleToggle = async (field: string, value: boolean) => {
    try {
      await updateMut.mutateAsync({ [field]: value ? 1 : 0 } as any);
      toast.success("設定を更新しました");
    } catch { toast.error("設定の更新に失敗しました"); }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllMut.mutateAsync();
      refetch();
      toast.success("すべて既読にしました");
    } catch { /* ignore */ }
  };

  const handleMarkRead = async (id: number) => {
    try {
      await markMut.mutateAsync({ id });
      refetch();
    } catch { /* ignore */ }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bell className="h-6 w-6 text-primary" />
              通知管理
            </h1>
            <p className="text-muted-foreground">通知チャネル設定と通知履歴</p>
          </div>
          {(history?.unreadCount ?? 0) > 0 && (
            <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
              <CheckCircle className="h-4 w-4 mr-2" />
              すべて既読 ({history?.unreadCount})
            </Button>
          )}
        </div>

        <Tabs defaultValue="settings">
          <TabsList>
            <TabsTrigger value="settings">
              <Settings className="h-4 w-4 mr-2" />設定
            </TabsTrigger>
            <TabsTrigger value="history">
              <Inbox className="h-4 w-4 mr-2" />履歴
              {(history?.unreadCount ?? 0) > 0 && (
                <Badge variant="destructive" className="ml-2 h-5 w-5 p-0 flex items-center justify-center text-xs">
                  {history?.unreadCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-4">
            {/* Channel Status Cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { key: "inApp", label: "アプリ内", icon: BellRing, active: channels?.inApp },
                { key: "slack", label: "Slack", icon: MessageSquare, active: channels?.slack },
                { key: "line", label: "LINE", icon: Smartphone, active: channels?.line },
                { key: "webPush", label: "WebPush", icon: Zap, active: channels?.webPush },
                { key: "email", label: "メール", icon: Mail, active: channels?.email },
              ].map(({ key, label, icon: Icon, active }) => (
                <Card key={key} className={active ? "border-green-500/50" : "border-muted"}>
                  <CardContent className="pt-4 text-center">
                    <Icon className={`h-6 w-6 mx-auto mb-2 ${active ? "text-green-500" : "text-muted-foreground"}`} />
                    <p className="text-sm font-medium">{label}</p>
                    <Badge variant={active ? "default" : "secondary"} className="mt-1 text-xs">
                      {active ? "有効" : "無効"}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Toggle settings */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">通知イベント設定</CardTitle>
                <CardDescription>どのイベントで通知を受け取るか設定</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {loadingChannels ? (
                  <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <Label>LINE通知</Label>
                      <Switch
                        checked={channels?.settings?.lineNotify === 1}
                        onCheckedChange={(v) => handleToggle("lineNotify", v)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label>メール通知</Label>
                      <Switch
                        checked={channels?.settings?.emailNotify === 1}
                        onCheckedChange={(v) => handleToggle("emailNotify", v)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label>マッチング完了通知</Label>
                      <Switch
                        checked={channels?.settings?.matchingComplete === 1}
                        onCheckedChange={(v) => handleToggle("matchingComplete", v)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label>スケジュール通知</Label>
                      <Switch
                        checked={channels?.settings?.scheduledMatching === 1}
                        onCheckedChange={(v) => handleToggle("scheduledMatching", v)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Slack Webhook URL</Label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="https://hooks.slack.com/..."
                          defaultValue={channels?.settings?.slackWebhookUrl || ""}
                          id="slack-url"
                        />
                        <Button size="sm" onClick={() => {
                          const val = (document.getElementById("slack-url") as HTMLInputElement)?.value;
                          updateMut.mutate({ slackWebhookUrl: val || null });
                        }}>保存</Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4">
            {/* Type filter */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant={typeFilter === undefined ? "default" : "outline"}
                size="sm"
                onClick={() => { setTypeFilter(undefined); }}
              >
                すべて
              </Button>
              {(history?.typeCounts ?? []).map((tc: any) => (
                <Button
                  key={tc.type}
                  variant={typeFilter === tc.type ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTypeFilter(tc.type)}
                >
                  {TYPE_LABELS[tc.type] || tc.type} ({tc.count})
                </Button>
              ))}
            </div>

            {loadingHistory ? (
              <Loader2 className="h-8 w-8 animate-spin mx-auto" />
            ) : (history?.items?.length ?? 0) > 0 ? (
              <div className="space-y-2">
                {history!.items.map((n: any) => (
                  <Card key={n.id} className={n.isRead ? "opacity-70" : "border-primary/30"}>
                    <CardContent className="py-3 flex items-center gap-3">
                      <Bell className={`h-4 w-4 shrink-0 ${n.isRead ? "text-muted-foreground" : "text-primary"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{n.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{n.message}</p>
                        <p className="text-xs text-muted-foreground">{n.createdAt?.slice(0, 16).replace("T", " ")}</p>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">{TYPE_LABELS[n.type] || n.type}</Badge>
                      {!n.isRead && (
                        <Button variant="ghost" size="sm" onClick={() => handleMarkRead(n.id)}>既読</Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <Bell className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">通知はまだありません</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
