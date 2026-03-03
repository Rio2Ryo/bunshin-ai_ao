import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { MapPin, Plus, Loader2, Trash2, TrendingUp, DollarSign, Link2, FileText } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

const TYPE_LABELS: Record<string, string> = { deal: "商談成立", partnership: "パートナーシップ", introduction: "紹介", idea: "アイデア採用", meeting: "ミーティング", other: "その他" };
const TYPE_COLORS: Record<string, string> = { deal: "#22c55e", partnership: "#3b82f6", introduction: "#a855f7", idea: "#f97316", meeting: "#06b6d4", other: "#6b7280" };

export default function ImpactMap() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newType, setNewType] = useState<string>("deal");
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newSessionId, setNewSessionId] = useState("");
  const [newLinkedId, setNewLinkedId] = useState("");

  const entries = trpc.matching.listImpactEntries.useQuery();
  const summary = trpc.matching.getImpactSummary.useQuery();
  const reports = trpc.matching.listImpactReports.useQuery();
  const sessions = trpc.matching.sessions.useQuery();
  const addMutation = trpc.matching.addImpactEntry.useMutation();
  const deleteMutation = trpc.matching.deleteImpactEntry.useMutation();
  const reportMutation = trpc.matching.generateImpactReport.useMutation();

  const handleAdd = async () => {
    if (!newTitle.trim()) { toast.error("タイトルを入力してください"); return; }
    try {
      await addMutation.mutateAsync({
        outcomeType: newType as any,
        title: newTitle.trim(),
        description: newDesc || undefined,
        monetaryValue: newValue ? Number(newValue) : 0,
        sessionId: newSessionId && newSessionId !== "none" ? Number(newSessionId) : undefined,
        linkedEntryId: newLinkedId ? Number(newLinkedId) : undefined,
      });
      toast.success("インパクトを記録しました");
      setDialogOpen(false);
      setNewTitle(""); setNewDesc(""); setNewValue(""); setNewSessionId(""); setNewLinkedId("");
      entries.refetch(); summary.refetch();
    } catch (e: any) { toast.error(e.message || "記録に失敗しました"); }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ entryId: id });
      entries.refetch(); summary.refetch();
    } catch (e: any) { toast.error(e.message || "削除に失敗しました"); }
  };

  const handleReport = async () => {
    try {
      await reportMutation.mutateAsync();
      toast.success("インパクトレポートを生成しました");
      reports.refetch();
    } catch (e: any) { toast.error(e.message || "レポート生成に失敗しました"); }
  };

  const summaryData = summary.data as any;
  const pieData = summaryData?.byType ? Object.entries(summaryData.byType).map(([key, val]) => ({ name: TYPE_LABELS[key] || key, value: val as number, color: TYPE_COLORS[key] || "#6b7280" })) : [];

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">インパクトマップ</h1>
              <p className="text-sm text-muted-foreground">マッチング成果を追跡し、ビジネスインパクトを可視化</p>
            </div>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />成果を記録</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>インパクトを記録</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>成果タイプ</Label>
                  <Select value={newType} onValueChange={setNewType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>タイトル</Label><Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="成果のタイトル" /></div>
                <div><Label>説明</Label><Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="詳細（任意）" /></div>
                <div><Label>金額（円）</Label><Input type="number" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="0" /></div>
                <div><Label>関連セッション</Label>
                  <Select value={newSessionId} onValueChange={setNewSessionId}>
                    <SelectTrigger><SelectValue placeholder="任意" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">なし</SelectItem>
                      {((sessions.data || []) as any[]).map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.theme} (#{s.id})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>連鎖元の成果ID</Label><Input value={newLinkedId} onChange={(e) => setNewLinkedId(e.target.value)} placeholder="任意（因果連鎖を記録）" /></div>
                <Button onClick={handleAdd} disabled={addMutation.isPending} className="w-full">
                  {addMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}記録
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">概要</TabsTrigger>
            <TabsTrigger value="entries">成果一覧</TabsTrigger>
            <TabsTrigger value="reports">レポート</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            {summaryData && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{summaryData.totalEntries}</p><p className="text-xs text-muted-foreground">総成果数</p></CardContent></Card>
                  <Card><CardContent className="p-4 text-center"><DollarSign className="h-5 w-5 mx-auto mb-1 text-green-500" /><p className="text-2xl font-bold">¥{(summaryData.totalValue || 0).toLocaleString()}</p><p className="text-xs text-muted-foreground">総金額</p></CardContent></Card>
                  <Card><CardContent className="p-4 text-center"><Link2 className="h-5 w-5 mx-auto mb-1 text-purple-500" /><p className="text-2xl font-bold">{summaryData.chainCount}</p><p className="text-xs text-muted-foreground">因果連鎖</p></CardContent></Card>
                  <Card><CardContent className="p-4 text-center"><TrendingUp className="h-5 w-5 mx-auto mb-1 text-blue-500" /><p className="text-2xl font-bold">{Object.keys(summaryData.byType || {}).length}</p><p className="text-xs text-muted-foreground">成果タイプ数</p></CardContent></Card>
                </div>

                {pieData.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle>成果タイプ別分布</CardTitle></CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                          <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }: { name: string; value: number }) => `${name}: ${value}`}>
                            {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="entries" className="space-y-4 mt-4">
            {((entries.data || []) as any[]).length === 0 && <p className="text-center text-muted-foreground py-8">成果がまだ記録されていません</p>}
            {((entries.data || []) as any[]).map((e: any) => (
              <Card key={e.id}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: TYPE_COLORS[e.outcomeType] || "#6b7280" }} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{e.title}</p>
                    <p className="text-xs text-muted-foreground">{TYPE_LABELS[e.outcomeType]} {e.sessionTheme ? `• ${e.sessionTheme}` : ""} • {new Date(e.createdAt).toLocaleDateString("ja-JP")}</p>
                    {e.description && <p className="text-sm text-muted-foreground mt-1">{e.description}</p>}
                  </div>
                  {e.monetaryValue > 0 && <Badge variant="outline">¥{e.monetaryValue.toLocaleString()}</Badge>}
                  {e.linkedEntryId && <Badge variant="outline" className="text-xs"><Link2 className="h-3 w-3 mr-1" />#{e.linkedEntryId}</Badge>}
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(e.id)}><Trash2 className="h-4 w-4" /></Button>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="reports" className="space-y-4 mt-4">
            <Button onClick={handleReport} disabled={reportMutation.isPending}>
              {reportMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><FileText className="h-4 w-4 mr-2" />月次レポート生成</>}
            </Button>
            {((reports.data || []) as any[]).map((r: any) => (
              <Card key={r.id}>
                <CardHeader>
                  <CardTitle>インパクトレポート</CardTitle>
                  <CardDescription>{new Date(r.createdAt).toLocaleDateString("ja-JP")} • スコア: {r.totalImpactScore}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {r.reportData?.summary && <p className="text-sm">{r.reportData.summary}</p>}
                  {r.reportData?.roi && <div className="p-3 rounded-lg bg-green-500/5"><p className="text-sm font-medium text-green-500">ROI分析</p><p className="text-sm">{r.reportData.roi}</p></div>}
                  {(r.reportData?.causalChains || []).length > 0 && (
                    <div><p className="text-sm font-medium mb-1">因果連鎖</p>{r.reportData.causalChains.map((c: string, i: number) => <p key={i} className="text-sm text-muted-foreground">• {c}</p>)}</div>
                  )}
                  {(r.reportData?.recommendations || []).length > 0 && (
                    <div><p className="text-sm font-medium mb-1">提案</p>{r.reportData.recommendations.map((rec: string, i: number) => <p key={i} className="text-sm text-muted-foreground">• {rec}</p>)}</div>
                  )}
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
