import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Archive, Download, RotateCcw, Loader2, FileJson, FileSpreadsheet } from "lucide-react";
import { useState } from "react";

export default function SessionArchive() {
  const [selected, setSelected] = useState<number[]>([]);

  const sessions = trpc.matching.sessions.useQuery();
  const archived = trpc.matching.archivedSessions.useQuery();
  const exportMutation = trpc.matching.bulkExport.useMutation();
  const archiveMutation = trpc.matching.archiveSessions.useMutation();
  const unarchiveMutation = trpc.matching.unarchiveSessions.useMutation();

  const completedSessions = (sessions.data || []).filter((s: any) => s.status === "completed");

  const toggleSelect = (id: number) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const selectAll = () => {
    if (selected.length === completedSessions.length) {
      setSelected([]);
    } else {
      setSelected(completedSessions.map((s: any) => s.id));
    }
  };

  const handleExport = async (format: "csv" | "json") => {
    if (selected.length === 0) { toast.error("セッションを選択してください"); return; }
    try {
      const result = await exportMutation.mutateAsync({ sessionIds: selected, format });
      const blob = new Blob([result.data], { type: format === "json" ? "application/json" : "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${selected.length}件をエクスポートしました`);
    } catch (e: any) { toast.error(e.message || "エクスポートに失敗しました"); }
  };

  const handleArchive = async () => {
    if (selected.length === 0) { toast.error("セッションを選択してください"); return; }
    try {
      await archiveMutation.mutateAsync({ sessionIds: selected });
      toast.success(`${selected.length}件をアーカイブしました`);
      setSelected([]);
      sessions.refetch();
      archived.refetch();
    } catch (e: any) { toast.error(e.message || "アーカイブに失敗しました"); }
  };

  const handleUnarchive = async (ids: number[]) => {
    try {
      await unarchiveMutation.mutateAsync({ sessionIds: ids });
      toast.success("アーカイブを解除しました");
      sessions.refetch();
      archived.refetch();
    } catch (e: any) { toast.error(e.message || "解除に失敗しました"); }
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-4 max-w-4xl space-y-6">
        <div className="flex items-center gap-2">
          <Archive className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">エクスポート＆アーカイブ</h1>
        </div>

        {/* Active sessions */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">完了済みセッション ({completedSessions.length}件)</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={selectAll}>
                  {selected.length === completedSessions.length ? "選択解除" : "すべて選択"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {completedSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">完了セッションがありません</p>
            ) : (
              completedSessions.map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                  <Checkbox checked={selected.includes(s.id)} onCheckedChange={() => toggleSelect(s.id)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{s.theme}</p>
                    <p className="text-xs text-muted-foreground">{s.createdAt?.split('T')[0]}</p>
                  </div>
                  {s.compatibilityScore != null && (
                    <Badge variant="secondary" className="text-xs">{s.compatibilityScore}点</Badge>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Action buttons */}
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{selected.length}件選択中</Badge>
            <Button size="sm" onClick={() => handleExport("json")} disabled={exportMutation.isPending}>
              <FileJson className="h-4 w-4 mr-1" />JSON
            </Button>
            <Button size="sm" onClick={() => handleExport("csv")} disabled={exportMutation.isPending}>
              <FileSpreadsheet className="h-4 w-4 mr-1" />CSV
            </Button>
            <Button size="sm" variant="outline" onClick={handleArchive} disabled={archiveMutation.isPending}>
              {archiveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Archive className="h-4 w-4 mr-1" />}
              アーカイブ
            </Button>
          </div>
        )}

        {/* Archived sessions */}
        {(archived.data || []).length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-muted-foreground">アーカイブ済み ({(archived.data || []).length}件)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(archived.data || []).map((s: any) => (
                <div key={s.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate text-muted-foreground">{s.theme}</p>
                    <p className="text-xs text-muted-foreground">{s.createdAt?.split('T')[0]}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => handleUnarchive([s.id])}>
                    <RotateCcw className="h-3 w-3 mr-1" />復元
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
