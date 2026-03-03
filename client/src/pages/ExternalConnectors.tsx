import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Plug, Plus, RefreshCw, Trash2, Loader2, Calendar, BookOpen, MessageSquare, GitBranch, Settings, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const t = trpc as any;

const SERVICE_ICONS: Record<string, LucideIcon> = {
  google_calendar: Calendar, notion: BookOpen, slack: MessageSquare, github: GitBranch, custom: Settings,
};
const SERVICE_LABELS: Record<string, string> = {
  google_calendar: "Google Calendar", notion: "Notion", slack: "Slack", github: "GitHub", custom: "カスタム",
};
const SCHEDULE_LABELS: Record<string, string> = { manual: "手動", daily: "日次", weekly: "週次" };

export default function ExternalConnectors() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newServiceType, setNewServiceType] = useState<string>("notion");
  const [newServiceName, setNewServiceName] = useState("");
  const [newSchedule, setNewSchedule] = useState<string>("manual");
  const [selectedConnectorId, setSelectedConnectorId] = useState<number | null>(null);

  const connectors = t.myTwin.listConnectors.useQuery();
  const syncLogs = t.myTwin.getConnectorSyncLogs.useQuery(
    { connectorId: selectedConnectorId! },
    { enabled: !!selectedConnectorId }
  );
  const createMutation = t.myTwin.createConnector.useMutation();
  const syncMutation = t.myTwin.syncConnector.useMutation();
  const deleteMutation = t.myTwin.deleteConnector.useMutation();
  const updateMutation = t.myTwin.updateConnector.useMutation();

  const handleCreate = async () => {
    if (!newServiceName.trim()) { toast.error("サービス名を入力してください"); return; }
    try {
      await createMutation.mutateAsync({
        serviceType: newServiceType as any,
        serviceName: newServiceName.trim(),
        syncSchedule: newSchedule as any,
      });
      toast.success("コネクターを作成しました");
      setDialogOpen(false);
      setNewServiceName("");
      connectors.refetch();
    } catch (e: any) { toast.error(e.message || "作成に失敗しました"); }
  };

  const handleSync = async (connectorId: number) => {
    try {
      const result = await syncMutation.mutateAsync({ connectorId });
      if (result.status === "success") {
        toast.success(`同期完了: ${result.itemsAdded}件追加`);
      } else {
        toast.error(result.error || "同期中にエラーが発生しました");
      }
      connectors.refetch();
      if (selectedConnectorId === connectorId) syncLogs.refetch();
    } catch (e: any) { toast.error(e.message || "同期に失敗しました"); }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ connectorId: id });
      toast.success("コネクターを削除しました");
      if (selectedConnectorId === id) setSelectedConnectorId(null);
      connectors.refetch();
    } catch (e: any) { toast.error(e.message || "削除に失敗しました"); }
  };

  const handleToggleStatus = async (connector: any) => {
    try {
      await updateMutation.mutateAsync({
        connectorId: connector.id,
        status: connector.status === "active" ? "paused" : "active",
      });
      connectors.refetch();
    } catch (e: any) { toast.error(e.message || "更新に失敗しました"); }
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Plug className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">外部データコネクター</h1>
              <p className="text-sm text-muted-foreground">外部サービスからデータを取得しナレッジベースに自動同期</p>
            </div>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />コネクター追加</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>新しいコネクターを追加</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>サービスタイプ</Label>
                  <Select value={newServiceType} onValueChange={setNewServiceType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(SERVICE_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>サービス名</Label>
                  <Input value={newServiceName} onChange={(e) => setNewServiceName(e.target.value)} placeholder="例: 営業チームSlack" />
                </div>
                <div>
                  <Label>同期スケジュール</Label>
                  <Select value={newSchedule} onValueChange={setNewSchedule}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">手動</SelectItem>
                      <SelectItem value="daily">日次</SelectItem>
                      <SelectItem value="weekly">週次</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleCreate} disabled={createMutation.isPending} className="w-full">
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}作成
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="manage">
          <TabsList>
            <TabsTrigger value="manage">コネクター管理</TabsTrigger>
            <TabsTrigger value="sync">同期実行</TabsTrigger>
            <TabsTrigger value="logs">同期ログ</TabsTrigger>
          </TabsList>

          <TabsContent value="manage" className="space-y-4 mt-4">
            {(connectors.data || []).length === 0 && (
              <p className="text-center text-muted-foreground py-8">コネクターがまだありません。「コネクター追加」ボタンから作成してください。</p>
            )}
            {(connectors.data || []).map((c: any) => {
              const Icon = SERVICE_ICONS[c.serviceType] || Settings;
              return (
                <Card key={c.id}>
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{c.serviceName}</p>
                      <p className="text-sm text-muted-foreground">{SERVICE_LABELS[c.serviceType]} • {SCHEDULE_LABELS[c.syncSchedule]}</p>
                      {c.lastSyncAt && <p className="text-xs text-muted-foreground">最終同期: {new Date(c.lastSyncAt).toLocaleString("ja-JP")}</p>}
                    </div>
                    <Badge variant={c.status === "active" ? "default" : c.status === "error" ? "destructive" : "secondary"}>
                      {c.status === "active" ? "有効" : c.status === "error" ? "エラー" : "停止中"}
                    </Badge>
                    <Button variant="ghost" size="sm" onClick={() => handleToggleStatus(c)}>
                      {c.status === "active" ? "停止" : "有効化"}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="sync" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>同期を実行</CardTitle>
                <CardDescription>コネクターを選択して同期を実行します。データはナレッジベースに自動追加されます。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(connectors.data || []).filter((c: any) => c.status === "active").map((c: any) => {
                  const Icon = SERVICE_ICONS[c.serviceType] || Settings;
                  return (
                    <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg border">
                      <Icon className="h-5 w-5 text-primary" />
                      <div className="flex-1">
                        <p className="font-medium text-sm">{c.serviceName}</p>
                        <p className="text-xs text-muted-foreground">{SERVICE_LABELS[c.serviceType]}</p>
                      </div>
                      <Button size="sm" onClick={() => { setSelectedConnectorId(c.id); handleSync(c.id); }} disabled={syncMutation.isPending}>
                        {syncMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                        同期
                      </Button>
                    </div>
                  );
                })}
                {(connectors.data || []).filter((c: any) => c.status === "active").length === 0 && (
                  <p className="text-center text-muted-foreground py-4">有効なコネクターがありません</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>コネクター選択</CardTitle>
              </CardHeader>
              <CardContent>
                <Select value={selectedConnectorId ? String(selectedConnectorId) : ""} onValueChange={(v) => setSelectedConnectorId(Number(v))}>
                  <SelectTrigger><SelectValue placeholder="コネクターを選択" /></SelectTrigger>
                  <SelectContent>
                    {(connectors.data || []).map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.serviceName} ({SERVICE_LABELS[c.serviceType]})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {selectedConnectorId && (syncLogs.data || []).length === 0 && (
              <p className="text-center text-muted-foreground py-4">同期ログがまだありません</p>
            )}
            {(syncLogs.data || []).map((log: any) => (
              <Card key={log.id}>
                <CardContent className="flex items-center gap-4 p-4">
                  {log.status === "success" ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : log.status === "partial" ? <AlertTriangle className="h-5 w-5 text-amber-500" /> : <XCircle className="h-5 w-5 text-red-500" />}
                  <div className="flex-1">
                    <p className="font-medium text-sm">{log.itemsSynced}件同期 / {log.itemsAdded}件追加</p>
                    <p className="text-xs text-muted-foreground">{new Date(log.syncedAt).toLocaleString("ja-JP")}</p>
                    {log.errorMessage && <p className="text-xs text-red-500 mt-1">{log.errorMessage}</p>}
                  </div>
                  <Badge variant={log.status === "success" ? "default" : log.status === "partial" ? "secondary" : "destructive"}>
                    {log.status === "success" ? "成功" : log.status === "partial" ? "部分成功" : "エラー"}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
