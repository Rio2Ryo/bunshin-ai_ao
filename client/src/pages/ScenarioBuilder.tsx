import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Plus, Loader2, Star, ShoppingCart, Upload, Trash2, BookOpen } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function ScenarioBuilder() {
  const { data: categories } = trpc.scenario.categories.useQuery();
  const { data: myScenarios, isLoading: myLoading } = trpc.scenario.list.useQuery({ onlyMine: true });
  const [selectedCat, setSelectedCat] = useState<string | undefined>();
  const { data: published, isLoading: pubLoading } = trpc.scenario.list.useQuery({ category: selectedCat });
  const utils = trpc.useUtils();

  const createMut = trpc.scenario.create.useMutation({ onSuccess: () => { utils.scenario.list.invalidate(); toast.success("シナリオを作成しました"); setCreateOpen(false); } });
  const publishMut = trpc.scenario.publish.useMutation({ onSuccess: () => { utils.scenario.list.invalidate(); toast.success("公開しました"); } });
  const deleteMut = trpc.scenario.delete.useMutation({ onSuccess: () => { utils.scenario.list.invalidate(); } });
  const purchaseMut = trpc.scenario.purchase.useMutation({ onSuccess: (d) => { utils.scenario.list.invalidate(); toast.success(`購入しました${d.pointsSpent > 0 ? ` (${d.pointsSpent}pt)` : ""}`); } });
  const _reviewMut = trpc.scenario.review.useMutation({ onSuccess: () => { utils.scenario.list.invalidate(); toast.success("レビューを投稿しました"); } });

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [cat, setCat] = useState("general");
  const [prompt, setPrompt] = useState("");
  const [analysisPrompt, setAnalysisPrompt] = useState("");
  const [turns, setTurns] = useState("5");
  const [tags, setTags] = useState("");
  const [price, setPrice] = useState("0");

  const handleCreate = () => {
    createMut.mutate({
      title, description: desc, category: cat,
      systemPromptTemplate: prompt,
      analysisPromptTemplate: analysisPrompt || undefined,
      turnCount: parseInt(turns) || 5,
      tags: tags.split(",").map(t => t.trim()).filter(Boolean),
      price: parseInt(price) || 0,
    });
  };

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6" />シナリオビルダー</h1>
            <p className="text-muted-foreground">カスタムマッチングシナリオを作成・共有</p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />新規作成</Button></DialogTrigger>
            <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
              <DialogHeader><DialogTitle>シナリオ作成</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Input placeholder="シナリオタイトル" value={title} onChange={e => setTitle(e.target.value)} />
                <Textarea placeholder="説明" value={desc} onChange={e => setDesc(e.target.value)} rows={2} />
                <Select value={cat} onValueChange={setCat}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div>
                  <label className="text-sm font-medium">対話プロンプトテンプレート</label>
                  <Textarea placeholder="ツインに与える指示テンプレート。{{theme}}でテーマ、{{speaker}}で発言者名に置換されます" value={prompt} onChange={e => setPrompt(e.target.value)} rows={4} />
                </div>
                <div>
                  <label className="text-sm font-medium">分析プロンプト（任意）</label>
                  <Textarea placeholder="対話後の分析プロンプト" value={analysisPrompt} onChange={e => setAnalysisPrompt(e.target.value)} rows={3} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-sm font-medium">ターン数</label>
                    <Input type="number" value={turns} onChange={e => setTurns(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">タグ (カンマ区切り)</label>
                    <Input value={tags} onChange={e => setTags(e.target.value)} placeholder="交渉,営業" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">価格 (pt)</label>
                    <Input type="number" value={price} onChange={e => setPrice(e.target.value)} />
                  </div>
                </div>
                <Button className="w-full" onClick={handleCreate} disabled={!title || !prompt || createMut.isPending}>
                  {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}作成
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="marketplace">
          <TabsList>
            <TabsTrigger value="marketplace">マーケットプレイス</TabsTrigger>
            <TabsTrigger value="mine">マイシナリオ ({myScenarios?.length ?? 0})</TabsTrigger>
          </TabsList>

          <TabsContent value="marketplace" className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              <Button variant={!selectedCat ? "default" : "outline"} size="sm" onClick={() => setSelectedCat(undefined)}>全て</Button>
              {categories?.map((c: any) => (
                <Button key={c.id} variant={selectedCat === c.id ? "default" : "outline"} size="sm" onClick={() => setSelectedCat(c.id)}>{c.name}</Button>
              ))}
            </div>
            {pubLoading ? <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : (
              <div className="grid gap-4 md:grid-cols-2">
                {published?.map((s: any) => (
                  <Card key={s.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{s.title}</CardTitle>
                        <div className="flex items-center gap-1">
                          {s.rating > 0 && <span className="flex items-center text-xs text-yellow-500"><Star className="h-3 w-3 mr-0.5" />{s.rating.toFixed(1)}</span>}
                          {s.price > 0 ? <Badge>{s.price}pt</Badge> : <Badge variant="secondary">無料</Badge>}
                        </div>
                      </div>
                      {s.description && <CardDescription className="line-clamp-2">{s.description}</CardDescription>}
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between">
                        <div className="flex gap-1 flex-wrap">
                          {s.tags?.map((t: string) => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}
                          <Badge variant="outline" className="text-xs">{s.turnCount}ターン</Badge>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => purchaseMut.mutate({ scenarioId: s.id })} disabled={purchaseMut.isPending}>
                            <ShoppingCart className="h-3 w-3 mr-1" />{s.price > 0 ? "購入" : "取得"}
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">by {s.creatorName} | {s.usageCount}回使用</p>
                    </CardContent>
                  </Card>
                ))}
                {!published?.length && <Card><CardContent className="py-8 text-center text-muted-foreground">シナリオがありません</CardContent></Card>}
              </div>
            )}
          </TabsContent>

          <TabsContent value="mine" className="space-y-4">
            {myLoading ? <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : (
              <div className="space-y-3">
                {myScenarios?.map((s: any) => (
                  <Card key={s.id}>
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{s.title}</p>
                          <p className="text-xs text-muted-foreground">{s.category} | {s.turnCount}ターン | {s.usageCount}回使用</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={s.isPublished ? "default" : "secondary"}>{s.isPublished ? "公開中" : "非公開"}</Badge>
                          {!s.isPublished && (
                            <Button size="sm" variant="outline" onClick={() => publishMut.mutate({ id: s.id })}><Upload className="h-3 w-3 mr-1" />公開</Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => deleteMut.mutate({ id: s.id })}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {!myScenarios?.length && <Card><CardContent className="py-8 text-center text-muted-foreground">まだシナリオを作成していません</CardContent></Card>}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
