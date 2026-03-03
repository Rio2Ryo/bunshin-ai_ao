import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ArrowLeftRight, TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react";
import { useState } from "react";

export default function CompareReport() {
  const [sessionIdA, setSessionIdA] = useState<number | null>(null);
  const [sessionIdB, setSessionIdB] = useState<number | null>(null);

  const sessions = trpc.matching.sessions.useQuery();
  const compareMutation = trpc.matching.compareSessions.useMutation();

  const handleCompare = async () => {
    if (!sessionIdA || !sessionIdB) {
      toast.error("2つのセッションを選択してください");
      return;
    }
    if (sessionIdA === sessionIdB) {
      toast.error("異なるセッションを選択してください");
      return;
    }
    try {
      await compareMutation.mutateAsync({ sessionIdA, sessionIdB });
      toast.success("比較分析が完了しました");
    } catch (e: any) {
      toast.error(e.message || "比較に失敗しました");
    }
  };

  const data = compareMutation.data;
  const sessionList = (sessions.data || []).filter((s: any) => s.status === "completed");

  return (
    <DashboardLayout>
      <div className="container mx-auto p-4 max-w-4xl space-y-6">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">セッション比較レポート</h1>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">比較するセッションを選択</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">セッション A</label>
                <Select onValueChange={(v) => setSessionIdA(Number(v))}>
                  <SelectTrigger><SelectValue placeholder="セッションAを選択" /></SelectTrigger>
                  <SelectContent>
                    {sessionList.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>#{s.id} {s.theme} ({s.compatibilityScore ?? '-'}点)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">セッション B</label>
                <Select onValueChange={(v) => setSessionIdB(Number(v))}>
                  <SelectTrigger><SelectValue placeholder="セッションBを選択" /></SelectTrigger>
                  <SelectContent>
                    {sessionList.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>#{s.id} {s.theme} ({s.compatibilityScore ?? '-'}点)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={handleCompare} disabled={compareMutation.isPending || !sessionIdA || !sessionIdB} className="w-full">
              {compareMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowLeftRight className="h-4 w-4 mr-2" />}
              比較分析を実行
            </Button>
          </CardContent>
        </Card>

        {data && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">セッション A</p>
                  <p className="text-2xl font-bold">{data.sessionA.score}点</p>
                  <p className="text-xs truncate">{data.sessionA.theme}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">スコア差</p>
                  <p className="text-2xl font-bold flex items-center justify-center gap-1">
                    {data.scoreDiff > 0 ? <TrendingUp className="h-5 w-5 text-green-500" /> : data.scoreDiff < 0 ? <TrendingDown className="h-5 w-5 text-red-500" /> : <Minus className="h-5 w-5" />}
                    {data.scoreDiff > 0 ? '+' : ''}{data.scoreDiff}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">セッション B</p>
                  <p className="text-2xl font-bold">{data.sessionB.score}点</p>
                  <p className="text-xs truncate">{data.sessionB.theme}</p>
                </CardContent>
              </Card>
            </div>

            {data.overallVerdict && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">総合所見</CardTitle></CardHeader>
                <CardContent><p className="text-sm">{data.overallVerdict}</p></CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.improvements.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-green-600">改善点</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {data.improvements.map((item: string, i: number) => (
                      <div key={i} className="flex items-start gap-2">
                        <TrendingUp className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                        <p className="text-sm">{item}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              {data.regressions.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-red-600">退化点</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {data.regressions.map((item: string, i: number) => (
                      <div key={i} className="flex items-start gap-2">
                        <TrendingDown className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                        <p className="text-sm">{item}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>

            {data.growthAreas.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">成長エリア</CardTitle></CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {data.growthAreas.map((area: string, i: number) => (
                    <Badge key={i} variant="secondary">{area}</Badge>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
