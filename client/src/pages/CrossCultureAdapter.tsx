import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe, AlertTriangle, History, Loader2 } from "lucide-react";
import { toast } from "sonner";

const IMPORTANCE_COLORS: Record<string, string> = { high: "destructive", medium: "default", low: "secondary" };
const CULTURE_ICONS: Record<string, string> = { "日本": "\u{1F1EF}\u{1F1F5}", "アメリカ": "\u{1F1FA}\u{1F1F8}", "中国": "\u{1F1E8}\u{1F1F3}", "韓国": "\u{1F1F0}\u{1F1F7}", "欧州": "\u{1F1EA}\u{1F1FA}" };

export default function CrossCultureAdapter() {
  const [tab, setTab] = useState("analysis");
  const [sessionId, setSessionId] = useState<number | null>(null);

  const sessions = trpc.matching.sessions.useQuery();
  const culture = trpc.matching.getCrossCulture.useQuery({ sessionId: sessionId! }, { enabled: !!sessionId });
  const history = trpc.matching.getCrossCultureHistory.useQuery();
  const analyzeMutation = trpc.matching.analyzeCrossCulture.useMutation();
  const utils = trpc.useUtils();

  const handleAnalyze = async () => {
    if (!sessionId) return;
    try {
      await analyzeMutation.mutateAsync({ sessionId });
      utils.matching.getCrossCulture.invalidate({ sessionId });
      utils.matching.getCrossCultureHistory.invalidate();
      toast.success("文化分析が完了しました");
    } catch {
      toast.error("分析に失敗しました");
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">クロスカルチャー・アダプター</h1>
        <Select onValueChange={(v) => setSessionId(Number(v))}>
          <SelectTrigger className="w-80"><SelectValue placeholder="セッションを選択" /></SelectTrigger>
          <SelectContent>
            {(sessions.data ?? []).map((s: any) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.theme || `セッション #${s.id}`}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="analysis"><Globe className="h-4 w-4 mr-1" />文化分析</TabsTrigger>
            <TabsTrigger value="gaps"><AlertTriangle className="h-4 w-4 mr-1" />ギャップ検出</TabsTrigger>
            <TabsTrigger value="history"><History className="h-4 w-4 mr-1" />履歴</TabsTrigger>
          </TabsList>

          <TabsContent value="analysis">
            {!sessionId ? <p className="text-muted-foreground">セッションを選択してください</p> : (
              <div className="space-y-4">
                <Button onClick={handleAnalyze} disabled={analyzeMutation.isPending}>
                  {analyzeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Globe className="h-4 w-4 mr-2" />}
                  文化分析を実行
                </Button>
                {culture.data && (
                  <>
                    <div className="flex items-center gap-4">
                      <Card className="flex-1">
                        <CardContent className="pt-4 text-center">
                          <p className="text-3xl">{CULTURE_ICONS[culture.data.friendCulture] || "\u{1F30D}"}</p>
                          <p className="font-medium mt-1">推定文化圏: {culture.data.friendCulture}</p>
                        </CardContent>
                      </Card>
                      <Card className="flex-1">
                        <CardContent className="pt-4 text-center">
                          <p className={`text-3xl font-bold ${(culture.data.crossCultureScore || 0) >= 60 ? "text-green-500" : "text-yellow-500"}`}>{culture.data.crossCultureScore}</p>
                          <p className="text-sm text-muted-foreground">異文化対応スコア</p>
                        </CardContent>
                      </Card>
                    </div>
                    <div className="space-y-2">
                      {(culture.data.culturePoints ?? []).map((cp: any, i: number) => (
                        <Card key={i}>
                          <CardContent className="pt-4">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant={(IMPORTANCE_COLORS[cp.importance] || "secondary") as any}>{cp.importance?.toUpperCase()}</Badge>
                              <Badge variant="outline">{cp.category}</Badge>
                            </div>
                            <p className="text-sm">{cp.advice}</p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="gaps">
            {culture.data?.gapAlerts?.length ? (
              <div className="space-y-3">
                {culture.data.gapAlerts.map((g: any, i: number) => (
                  <Card key={i} className="border-yellow-500/50">
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        <Badge variant="outline">ターン {g.turnNumber}</Badge>
                      </div>
                      <p className="text-sm font-medium">{g.gap}</p>
                      <p className="text-sm text-muted-foreground mt-1">提案: {g.suggestion}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : <p className="text-muted-foreground">{sessionId ? "まず文化分析を実行してください" : "セッションを選択してください"}</p>}
          </TabsContent>

          <TabsContent value="history">
            <div className="space-y-2">
              {(history.data ?? []).map((h: any) => (
                <Card key={h.sessionId} className="cursor-pointer hover:border-primary" onClick={() => { setSessionId(h.sessionId); setTab("analysis"); }}>
                  <CardContent className="pt-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{h.theme || `セッション #${h.sessionId}`}</p>
                      <p className="text-xs text-muted-foreground">{new Date(h.createdAt).toLocaleDateString("ja-JP")}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>{CULTURE_ICONS[h.friendCulture] || "\u{1F30D}"} {h.friendCulture}</span>
                      <Badge variant="outline">{h.crossCultureScore}点</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {!history.data?.length && <p className="text-muted-foreground">履歴がありません</p>}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
