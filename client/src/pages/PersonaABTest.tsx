import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { FlaskConical, Trophy, ArrowRightLeft, BarChart3, CheckCircle2, Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

type PersonaResult = {
  personaId: number;
  personaName: string;
  score: number;
};

type ABTestResult = {
  id: number;
  theme: string;
  createdAt: string;
  results: PersonaResult[];
  bestPersonaId: number;
  bestPersonaName: string;
  stats: { avg: number; variance: number; max: number; min: number };
};

const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

export default function PersonaABTest() {
  usePageMeta({ title: "ペルソナA/Bテスト", description: "ペルソナのA/Bテストを実行して比較", path: "/persona-ab-test" });

  const [theme, setTheme] = useState("");
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<number[]>([]);
  const [expandedTestId, setExpandedTestId] = useState<number | null>(null);
  const [latestResult, setLatestResult] = useState<ABTestResult | null>(null);

  const { data: personasRaw } = trpc.myTwin.listPersonas.useQuery();
  const personas = (personasRaw as any[]) || [];

  const { data: testsRaw, refetch: refetchTests } = trpc.myTwin.listPersonaABTests.useQuery();
  const tests = (testsRaw as any[]) || [];

  const runTest = trpc.myTwin.runPersonaABTest.useMutation({
    onSuccess: (data: any) => {
      const result = data as ABTestResult;
      setLatestResult(result);
      refetchTests();
      toast.success("テスト完了");
    },
    onError: (err: any) => toast.error(err.message || "テスト実行に失敗しました"),
  });

  const switchPersona = trpc.myTwin.switchToPersona.useMutation({
    onSuccess: () => toast.success("ペルソナを切り替えました"),
    onError: (err: any) => toast.error(err.message || "切り替えに失敗しました"),
  });

  const togglePersona = (id: number) => {
    setSelectedPersonaIds((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= 5) {
        toast.error("最大5つまで選択できます");
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleRun = () => {
    if (!theme.trim()) { toast.error("テーマを入力してください"); return; }
    if (selectedPersonaIds.length < 2) { toast.error("2つ以上のペルソナを選択してください"); return; }
    runTest.mutate({ theme: theme.trim(), personaIds: selectedPersonaIds });
  };

  const bestTestResult = tests.length > 0 ? tests[0] : null;

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <FlaskConical className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">ペルソナA/Bテスト</h1>
            <p className="text-muted-foreground text-sm">複数のペルソナを比較してベストを見つける</p>
          </div>
        </div>

        <Tabs defaultValue="run" className="space-y-4">
          <TabsList>
            <TabsTrigger value="run" className="gap-1.5"><FlaskConical className="h-4 w-4" />テスト実行</TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5"><BarChart3 className="h-4 w-4" />テスト履歴</TabsTrigger>
            <TabsTrigger value="switch" className="gap-1.5"><ArrowRightLeft className="h-4 w-4" />ペルソナ切替</TabsTrigger>
          </TabsList>

          {/* Tab 1: テスト実行 */}
          <TabsContent value="run" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">テスト設定</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="theme-input">テーマ（マッチングの話題）</Label>
                  <Input
                    id="theme-input"
                    placeholder="例: SaaS事業の提携について"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>ペルソナ選択（最大5つ）</Label>
                  <p className="text-xs text-muted-foreground mb-2">選択中: {selectedPersonaIds.length}/5</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {personas.length === 0 && (
                      <p className="text-sm text-muted-foreground col-span-2">ペルソナがありません。まずペルソナを作成してください。</p>
                    )}
                    {personas.map((p: any) => (
                      <div key={p.id} className="flex items-center gap-2 p-2 border rounded-lg">
                        <Checkbox
                          id={`persona-${p.id}`}
                          checked={selectedPersonaIds.includes(Number(p.id))}
                          onCheckedChange={() => togglePersona(Number(p.id))}
                        />
                        <Label htmlFor={`persona-${p.id}`} className="text-sm cursor-pointer flex-1">
                          {p.name || p.label || `ペルソナ #${p.id}`}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
                <Button onClick={handleRun} disabled={runTest.isPending} className="gap-2">
                  {runTest.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
                  {runTest.isPending ? "テスト実行中..." : "テスト実行"}
                </Button>
              </CardContent>
            </Card>

            {/* Results */}
            {latestResult && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-yellow-500" />
                    テスト結果: {latestResult.theme}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center gap-3">
                    <Trophy className="h-6 w-6 text-yellow-500" />
                    <div>
                      <p className="font-semibold">ベストペルソナ: {latestResult.bestPersonaName}</p>
                      <p className="text-sm text-muted-foreground">最高スコアを記録しました</p>
                    </div>
                  </div>

                  {/* Bar Chart */}
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={latestResult.results}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="personaName" tick={{ fontSize: 12 }} />
                        <YAxis domain={[0, 100]} />
                        <Tooltip />
                        <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                          {latestResult.results.map((_: any, idx: number) => (
                            <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Card><CardContent className="pt-4 text-center">
                      <p className="text-xs text-muted-foreground">平均</p>
                      <p className="text-xl font-bold">{latestResult.stats.avg.toFixed(1)}</p>
                    </CardContent></Card>
                    <Card><CardContent className="pt-4 text-center">
                      <p className="text-xs text-muted-foreground">分散</p>
                      <p className="text-xl font-bold">{latestResult.stats.variance.toFixed(1)}</p>
                    </CardContent></Card>
                    <Card><CardContent className="pt-4 text-center">
                      <p className="text-xs text-muted-foreground">最高</p>
                      <p className="text-xl font-bold text-green-500">{latestResult.stats.max.toFixed(1)}</p>
                    </CardContent></Card>
                    <Card><CardContent className="pt-4 text-center">
                      <p className="text-xs text-muted-foreground">最低</p>
                      <p className="text-xl font-bold text-red-500">{latestResult.stats.min.toFixed(1)}</p>
                    </CardContent></Card>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Tab 2: テスト履歴 */}
          <TabsContent value="history" className="space-y-4">
            {tests.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-muted-foreground">
                まだテスト履歴がありません
              </CardContent></Card>
            ) : (
              tests.map((test: any) => {
                const isExpanded = expandedTestId === Number(test.id);
                const results = (test.results as PersonaResult[]) || [];
                return (
                  <Card key={test.id} className="cursor-pointer" onClick={() => setExpandedTestId(isExpanded ? null : Number(test.id))}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{test.theme || "テスト"}</CardTitle>
                        <div className="flex items-center gap-2">
                          {test.bestPersonaName && (
                            <Badge className="bg-yellow-500/20 text-yellow-600 border-yellow-500/30">
                              <Trophy className="h-3 w-3 mr-1" />{test.bestPersonaName}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {test.createdAt ? new Date(test.createdAt).toLocaleDateString("ja-JP") : ""}
                          </span>
                        </div>
                      </div>
                    </CardHeader>
                    {isExpanded && results.length > 0 && (
                      <CardContent className="pt-0">
                        <div className="h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={results}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="personaName" tick={{ fontSize: 11 }} />
                              <YAxis domain={[0, 100]} />
                              <Tooltip />
                              <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                                {results.map((_: any, idx: number) => (
                                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                );
              })
            )}
          </TabsContent>

          {/* Tab 3: ペルソナ切替 */}
          <TabsContent value="switch" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  推奨ペルソナ
                </CardTitle>
              </CardHeader>
              <CardContent>
                {bestTestResult && bestTestResult.bestPersonaName ? (
                  <div className="space-y-4">
                    <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                      <p className="font-semibold text-lg">{bestTestResult.bestPersonaName}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        直近のテスト「{bestTestResult.theme}」で最高スコアを記録
                      </p>
                    </div>
                    <Button
                      onClick={() => switchPersona.mutate({ personaId: Number(bestTestResult.bestPersonaId) })}
                      disabled={switchPersona.isPending}
                      className="gap-2"
                    >
                      {switchPersona.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
                      このペルソナに切り替える
                    </Button>
                  </div>
                ) : (
                  <p className="text-muted-foreground">テストを実行して推奨ペルソナを見つけましょう</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">全ペルソナ一覧</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {personas.length === 0 && <p className="text-sm text-muted-foreground">ペルソナがありません</p>}
                  {personas.map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <span className="font-medium">{p.name || p.label || `ペルソナ #${p.id}`}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => switchPersona.mutate({ personaId: Number(p.id) })}
                        disabled={switchPersona.isPending}
                        className="gap-1.5"
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5" />切替
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
