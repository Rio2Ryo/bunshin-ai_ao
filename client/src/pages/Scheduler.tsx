import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useLocation } from "wouter";
import { useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Loader2, Play, Plus, Sparkles, TrendingUp, Trash2, X, Zap } from "lucide-react";

export default function Scheduler() {
  usePageMeta({ title: "AIオートスケジューラー", description: "最適なマッチング相手とテーマをAIが自動提案", path: "/scheduler" });
  const [, navigate] = useLocation();

  const { data: prefs, isLoading: prefsLoading, refetch: refetchPrefs } = trpc.matching.getSchedulerPreferences.useQuery();
  const { data: suggestions, isLoading: suggestionsLoading, refetch: refetchSuggestions } = trpc.matching.getSchedulerSuggestions.useQuery();
  const updatePrefsMut = trpc.matching.updateSchedulerPreferences.useMutation();
  const startStreaming = trpc.matching.startStreaming.useMutation();

  const [newTheme, setNewTheme] = useState("");
  const [frequency, setFrequency] = useState(prefs?.frequency || "weekly");
  const [autoExecute, setAutoExecute] = useState(prefs?.autoExecute === 1);

  const handleAddTheme = () => {
    if (!newTheme.trim()) return;
    const current = prefs?.preferredThemes || [];
    if (current.includes(newTheme.trim())) { toast.error("既に追加済みです"); return; }
    updatePrefsMut.mutateAsync({ preferredThemes: [...current, newTheme.trim()] }).then(() => {
      setNewTheme("");
      refetchPrefs();
      toast.success("テーマを追加しました");
    });
  };

  const handleRemoveTheme = (theme: string) => {
    const current = prefs?.preferredThemes || [];
    updatePrefsMut.mutateAsync({ preferredThemes: current.filter((t: string) => t !== theme) }).then(() => {
      refetchPrefs();
    });
  };

  const handleUpdateFrequency = (val: string) => {
    setFrequency(val);
    updatePrefsMut.mutateAsync({ frequency: val as any }).then(() => refetchPrefs());
  };

  const handleToggleAutoExecute = (val: boolean) => {
    setAutoExecute(val);
    updatePrefsMut.mutateAsync({ autoExecute: val }).then(() => refetchPrefs());
  };

  const handleExecute = async (friendId: number, theme: string) => {
    try {
      const result = await startStreaming.mutateAsync({ friendId, theme, turns: 5 });
      navigate(`/matching/${result.sessionId}`);
    } catch (e: any) {
      toast.error(e.message || "マッチング開始に失敗しました");
    }
  };

  const frequencyLabel: Record<string, string> = { daily: "毎日", weekly: "毎週", biweekly: "隔週", monthly: "月1回" };

  return (
    <DashboardLayout>
      <div className="space-y-6" role="main" aria-label="AIオートスケジューラー">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <CalendarClock className="h-8 w-8 text-primary" />
              AIオートスケジューラー
            </h1>
            <p className="text-muted-foreground mt-1">
              AIが最適なマッチング相手とテーマを自動提案します
            </p>
          </div>
          <Button variant="outline" onClick={() => refetchSuggestions()} disabled={suggestionsLoading}>
            {suggestionsLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            提案を更新
          </Button>
        </div>

        {/* Settings */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">スケジュール設定</CardTitle>
              <CardDescription>マッチングの頻度と自動実行を設定</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>提案頻度</Label>
                <Select value={frequency} onValueChange={handleUpdateFrequency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">毎日</SelectItem>
                    <SelectItem value="weekly">毎週</SelectItem>
                    <SelectItem value="biweekly">隔週</SelectItem>
                    <SelectItem value="monthly">月1回</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">自動実行</p>
                  <p className="text-xs text-muted-foreground">承認なしで自動的にマッチングを開始</p>
                </div>
                <Switch checked={autoExecute} onCheckedChange={handleToggleAutoExecute} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">好みのテーマ</CardTitle>
              <CardDescription>AIがテーマ提案時に参考にします</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  value={newTheme}
                  onChange={(e) => setNewTheme(e.target.value)}
                  placeholder="例: 新規事業の可能性"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddTheme(); } }}
                />
                <Button onClick={handleAddTheme} disabled={!newTheme.trim()}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {prefs?.preferredThemes && prefs.preferredThemes.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {prefs.preferredThemes.map((theme: string, i: number) => (
                    <Badge key={i} variant="secondary" className="gap-1">
                      {theme}
                      <button onClick={() => handleRemoveTheme(theme)} className="ml-1 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">テーマが未設定です</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* AI Suggestions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              AI提案マッチング
            </CardTitle>
            <CardDescription>
              あなたの過去のマッチング傾向と友達プロフィールから、最適な組み合わせを提案します
            </CardDescription>
          </CardHeader>
          <CardContent>
            {suggestionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !suggestions || suggestions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Sparkles className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">提案を生成するには友達を追加してください</p>
              </div>
            ) : (
              <div className="space-y-3">
                {suggestions.map((s: any, i: number) => (
                  <div key={i} className="flex items-center justify-between gap-4 rounded-lg border p-4 hover:bg-muted/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium truncate">{s.friendName}</p>
                        <Badge variant="outline" className="text-xs shrink-0">
                          <TrendingUp className="h-3 w-3 mr-1" />
                          推定{s.estimatedScore}%
                        </Badge>
                      </div>
                      <p className="text-sm text-primary font-medium">テーマ: {s.suggestedTheme}</p>
                      <p className="text-xs text-muted-foreground mt-1">{s.reason}</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleExecute(s.friendId, s.suggestedTheme)}
                      disabled={startStreaming.isPending}
                    >
                      {startStreaming.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <><Play className="h-4 w-4 mr-1" />実行</>
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
