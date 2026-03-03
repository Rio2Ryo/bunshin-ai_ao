import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { SlidersHorizontal, Save, Eye, Loader2, Trash2, Check, FlaskRound } from "lucide-react";
import { toast } from "sonner";

const AXES = [
  { key: "empathy", label: "共感度", desc: "相手の感情に寄り添う度合い" },
  { key: "aggression", label: "攻撃性", desc: "主張の強さ・押しの強さ" },
  { key: "optimism", label: "楽観度", desc: "ポジティブ・前向きな姿勢" },
  { key: "caution", label: "慎重さ", desc: "リスク回避・慎重な判断" },
  { key: "humor", label: "ユーモア度", desc: "軽やかさ・遊び心" },
] as const;

type Params = { empathy: number; aggression: number; optimism: number; caution: number; humor: number };

export default function EmotionCalibration() {
  const [tab, setTab] = useState("calibrate");
  const [params, setParams] = useState<Params>({ empathy: 50, aggression: 20, optimism: 60, caution: 50, humor: 40 });
  const [presetName, setPresetName] = useState("");
  const [samplePrompt, setSamplePrompt] = useState("");
  const [abPrompt, setAbPrompt] = useState("新しいプロジェクトの提案について意見を聞かせてください。");
  const [abIds, setAbIds] = useState<[number | null, number | null]>([null, null]);

  const calibrations = trpc.myTwin.getEmotionCalibration.useQuery();
  const saveMutation = trpc.myTwin.saveEmotionCalibration.useMutation();
  const previewMutation = trpc.myTwin.previewEmotionCalibration.useMutation();
  const deleteMutation = trpc.myTwin.deleteEmotionCalibration.useMutation();
  const applyMutation = trpc.myTwin.applyEmotionCalibration.useMutation();
  const previewA = trpc.myTwin.previewEmotionCalibration.useMutation();
  const previewB = trpc.myTwin.previewEmotionCalibration.useMutation();
  const utils = trpc.useUtils();

  const handleSlider = (key: string, value: number[]) => setParams(p => ({ ...p, [key]: value[0] }));

  const handlePreview = async () => {
    try {
      await previewMutation.mutateAsync({ ...params, samplePrompt: samplePrompt || undefined });
    } catch { toast.error("プレビューに失敗しました"); }
  };

  const handleSave = async () => {
    try {
      await saveMutation.mutateAsync({ ...params, presetName: presetName || undefined });
      utils.myTwin.getEmotionCalibration.invalidate();
      setPresetName("");
      toast.success("プリセットを保存しました");
    } catch { toast.error("保存に失敗しました"); }
  };

  const handleApply = async (id: number) => {
    try {
      const res = await applyMutation.mutateAsync({ calibrationId: id });
      toast.success(`${res.appliedTo}に適用しました`);
    } catch { toast.error("適用に失敗しました"); }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ calibrationId: id });
      utils.myTwin.getEmotionCalibration.invalidate();
      toast.success("削除しました");
    } catch { toast.error("削除に失敗しました"); }
  };

  const handleABTest = async () => {
    const calA = (calibrations.data ?? []).find((c: any) => c.id === abIds[0]);
    const calB = (calibrations.data ?? []).find((c: any) => c.id === abIds[1]);
    if (!calA || !calB) { toast.error("2つのプリセットを選択してください"); return; }
    try {
      await Promise.all([
        previewA.mutateAsync({ empathy: calA.empathy, aggression: calA.aggression, optimism: calA.optimism, caution: calA.caution, humor: calA.humor, samplePrompt: abPrompt }),
        previewB.mutateAsync({ empathy: calB.empathy, aggression: calB.aggression, optimism: calB.optimism, caution: calB.caution, humor: calB.humor, samplePrompt: abPrompt }),
      ]);
    } catch { toast.error("A/Bテストに失敗しました"); }
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">感情キャリブレーション</h1>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="calibrate"><SlidersHorizontal className="h-4 w-4 mr-1" />調整</TabsTrigger>
            <TabsTrigger value="presets"><Save className="h-4 w-4 mr-1" />プリセット</TabsTrigger>
            <TabsTrigger value="abtest"><FlaskRound className="h-4 w-4 mr-1" />A/Bテスト</TabsTrigger>
          </TabsList>

          <TabsContent value="calibrate">
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle>感情パラメータ</CardTitle><CardDescription>スライダーで微調整</CardDescription></CardHeader>
                <CardContent className="space-y-6">
                  {AXES.map(a => (
                    <div key={a.key} className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{a.label}</span>
                        <span className="text-muted-foreground">{params[a.key]}</span>
                      </div>
                      <Slider value={[params[a.key]]} onValueChange={v => handleSlider(a.key, v)} min={0} max={100} step={1} />
                      <p className="text-xs text-muted-foreground">{a.desc}</p>
                    </div>
                  ))}
                  <div className="flex gap-2 pt-2">
                    <Input placeholder="プリセット名（任意）" value={presetName} onChange={e => setPresetName(e.target.value)} className="flex-1" />
                    <Button onClick={handleSave} disabled={saveMutation.isPending}><Save className="h-4 w-4 mr-1" />保存</Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>プレビュー</CardTitle><CardDescription>現在の設定でサンプル応答を確認</CardDescription></CardHeader>
                <CardContent className="space-y-3">
                  <Input placeholder="サンプル質問（任意）" value={samplePrompt} onChange={e => setSamplePrompt(e.target.value)} />
                  <Button onClick={handlePreview} disabled={previewMutation.isPending} className="w-full">
                    {previewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                    プレビュー生成
                  </Button>
                  {previewMutation.data && (
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">Q: {previewMutation.data.prompt}</p>
                      <p className="text-sm">{previewMutation.data.response}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="presets">
            <div className="space-y-3">
              {(calibrations.data ?? []).map((c: any) => (
                <Card key={c.id}>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.presetName || `設定 #${c.id}`}</span>
                        {c.friendName && <Badge variant="outline">{c.friendName}向け</Badge>}
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => handleApply(c.id)} disabled={applyMutation.isPending}><Check className="h-3 w-3 mr-1" />適用</Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(c.id)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {AXES.map(a => (
                        <div key={a.key} className="text-xs">
                          <span className="text-muted-foreground">{a.label}:</span> <span className="font-mono">{c[a.key]}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
              {!calibrations.data?.length && <p className="text-muted-foreground">プリセットがありません</p>}
            </div>
          </TabsContent>

          <TabsContent value="abtest">
            <Card>
              <CardHeader><CardTitle>A/Bテスト</CardTitle><CardDescription>2つのプリセットを同じ質問で比較</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {[0, 1].map(idx => (
                    <div key={idx}>
                      <p className="text-sm font-medium mb-1">{idx === 0 ? "A" : "B"}</p>
                      <select className="w-full border rounded p-2 text-sm bg-background" onChange={e => { const ids = [...abIds] as [number | null, number | null]; ids[idx] = Number(e.target.value) || null; setAbIds(ids); }}>
                        <option value="">プリセット選択</option>
                        {(calibrations.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.presetName || `設定 #${c.id}`}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <Input placeholder="テスト質問" value={abPrompt} onChange={e => setAbPrompt(e.target.value)} />
                <Button onClick={handleABTest} disabled={previewA.isPending || previewB.isPending || !abIds[0] || !abIds[1]}>
                  {(previewA.isPending || previewB.isPending) ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FlaskRound className="h-4 w-4 mr-2" />}
                  比較実行
                </Button>
                {(previewA.data || previewB.data) && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-blue-500/10 rounded-lg"><p className="text-xs font-medium text-blue-500 mb-1">A</p><p className="text-sm">{previewA.data?.response || "..."}</p></div>
                    <div className="p-3 bg-purple-500/10 rounded-lg"><p className="text-xs font-medium text-purple-500 mb-1">B</p><p className="text-sm">{previewB.data?.response || "..."}</p></div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
