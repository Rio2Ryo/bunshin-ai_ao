import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Brain, Pin, PinOff, Trash2, RefreshCw, Search, Star, MessageSquare, Zap, ThumbsUp } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";

const SOURCE_LABELS: Record<string, string> = { matching: "マッチング", chat: "チャット", feedback: "フィードバック" };
const SOURCE_ICONS: Record<string, typeof Zap> = { matching: Zap, chat: MessageSquare, feedback: ThumbsUp };

export default function TwinMemoryBank() {
  usePageMeta({ title: "メモリーバンク", description: "ツインの記憶を管理", path: "/memory-bank" });
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);

  const { data: memories, refetch } = trpc.myTwin.listMemories.useQuery(
    { pinnedOnly: pinnedOnly || undefined, sourceType: filter !== "all" ? filter : undefined }
  );
  const collectMut = trpc.myTwin.collectMemories.useMutation({
    onSuccess: (d) => { refetch(); toast.success(`${d.added}件の新しい記憶を収集しました（合計${d.total}件）`); },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.myTwin.updateMemory.useMutation({ onSuccess: () => refetch() });
  const deleteMut = trpc.myTwin.deleteMemory.useMutation({ onSuccess: () => { refetch(); toast.success("記憶を削除しました"); } });

  const filtered = (memories ?? []).filter((m: any) => {
    if (!search) return true;
    return m.title?.toLowerCase().includes(search.toLowerCase()) || m.summary?.toLowerCase().includes(search.toLowerCase());
  });

  const pinnedCount = (memories ?? []).filter((m: any) => m.isPinned).length;
  const totalCount = memories?.length ?? 0;

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Brain className="h-6 w-6" /> メモリーバンク</h1>
            <p className="text-muted-foreground text-sm mt-1">ツインの学習した記憶を閲覧・編集</p>
          </div>
          <Button onClick={() => collectMut.mutate()} disabled={collectMut.isPending}>
            {collectMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            記憶を収集
          </Button>
        </div>

        {collectMut.data?.autoSummary && (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-2"><CardTitle className="text-base">AI自動要約</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm">{collectMut.data.autoSummary.summary}</p>
              {collectMut.data.autoSummary.traits?.length > 0 && (
                <div className="flex flex-wrap gap-1">{collectMut.data.autoSummary.traits.map((t: string, i: number) => <Badge key={i} variant="secondary">{t}</Badge>)}</div>
              )}
              {collectMut.data.autoSummary.preferences?.length > 0 && (
                <div className="flex flex-wrap gap-1">{collectMut.data.autoSummary.preferences.map((p: string, i: number) => <Badge key={i} variant="outline">{p}</Badge>)}</div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-3 gap-4">
          <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-primary">{totalCount}</div><div className="text-xs text-muted-foreground">合計記憶</div></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-yellow-500">{pinnedCount}</div><div className="text-xs text-muted-foreground">ピン留め</div></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-primary">{Object.keys(SOURCE_LABELS).filter(k => (memories ?? []).some((m: any) => m.sourceType === k)).length}</div><div className="text-xs text-muted-foreground">ソースタイプ</div></CardContent></Card>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="記憶を検索..." className="pl-10" />
          </div>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全て</SelectItem>
              <SelectItem value="matching">マッチング</SelectItem>
              <SelectItem value="chat">チャット</SelectItem>
              <SelectItem value="feedback">フィードバック</SelectItem>
            </SelectContent>
          </Select>
          <Button variant={pinnedOnly ? "default" : "outline"} size="sm" onClick={() => setPinnedOnly(!pinnedOnly)}>
            <Pin className="h-4 w-4 mr-1" /> ピンのみ
          </Button>
        </div>

        <div className="space-y-3">
          {filtered.length === 0 && <p className="text-center text-muted-foreground py-8">記憶がありません。「記憶を収集」ボタンで過去のデータから学習させましょう。</p>}
          {filtered.map((m: any) => {
            const Icon = SOURCE_ICONS[m.sourceType] || Brain;
            return (
              <Card key={m.id} className={m.isPinned ? "border-yellow-500/50" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="mt-1"><Icon className="h-5 w-5 text-primary" /></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate">{m.title}</span>
                          <Badge variant="outline" className="text-xs">{SOURCE_LABELS[m.sourceType] || m.sourceType}</Badge>
                          {m.isPinned ? <Pin className="h-3 w-3 text-yellow-500" /> : null}
                          <div className="flex items-center gap-0.5">{Array.from({ length: Math.min(m.importance || 0, 10) }, (_, i) => <Star key={i} className="h-2.5 w-2.5 text-yellow-400 fill-yellow-400" />)}</div>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{m.summary}</p>
                        {m.tags?.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{m.tags.map((t: string, i: number) => <Badge key={i} variant="secondary" className="text-xs">{t}</Badge>)}</div>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => updateMut.mutate({ memoryId: m.id, isPinned: !m.isPinned })}>
                        {m.isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteMut.mutate({ memoryId: m.id })}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
}
