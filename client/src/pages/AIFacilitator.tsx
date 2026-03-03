import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { MessageSquarePlus, Lightbulb, CheckCircle, BarChart3, PieChart as PieChartIcon, ArrowRight, Loader2, XCircle } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

const interventionTypeConfig: Record<string, { color: string; label: string; badgeClass: string }> = {
  topic_change: { color: "#3b82f6", label: "話題転換", badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  deep_question: { color: "#8b5cf6", label: "深掘り質問", badgeClass: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  consensus: { color: "#22c55e", label: "合意形成", badgeClass: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  encouragement: { color: "#eab308", label: "励まし", badgeClass: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
};

export default function AIFacilitator() {
  usePageMeta({ title: "AIファシリテーター", description: "AIファシリテーション介入の履歴と効果分析", path: "/facilitator" });

  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  // Session list (reuse matching.list)
  const { data: sessionsRaw } = trpc.matching.sessions.useQuery();
  const sessions = (sessionsRaw as any[]) || [];
  const completedSessions = sessions.filter((s: any) => s.status === "completed" || s.matchingResults);

  // Facilitator history for selected session
  const { data: historyRaw, isLoading: historyLoading } = trpc.matching.getFacilitatorHistory.useQuery(
    { sessionId: selectedSessionId! },
    { enabled: selectedSessionId !== null }
  );
  const interventions = ((historyRaw as any)?.interventions || (historyRaw as any[]) || []) as any[];

  // Effectiveness stats
  const { data: effectivenessRaw, isLoading: effectivenessLoading } = trpc.matching.getFacilitatorEffectiveness.useQuery();
  const effectiveness = (effectivenessRaw as any) || {};

  const totalInterventions = effectiveness.totalInterventions ?? effectiveness.total ?? 0;
  const acceptanceRate = effectiveness.acceptanceRate ?? effectiveness.acceptance_rate ?? 0;
  const avgEffectScore = effectiveness.avgEffectScore ?? effectiveness.avg_effect_score ?? 0;
  const typeBreakdown = effectiveness.typeBreakdown || effectiveness.breakdown || [];

  // Pie chart data
  const pieData = Array.isArray(typeBreakdown)
    ? typeBreakdown.map((item: any) => ({
        name: interventionTypeConfig[item.type]?.label || item.type || "その他",
        value: item.count ?? item.value ?? 0,
        color: interventionTypeConfig[item.type]?.color || "#94a3b8",
      }))
    : Object.entries(typeBreakdown).map(([type, count]) => ({
        name: interventionTypeConfig[type]?.label || type,
        value: count as number,
        color: interventionTypeConfig[type]?.color || "#94a3b8",
      }));

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <MessageSquarePlus className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold">AIファシリテーター</h1>
        </div>

        <Tabs defaultValue="history">
          <TabsList>
            <TabsTrigger value="history">介入履歴</TabsTrigger>
            <TabsTrigger value="analysis">効果分析</TabsTrigger>
          </TabsList>

          {/* 介入履歴タブ */}
          <TabsContent value="history" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquarePlus className="h-5 w-5" />
                  セッションを選択
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Select
                  value={selectedSessionId?.toString() || ""}
                  onValueChange={(v) => setSelectedSessionId(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="マッチングセッションを選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {completedSessions.length === 0 && (
                      <SelectItem value="none" disabled>完了済みセッションがありません</SelectItem>
                    )}
                    {completedSessions.map((s: any) => (
                      <SelectItem key={s.id} value={s.id.toString()}>
                        セッション #{s.id} — {s.candidateName || s.candidate_name || `ID:${s.candidateId || s.candidate_id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {historyLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            )}

            {!historyLoading && selectedSessionId && interventions.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Lightbulb className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>このセッションには介入記録がありません</p>
                </CardContent>
              </Card>
            )}

            {interventions.length > 0 && (
              <div className="space-y-3">
                {interventions.map((intervention: any, idx: number) => {
                  const type = intervention.type || intervention.interventionType || "unknown";
                  const config = interventionTypeConfig[type] || { color: "#94a3b8", label: type, badgeClass: "bg-gray-100 text-gray-800" };
                  const accepted = intervention.accepted ?? intervention.wasAccepted;

                  return (
                    <Card key={idx}>
                      <CardContent className="py-4">
                        <div className="flex items-start gap-3">
                          <div className="flex flex-col items-center gap-1">
                            <Badge className={config.badgeClass}>
                              {config.label}
                            </Badge>
                            {accepted !== undefined && (
                              accepted ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-400" />
                              )
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm">
                              {intervention.content || intervention.message || intervention.description || "介入内容"}
                            </p>
                            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                              {intervention.turn !== undefined && (
                                <span>ターン {intervention.turn}</span>
                              )}
                              {intervention.effectScore !== undefined && (
                                <span>効果: {intervention.effectScore}/10</span>
                              )}
                              {intervention.sessionId && (
                                <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
                                  <a href={`/matching/${intervention.sessionId}`}>
                                    セッションへ <ArrowRight className="h-3 w-3 ml-1" />
                                  </a>
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* 効果分析タブ */}
          <TabsContent value="analysis" className="space-y-4 mt-4">
            {effectivenessLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <>
                {/* Stats cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="py-4 text-center">
                      <MessageSquarePlus className="h-8 w-8 mx-auto mb-2 text-blue-500" />
                      <p className="text-2xl font-bold">{totalInterventions}</p>
                      <p className="text-sm text-muted-foreground">総介入回数</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="py-4 text-center">
                      <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                      <p className="text-2xl font-bold">{Math.round(acceptanceRate)}%</p>
                      <p className="text-sm text-muted-foreground">受入率</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="py-4 text-center">
                      <BarChart3 className="h-8 w-8 mx-auto mb-2 text-purple-500" />
                      <p className="text-2xl font-bold">{(avgEffectScore as number).toFixed(1)}</p>
                      <p className="text-sm text-muted-foreground">平均効果スコア</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Pie chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <PieChartIcon className="h-5 w-5" />
                      介入タイプ分布
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {pieData.length === 0 ? (
                      <p className="text-center py-8 text-muted-foreground">まだデータがありません</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            outerRadius={100}
                            dataKey="value"
                            label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            {pieData.map((entry: any, index: number) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value: number) => [value, "回"]} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>

                {/* Type breakdown table */}
                <Card>
                  <CardHeader>
                    <CardTitle>タイプ別詳細</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {pieData.length === 0 ? (
                      <p className="text-center py-4 text-muted-foreground">まだデータがありません</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-2 px-2">タイプ</th>
                              <th className="text-center py-2 px-2">回数</th>
                              <th className="text-center py-2 px-2">割合</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pieData.map((item: any, idx: number) => {
                              const total = pieData.reduce((sum: number, d: any) => sum + (d.value || 0), 0);
                              const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
                              return (
                                <tr key={idx} className="border-b last:border-0">
                                  <td className="py-2 px-2 flex items-center gap-2">
                                    <span
                                      className="inline-block w-3 h-3 rounded-full"
                                      style={{ backgroundColor: item.color }}
                                    />
                                    {item.name}
                                  </td>
                                  <td className="text-center py-2 px-2">{item.value}</td>
                                  <td className="text-center py-2 px-2">
                                    <Badge variant="outline">{pct}%</Badge>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
