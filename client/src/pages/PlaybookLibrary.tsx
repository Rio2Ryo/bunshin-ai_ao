import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, BookOpen, Share2, Trash2, Plus, CheckCircle, XCircle, MessageSquare, Lightbulb } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";

const CATEGORIES = [
  { value: "sales", label: "営業・商談" },
  { value: "recruiting", label: "採用面接" },
  { value: "investor", label: "投資家ピッチ" },
  { value: "tech_alliance", label: "技術提携" },
  { value: "partnership", label: "パートナーシップ" },
  { value: "general", label: "一般ビジネス" },
] as const;

export default function PlaybookLibrary() {
  usePageMeta({ title: "プレイブック", description: "AIマッチングコーチング・プレイブック", path: "/playbooks" });
  const [category, setCategory] = useState<string>("sales");
  const [customContext, setCustomContext] = useState("");
  const [activeTab, setActiveTab] = useState("library");

  const { data: playbooks, refetch } = trpc.matching.listPlaybooks.useQuery();
  const generateMut = trpc.matching.generatePlaybook.useMutation({
    onSuccess: () => { refetch(); toast.success("プレイブックを生成しました"); setActiveTab("library"); },
    onError: (e) => toast.error(e.message),
  });
  const shareMut = trpc.matching.sharePlaybook.useMutation({
    onSuccess: (d) => { navigator.clipboard.writeText(d.shareCode); toast.success("共有コードをコピーしました: " + d.shareCode); refetch(); },
  });
  const deleteMut = trpc.matching.deletePlaybook.useMutation({
    onSuccess: () => { refetch(); toast.success("削除しました"); },
  });

  const myPlaybooks = playbooks?.filter((p: any) => !p.isShared || p.userId) ?? [];
  const sharedPlaybooks = playbooks?.filter((p: any) => p.isShared) ?? [];

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6" /> プレイブック</h1>
            <p className="text-muted-foreground text-sm mt-1">業種・シーン別のベストプラクティス集</p>
          </div>
          <Badge variant="outline">{playbooks?.length ?? 0}件</Badge>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="library">ライブラリ</TabsTrigger>
            <TabsTrigger value="generate">新規生成</TabsTrigger>
            <TabsTrigger value="shared">共有</TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-4 mt-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">プレイブック生成</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">カテゴリ</label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">追加コンテキスト（任意）</label>
                  <Textarea value={customContext} onChange={e => setCustomContext(e.target.value)} placeholder="例: IT業界のSaaS営業向け" rows={3} />
                </div>
                <Button onClick={() => generateMut.mutate({ category: category as any, customContext: customContext || undefined })} disabled={generateMut.isPending} className="w-full">
                  {generateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                  AI生成
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="library" className="space-y-4 mt-4">
            {myPlaybooks.length === 0 && <p className="text-center text-muted-foreground py-8">プレイブックがまだありません。「新規生成」タブで作成しましょう。</p>}
            {myPlaybooks.map((pb: any) => <PlaybookCard key={pb.id} playbook={pb} onShare={(id: number) => shareMut.mutate({ playbookId: id })} onDelete={(id: number) => deleteMut.mutate({ playbookId: id })} />)}
          </TabsContent>

          <TabsContent value="shared" className="space-y-4 mt-4">
            {sharedPlaybooks.length === 0 && <p className="text-center text-muted-foreground py-8">共有プレイブックはまだありません。</p>}
            {sharedPlaybooks.map((pb: any) => <PlaybookCard key={pb.id} playbook={pb} />)}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function PlaybookCard({ playbook, onShare, onDelete }: { playbook: any; onShare?: (id: number) => void; onDelete?: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const content = playbook.content || {};
  const categoryLabel = CATEGORIES.find(c => c.value === playbook.category)?.label ?? playbook.category;

  return (
    <Card>
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">{playbook.title || "プレイブック"}</CardTitle>
            <Badge variant="secondary">{categoryLabel}</Badge>
            {playbook.isShared ? <Badge variant="outline" className="text-xs">共有中</Badge> : null}
          </div>
          <div className="flex gap-1">
            {onShare && <Button variant="ghost" size="icon" onClick={e => { e.stopPropagation(); onShare(playbook.id); }}><Share2 className="h-4 w-4" /></Button>}
            {onDelete && <Button variant="ghost" size="icon" onClick={e => { e.stopPropagation(); onDelete(playbook.id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-4">
          {content.sections?.map((s: any, i: number) => (
            <div key={i} className="space-y-1">
              <h4 className="font-semibold text-sm">{s.heading}</h4>
              <p className="text-sm text-muted-foreground">{s.content}</p>
              {s.tips?.length > 0 && <ul className="list-disc ml-4 text-xs text-muted-foreground">{s.tips.map((t: string, j: number) => <li key={j}>{t}</li>)}</ul>}
            </div>
          ))}
          {content.doList?.length > 0 && (
            <div>
              <h4 className="font-semibold text-sm flex items-center gap-1"><CheckCircle className="h-4 w-4 text-green-500" /> すべきこと</h4>
              <ul className="list-disc ml-4 text-sm text-muted-foreground">{content.doList.map((d: string, i: number) => <li key={i}>{d}</li>)}</ul>
            </div>
          )}
          {content.dontList?.length > 0 && (
            <div>
              <h4 className="font-semibold text-sm flex items-center gap-1"><XCircle className="h-4 w-4 text-red-500" /> 避けるべきこと</h4>
              <ul className="list-disc ml-4 text-sm text-muted-foreground">{content.dontList.map((d: string, i: number) => <li key={i}>{d}</li>)}</ul>
            </div>
          )}
          {content.openingLines?.length > 0 && (
            <div>
              <h4 className="font-semibold text-sm flex items-center gap-1"><MessageSquare className="h-4 w-4" /> 冒頭フレーズ</h4>
              <div className="flex flex-wrap gap-2 mt-1">{content.openingLines.map((l: string, i: number) => <Badge key={i} variant="outline" className="text-xs">{l}</Badge>)}</div>
            </div>
          )}
          {content.customTips?.length > 0 && (
            <div>
              <h4 className="font-semibold text-sm flex items-center gap-1"><Lightbulb className="h-4 w-4 text-yellow-500" /> カスタムヒント</h4>
              <ul className="list-disc ml-4 text-sm text-muted-foreground">{content.customTips.map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
