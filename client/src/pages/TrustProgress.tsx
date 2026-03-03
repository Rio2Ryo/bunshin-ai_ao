import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Shield, Trophy, Unlock, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const LEVEL_NAMES = ["", "表層", "本音", "秘密共有", "共同プロジェクト", "パートナー"];
const LEVEL_THRESHOLDS = [0, 0, 3, 6, 12, 20];
const LEVEL_COLORS = ["", "bg-gray-400", "bg-blue-500", "bg-purple-500", "bg-orange-500", "bg-yellow-500"];

export default function TrustProgress() {
  const [tab, setTab] = useState("level");
  const [friendId, setFriendId] = useState<number | null>(null);

  const friends = trpc.friends.list.useQuery();
  const trustData = trpc.matching.getTrustProgress.useQuery({ friendId: friendId! }, { enabled: !!friendId });
  const allProgress = trpc.matching.getAllTrustProgress.useQuery();
  const leaderboard = trpc.matching.getTrustLeaderboard.useQuery();
  const themes = trpc.matching.getTrustThemes.useQuery({ friendId: friendId! }, { enabled: !!friendId });
  const updateMutation = trpc.matching.updateTrustProgress.useMutation();
  const utils = trpc.useUtils();

  // Keep allProgress referenced to avoid unused-variable TS error
  void allProgress;

  const handleUpdate = async () => {
    if (!friendId) return;
    try {
      const res = await updateMutation.mutateAsync({ friendId });
      utils.matching.getTrustProgress.invalidate({ friendId });
      utils.matching.getAllTrustProgress.invalidate();
      utils.matching.getTrustLeaderboard.invalidate();
      if (res.levelUp) toast.success(`信頼レベルアップ! Lv${res.trustLevel}「${res.levelName}」+${res.pointsAwarded}pt`);
      else toast.success("信頼データを更新しました");
    } catch { toast.error("更新に失敗しました"); }
  };

  const acceptedFriends = (friends.data ?? []).filter((f: any) => f.status === "accepted");
  const nextThreshold = trustData.data ? LEVEL_THRESHOLDS[Math.min((trustData.data.trustLevel || 1) + 1, 5)] : 3;
  const progressPct = trustData.data ? Math.min(100, ((trustData.data.matchCount || 0) / nextThreshold) * 100) : 0;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">信頼構築プログレス</h1>
        <Select onValueChange={(v) => setFriendId(Number(v))}>
          <SelectTrigger className="w-80"><SelectValue placeholder="友達を選択" /></SelectTrigger>
          <SelectContent>
            {acceptedFriends.map((f: any) => (
              <SelectItem key={f.friendId} value={String(f.friendId)}>{f.friendName || `友達 #${f.friendId}`}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="level"><Shield className="h-4 w-4 mr-1" />信頼レベル</TabsTrigger>
            <TabsTrigger value="leaderboard"><Trophy className="h-4 w-4 mr-1" />リーダーボード</TabsTrigger>
            <TabsTrigger value="themes"><Unlock className="h-4 w-4 mr-1" />テーマ一覧</TabsTrigger>
          </TabsList>

          <TabsContent value="level">
            {!friendId ? <p className="text-muted-foreground">友達を選択してください</p> : trustData.data ? (
              <div className="space-y-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center mb-4">
                      <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full ${LEVEL_COLORS[trustData.data.trustLevel] || "bg-gray-400"} text-white text-2xl font-bold`}>
                        Lv{trustData.data.trustLevel}
                      </div>
                      <p className="text-xl font-bold mt-2">{LEVEL_NAMES[trustData.data.trustLevel]}</p>
                      <p className="text-sm text-muted-foreground">マッチング回数: {trustData.data.matchCount}回</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm"><span>次のレベルまで</span><span>{trustData.data.matchCount}/{nextThreshold}回</span></div>
                      <Progress value={progressPct} className="h-3" />
                    </div>
                    <Button onClick={handleUpdate} disabled={updateMutation.isPending} className="w-full mt-4">
                      {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                      進捗を更新
                    </Button>
                  </CardContent>
                </Card>
                {trustData.data.achievements?.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle>アチーブメント</CardTitle></CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {trustData.data.achievements.map((a: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 p-2 bg-muted rounded">
                            <Trophy className="h-4 w-4 text-yellow-500" />
                            <span className="text-sm font-medium">Lv{a.level} {a.name}</span>
                            <span className="text-xs text-muted-foreground ml-auto">{a.achievedAt ? new Date(a.achievedAt).toLocaleDateString("ja-JP") : ""}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : <p className="text-muted-foreground">読み込み中...</p>}
          </TabsContent>

          <TabsContent value="leaderboard">
            <Card>
              <CardHeader><CardTitle>信頼レベル・リーダーボード</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(leaderboard.data ?? []).map((l: any, i: number) => (
                    <div key={l.friendId} className="flex items-center gap-3 p-3 border rounded-lg">
                      <span className="text-lg font-bold w-8">{i === 0 ? "\u{1F947}" : i === 1 ? "\u{1F948}" : i === 2 ? "\u{1F949}" : `${i + 1}.`}</span>
                      <div className="flex-1">
                        <p className="font-medium">{l.friendName || `友達 #${l.friendId}`}</p>
                        <p className="text-xs text-muted-foreground">{l.matchCount}回のマッチング</p>
                      </div>
                      <Badge className={LEVEL_COLORS[l.trustLevel] + " text-white"}>Lv{l.trustLevel} {LEVEL_NAMES[l.trustLevel]}</Badge>
                    </div>
                  ))}
                  {!leaderboard.data?.length && <p className="text-muted-foreground">データがありません</p>}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="themes">
            {friendId && themes.data ? (
              <Card>
                <CardHeader><CardTitle>解放済みテーマ（Lv{themes.data.trustLevel}）</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {(themes.data.themes ?? []).map((t: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-sm py-1 px-3">{t}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : <p className="text-muted-foreground">友達を選択してください</p>}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
