import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ShieldAlert, Loader2, AlertTriangle, Shield, CheckCircle2, XCircle } from "lucide-react";

const RISK_COLORS: Record<string, string> = { high: "destructive", medium: "secondary", low: "outline" };
const RISK_LABELS: Record<string, string> = { high: "高リスク", medium: "中リスク", low: "低リスク" };
const CATEGORY_LABELS: Record<string, string> = { value_conflict: "価値観衝突", knowledge_gap: "知識ギャップ", communication_mismatch: "コミュニケーション不一致", interest_conflict: "利害対立", other: "その他" };

export default function RiskAssessment() {
  const [selectedFriendId, setSelectedFriendId] = useState<string>("");
  const [theme, setTheme] = useState("");
  const [verifyId, setVerifyId] = useState<number | null>(null);
  const [outcome, setOutcome] = useState("");
  const [accuracy, setAccuracy] = useState([70]);

  const friends = trpc.friends.list.useQuery();
  const assessMutation = trpc.matching.assessRisk.useMutation();
  const assessments = trpc.matching.listRiskAssessments.useQuery();
  const verifyMutation = trpc.matching.verifyRisk.useMutation();
  const currentRisk = trpc.matching.getRiskAssessment.useQuery(
    { friendId: Number(selectedFriendId) },
    { enabled: !!selectedFriendId }
  );

  const friendList = ((friends.data || []) as any[]).filter((f: any) => f.status === "accepted");

  const handleAssess = async () => {
    if (!selectedFriendId) return;
    try {
      await assessMutation.mutateAsync({ friendId: Number(selectedFriendId), theme: theme || undefined });
      toast.success("リスク診断が完了しました");
      currentRisk.refetch();
      assessments.refetch();
    } catch (e: any) { toast.error(e.message || "診断に失敗しました"); }
  };

  const handleVerify = async () => {
    if (!verifyId || !outcome.trim()) return;
    try {
      await verifyMutation.mutateAsync({ assessmentId: verifyId, actualOutcome: outcome.trim(), accuracy: accuracy[0] });
      toast.success("検証結果を保存しました");
      setVerifyId(null);
      setOutcome("");
      assessments.refetch();
    } catch (e: any) { toast.error(e.message || "検証に失敗しました"); }
  };

  const data = assessMutation.data || currentRisk.data;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">リスクアセスメント</h1>
            <p className="text-sm text-muted-foreground">マッチング前に潜在リスクをAI診断</p>
          </div>
        </div>

        <Tabs defaultValue="assess">
          <TabsList>
            <TabsTrigger value="assess">リスク診断</TabsTrigger>
            <TabsTrigger value="history">診断履歴</TabsTrigger>
            <TabsTrigger value="verify">検証</TabsTrigger>
          </TabsList>

          <TabsContent value="assess" className="space-y-4 mt-4">
            <Card>
              <CardHeader><CardTitle>相手を選択</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Select value={selectedFriendId} onValueChange={setSelectedFriendId}>
                  <SelectTrigger><SelectValue placeholder="友達を選択" /></SelectTrigger>
                  <SelectContent>
                    {friendList.map((f: any) => (
                      <SelectItem key={f.id} value={String(f.friendUserId)}>{f.friendName || `Friend#${f.friendUserId}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="マッチングテーマ（任意）" />
                <Button onClick={handleAssess} disabled={!selectedFriendId || assessMutation.isPending}>
                  {assessMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />診断中...</> : "リスク診断を実行"}
                </Button>
              </CardContent>
            </Card>

            {data && (
              <>
                <Card>
                  <CardContent className="flex items-center gap-4 p-4">
                    {(data as any).riskLevel === "high" ? <XCircle className="h-8 w-8 text-red-500" /> : (data as any).riskLevel === "medium" ? <AlertTriangle className="h-8 w-8 text-amber-500" /> : <CheckCircle2 className="h-8 w-8 text-green-500" />}
                    <div>
                      <Badge variant={RISK_COLORS[(data as any).riskLevel] as any}>{RISK_LABELS[(data as any).riskLevel] || (data as any).riskLevel}</Badge>
                      <p className="text-sm text-muted-foreground mt-1">{(data as any).overallAssessment}</p>
                    </div>
                  </CardContent>
                </Card>

                {((data as any).risks || []).length > 0 && (
                  <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" />検出されたリスク</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {(data as any).risks.map((r: any, i: number) => (
                        <div key={i} className="p-3 rounded-lg border flex items-start gap-3">
                          <Badge variant={r.severity === "high" ? "destructive" : r.severity === "medium" ? "secondary" : "outline"} className="shrink-0">{r.severity === "high" ? "高" : r.severity === "medium" ? "中" : "低"}</Badge>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">{CATEGORY_LABELS[r.category] || r.category}</p>
                            <p className="text-sm">{r.description}</p>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {((data as any).mitigations || []).length > 0 && (
                  <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-green-500" />軽減策</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {(data as any).mitigations.map((m: any, i: number) => (
                        <div key={i} className="p-3 rounded-lg border">
                          <p className="text-sm font-medium">{m.risk}</p>
                          <p className="text-sm text-muted-foreground mt-1">{m.strategy}</p>
                          <Badge variant="outline" className="mt-1 text-xs">優先度: {m.priority === "high" ? "高" : m.priority === "medium" ? "中" : "低"}</Badge>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-4 mt-4">
            {((assessments.data || []) as any[]).length === 0 && <p className="text-center text-muted-foreground py-8">診断履歴がまだありません</p>}
            {((assessments.data || []) as any[]).map((a: any) => (
              <Card key={a.id}>
                <CardContent className="flex items-center gap-4 p-4">
                  <ShieldAlert className="h-5 w-5 shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">{a.friendName}</p>
                    <p className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleDateString("ja-JP")} • リスク{(a.risks || []).length}件</p>
                  </div>
                  <Badge variant={RISK_COLORS[a.riskLevel] as any}>{RISK_LABELS[a.riskLevel]}</Badge>
                  {a.verified === 1 && <Badge variant="outline">検証済み({a.accuracy}%)</Badge>}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="verify" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>リスク診断の事後検証</CardTitle>
                <CardDescription>マッチング後に診断の的中率を検証します</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select value={verifyId ? String(verifyId) : ""} onValueChange={(v) => setVerifyId(Number(v))}>
                  <SelectTrigger><SelectValue placeholder="検証する診断を選択" /></SelectTrigger>
                  <SelectContent>
                    {((assessments.data || []) as any[]).filter((a: any) => !a.verified).map((a: any) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.friendName} ({RISK_LABELS[a.riskLevel]}) - {new Date(a.createdAt).toLocaleDateString("ja-JP")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div>
                  <Label>実際の結果</Label>
                  <Input value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="マッチングの実際の結果を記述" />
                </div>
                <div>
                  <Label>的中率: {accuracy[0]}%</Label>
                  <Slider value={accuracy} onValueChange={setAccuracy} min={0} max={100} step={5} />
                </div>
                <Button onClick={handleVerify} disabled={!verifyId || !outcome.trim() || verifyMutation.isPending}>
                  {verifyMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}検証結果を保存
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
