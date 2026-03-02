import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, GitBranch, RotateCcw, Plus, ArrowLeftRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

export default function TwinVersionManager() {
  usePageMeta({ title: "バージョン管理", description: "ツインバージョン管理", path: "/versions" });
  const [label, setLabel] = useState("");
  const [compareA, setCompareA] = useState<number | null>(null);
  const [compareB, setCompareB] = useState<number | null>(null);

  const { data: versions, refetch } = trpc.myTwin.listVersions.useQuery();
  const { data: performance } = trpc.myTwin.getVersionPerformance.useQuery();
  const { data: comparisonData } = trpc.myTwin.compareVersions.useQuery(
    { versionIdA: compareA!, versionIdB: compareB! },
    { enabled: compareA != null && compareB != null }
  );
  const createMut = trpc.myTwin.createVersion.useMutation({
    onSuccess: (d) => { refetch(); setLabel(""); toast.success(`バージョン v${d.version} を作成しました`); },
    onError: (e) => toast.error(e.message),
  });
  const rollbackMut = trpc.myTwin.rollbackVersion.useMutation({
    onSuccess: (d) => { refetch(); toast.success(`v${d.version} にロールバックしました`); },
    onError: (e) => toast.error(e.message),
  });

  const perfData = (performance ?? []).map((p: any) => ({
    name: p.label || `v${p.version}`,
    avgScore: p.avgScore,
    matchCount: p.matchCount,
  }));

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><GitBranch className="h-6 w-6" /> ツインバージョン管理</h1>
            <p className="text-muted-foreground text-sm mt-1">人格パラメータの変更をバージョン管理</p>
          </div>
          <Badge variant="outline">{(versions ?? []).length}バージョン</Badge>
        </div>

        <Tabs defaultValue="timeline">
          <TabsList>
            <TabsTrigger value="timeline">タイムライン</TabsTrigger>
            <TabsTrigger value="compare">比較</TabsTrigger>
            <TabsTrigger value="performance">パフォーマンス</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="space-y-4 mt-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">現在の状態をスナップショット</CardTitle></CardHeader>
              <CardContent className="flex gap-2">
                <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="バージョンラベル（任意）" className="flex-1" />
                <Button onClick={() => createMut.mutate({ label: label || undefined })} disabled={createMut.isPending}>
                  {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                  保存
                </Button>
              </CardContent>
            </Card>

            <div className="space-y-3">
              {(versions ?? []).length === 0 && <p className="text-center text-muted-foreground py-8">バージョンがまだありません。「保存」で現在の状態を記録しましょう。</p>}
              {(versions ?? []).map((v: any, i: number) => (
                <Card key={v.id} className={i === 0 ? "border-primary/50" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">v{v.version}</div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{v.label}</span>
                            {i === 0 && <Badge variant="default" className="text-xs">最新</Badge>}
                          </div>
                          <span className="text-xs text-muted-foreground">{v.createdAt?.slice(0, 16)}</span>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {i > 0 && (
                          <Button variant="outline" size="sm" onClick={() => rollbackMut.mutate({ versionId: v.id })} disabled={rollbackMut.isPending}>
                            <RotateCcw className="h-3 w-3 mr-1" /> 復元
                          </Button>
                        )}
                      </div>
                    </div>
                    {v.diff && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {v.diff.personality && <Badge variant="outline" className="text-xs">人格変更</Badge>}
                        {v.diff.description && <Badge variant="outline" className="text-xs">説明変更</Badge>}
                        {v.diff.tags && <Badge variant="outline" className="text-xs">タグ変更</Badge>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="compare" className="space-y-4 mt-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><ArrowLeftRight className="h-4 w-4" /> バージョン比較</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">バージョンA</label>
                    <select className="w-full rounded-md border px-3 py-2 text-sm" value={compareA ?? ""} onChange={e => setCompareA(Number(e.target.value) || null)}>
                      <option value="">選択</option>
                      {(versions ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.label} (v{v.version})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">バージョンB</label>
                    <select className="w-full rounded-md border px-3 py-2 text-sm" value={compareB ?? ""} onChange={e => setCompareB(Number(e.target.value) || null)}>
                      <option value="">選択</option>
                      {(versions ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.label} (v{v.version})</option>)}
                    </select>
                  </div>
                </div>
                {comparisonData && (
                  <div className="grid md:grid-cols-2 gap-4 mt-4">
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">{comparisonData.versionA.label} (v{comparisonData.versionA.version})</CardTitle></CardHeader>
                      <CardContent className="text-xs space-y-1">
                        <p><span className="font-medium">人格:</span> {(comparisonData.versionA.personality || "").slice(0, 100)}</p>
                        <p><span className="font-medium">説明:</span> {(comparisonData.versionA.description || "").slice(0, 100)}</p>
                        <p><span className="font-medium">タグ:</span> {comparisonData.versionA.tags || "なし"}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">{comparisonData.versionB.label} (v{comparisonData.versionB.version})</CardTitle></CardHeader>
                      <CardContent className="text-xs space-y-1">
                        <p><span className="font-medium">人格:</span> {(comparisonData.versionB.personality || "").slice(0, 100)}</p>
                        <p><span className="font-medium">説明:</span> {(comparisonData.versionB.description || "").slice(0, 100)}</p>
                        <p><span className="font-medium">タグ:</span> {comparisonData.versionB.tags || "なし"}</p>
                      </CardContent>
                    </Card>
                    <Card className="md:col-span-2">
                      <CardContent className="p-4">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={comparisonData.diff.personality ? "destructive" : "outline"}>{comparisonData.diff.personality ? "人格: 変更あり" : "人格: 同一"}</Badge>
                          <Badge variant={comparisonData.diff.description ? "destructive" : "outline"}>{comparisonData.diff.description ? "説明: 変更あり" : "説明: 同一"}</Badge>
                          <Badge variant={comparisonData.diff.systemPrompt ? "destructive" : "outline"}>{comparisonData.diff.systemPrompt ? "プロンプト: 変更あり" : "プロンプト: 同一"}</Badge>
                          <Badge variant={comparisonData.diff.tags ? "destructive" : "outline"}>{comparisonData.diff.tags ? "タグ: 変更あり" : "タグ: 同一"}</Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="performance" className="space-y-4 mt-4">
            <Card>
              <CardHeader><CardTitle className="text-base">バージョン別パフォーマンス</CardTitle></CardHeader>
              <CardContent>
                {perfData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={perfData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="left" domain={[0, 100]} />
                      <YAxis yAxisId="right" orientation="right" />
                      <Tooltip />
                      <Legend />
                      <Bar yAxisId="left" dataKey="avgScore" name="平均スコア" fill="#6366f1" />
                      <Bar yAxisId="right" dataKey="matchCount" name="マッチング数" fill="#f59e0b" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="text-center text-muted-foreground py-8">パフォーマンスデータがありません</p>}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
