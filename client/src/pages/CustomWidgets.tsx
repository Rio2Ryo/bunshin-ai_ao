import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, LayoutGrid, Plus, Trash2, Share2, Eye, EyeOff, GripVertical, BarChart3, Calendar, FileText, Link2, StickyNote, Rss, Activity } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";

const WIDGET_TYPES = [
  { value: "kpi", label: "KPIカード", icon: Activity, description: "数値指標を表示" },
  { value: "chart", label: "チャート", icon: BarChart3, description: "グラフ・チャート表示" },
  { value: "query", label: "カスタムクエリ", icon: FileText, description: "データクエリ結果表示" },
  { value: "feed", label: "フィード", icon: Rss, description: "最新フィード表示" },
  { value: "calendar", label: "カレンダー", icon: Calendar, description: "予定・スケジュール表示" },
  { value: "notes", label: "メモ", icon: StickyNote, description: "テキストメモ" },
  { value: "links", label: "リンク集", icon: Link2, description: "クイックリンク" },
] as const;

export default function CustomWidgets() {
  usePageMeta({ title: "カスタムウィジェット", description: "ダッシュボードカスタマイズ", path: "/widgets" });
  const [createOpen, setCreateOpen] = useState(false);
  const [newType, setNewType] = useState("kpi");
  const [newTitle, setNewTitle] = useState("");

  const { data: widgets, refetch } = trpc.matching.listWidgets.useQuery();
  const createMut = trpc.matching.createWidget.useMutation({
    onSuccess: () => { refetch(); setCreateOpen(false); setNewTitle(""); toast.success("ウィジェットを作成しました"); },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.matching.updateWidget.useMutation({ onSuccess: () => refetch() });
  const deleteMut = trpc.matching.deleteWidget.useMutation({ onSuccess: () => { refetch(); toast.success("ウィジェットを削除しました"); } });
  const shareMut = trpc.matching.shareWidget.useMutation({
    onSuccess: (d) => { navigator.clipboard.writeText(d.shareCode); toast.success("共有コードをコピーしました: " + d.shareCode); refetch(); },
  });

  const visibleWidgets = (widgets ?? []).filter((w: any) => w.isVisible);
  const hiddenWidgets = (widgets ?? []).filter((w: any) => !w.isVisible);

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><LayoutGrid className="h-6 w-6" /> カスタムウィジェット</h1>
            <p className="text-muted-foreground text-sm mt-1">ダッシュボードに自由にウィジェットを追加・配置</p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" /> 新規作成</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>ウィジェット作成</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">タイプ</label>
                  <Select value={newType} onValueChange={setNewType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WIDGET_TYPES.map(wt => (
                        <SelectItem key={wt.value} value={wt.value}>
                          <span className="flex items-center gap-2"><wt.icon className="h-4 w-4" />{wt.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">{WIDGET_TYPES.find(w => w.value === newType)?.description}</p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">タイトル</label>
                  <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="ウィジェット名" />
                </div>
                <Button onClick={() => createMut.mutate({ widgetType: newType as any, title: newTitle })} disabled={!newTitle.trim() || createMut.isPending} className="w-full">
                  {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                  作成
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-primary">{(widgets ?? []).length}</div><div className="text-xs text-muted-foreground">合計ウィジェット</div></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-green-500">{visibleWidgets.length}</div><div className="text-xs text-muted-foreground">表示中</div></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-muted-foreground">{hiddenWidgets.length}</div><div className="text-xs text-muted-foreground">非表示</div></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-blue-500">{(widgets ?? []).filter((w: any) => w.isShared).length}</div><div className="text-xs text-muted-foreground">共有中</div></CardContent></Card>
        </div>

        {visibleWidgets.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">表示中のウィジェット</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleWidgets.map((w: any) => <WidgetCard key={w.id} widget={w} onToggle={() => updateMut.mutate({ widgetId: w.id, isVisible: false })} onDelete={() => deleteMut.mutate({ widgetId: w.id })} onShare={() => shareMut.mutate({ widgetId: w.id })} />)}
            </div>
          </div>
        )}

        {hiddenWidgets.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3 text-muted-foreground">非表示のウィジェット</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {hiddenWidgets.map((w: any) => <WidgetCard key={w.id} widget={w} onToggle={() => updateMut.mutate({ widgetId: w.id, isVisible: true })} onDelete={() => deleteMut.mutate({ widgetId: w.id })} onShare={() => shareMut.mutate({ widgetId: w.id })} />)}
            </div>
          </div>
        )}

        {(widgets ?? []).length === 0 && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">ウィジェットがまだありません。「新規作成」ボタンで追加しましょう。</CardContent></Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">ウィジェットテンプレート</CardTitle></CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {WIDGET_TYPES.map(wt => (
                <button key={wt.value} className="p-3 rounded-lg border hover:bg-muted/50 text-left transition-colors" onClick={() => { setNewType(wt.value); setNewTitle(wt.label); setCreateOpen(true); }}>
                  <div className="flex items-center gap-2 mb-1"><wt.icon className="h-4 w-4 text-primary" /><span className="text-sm font-medium">{wt.label}</span></div>
                  <p className="text-xs text-muted-foreground">{wt.description}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function WidgetCard({ widget, onToggle, onDelete, onShare }: { widget: any; onToggle: () => void; onDelete: () => void; onShare: () => void }) {
  const wt = WIDGET_TYPES.find(t => t.value === widget.widgetType);
  const Icon = wt?.icon || LayoutGrid;
  return (
    <Card className={!widget.isVisible ? "opacity-60" : ""}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
            <Icon className="h-5 w-5 text-primary" />
            <div>
              <div className="font-medium text-sm">{widget.title}</div>
              <div className="text-xs text-muted-foreground">{wt?.label || widget.widgetType}</div>
            </div>
          </div>
          {widget.isShared && <Badge variant="outline" className="text-xs">共有中</Badge>}
        </div>
        <div className="flex gap-1 mt-3">
          <Button variant="ghost" size="sm" onClick={onToggle}>{widget.isVisible ? <EyeOff className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}{widget.isVisible ? "非表示" : "表示"}</Button>
          <Button variant="ghost" size="sm" onClick={onShare}><Share2 className="h-3 w-3 mr-1" /> 共有</Button>
          <Button variant="ghost" size="sm" onClick={onDelete}><Trash2 className="h-3 w-3 mr-1 text-destructive" /> 削除</Button>
        </div>
      </CardContent>
    </Card>
  );
}
