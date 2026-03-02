import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/_core/hooks/useAuth";
import { Switch } from "@/components/ui/switch";
import {
  Users, Plus, Loader2, Play, CheckCircle, XCircle, Clock,
  UserPlus, Bot, MessageSquare, Shield, Star, TrendingUp,
  ArrowRight, Sparkles, Search, Send, Inbox, History,
  ArrowUpRight, ArrowDownRight, Minus, Check, X,
  CalendarClock, Trash2, Bell, BarChart3, Globe, Target,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Score components
// ---------------------------------------------------------------------------

function ScoreCircle({ score, size = "md", source }: { score: number; size?: "sm" | "md" | "lg"; source?: string }) {
  const sizeMap = { sm: "w-10 h-10 text-xs", md: "w-14 h-14 text-sm", lg: "w-20 h-20 text-lg" };
  const color = score >= 80 ? "text-green-500 border-green-500/40" :
                score >= 60 ? "text-blue-500 border-blue-500/40" :
                score >= 40 ? "text-yellow-500 border-yellow-500/40" :
                "text-muted-foreground border-muted";
  return (
    <div className={`${sizeMap[size]} rounded-full border-2 ${color} flex flex-col items-center justify-center shrink-0`}>
      <span className="font-bold leading-none">{score}%</span>
      {source === "estimated" && size !== "sm" && (
        <span className="text-[9px] text-muted-foreground leading-none mt-0.5">推定</span>
      )}
    </div>
  );
}

function ScoreDiffBadge({ diff }: { diff: number }) {
  if (diff > 0) return <Badge variant="secondary" className="text-xs gap-0.5"><ArrowUpRight className="h-3 w-3" />+{diff}</Badge>;
  if (diff < 0) return <Badge variant="secondary" className="text-xs gap-0.5"><ArrowDownRight className="h-3 w-3" />{diff}</Badge>;
  return <Badge variant="secondary" className="text-xs gap-0.5"><Minus className="h-3 w-3" />±0</Badge>;
}

function AvatarCircle({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const s = size === "sm" ? "w-10 h-10 text-sm" : "w-12 h-12 text-base";
  const initial = name?.charAt(0) || "?";
  return (
    <div className={`${s} rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center shrink-0`}>
      {initial}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Matching() {
  usePageMeta({ title: "ビジネスマッチング", description: "スコアに基づいたマッチング候補を発見しましょう。", path: "/matching" });
  const { user } = useAuth();
  const { data: myTwin } = trpc.myTwin.get.useQuery();
  const { data: friends } = trpc.friends.list.useQuery();
  const { data: sessions, isLoading: sessionsLoading, refetch: refetchSessions } = trpc.matching.sessions.useQuery();
  const { data: trustData } = trpc.trust.getScore.useQuery();
  const { data: candidates, isLoading: candidatesLoading } = trpc.matching.suggestedCandidates.useQuery();

  // New: discover candidates (±20 trust score)
  const { data: discovered, isLoading: discoverLoading, refetch: refetchDiscover } = trpc.matching.discoverCandidates.useQuery();
  const { data: receivedReqs, isLoading: recvLoading, refetch: refetchRecv } = trpc.matching.receivedRequests.useQuery();
  const { data: sentReqs, isLoading: sentLoading, refetch: refetchSent } = trpc.matching.sentRequests.useQuery();

  const [, navigate] = useLocation();
  const createSession = trpc.matching.create.useMutation();
  const startStreaming = trpc.matching.startStreaming.useMutation();
  const runDialogue = trpc.matching.runDialogue.useMutation();
  const completeTutorial = trpc.onboarding.completeTutorial.useMutation();
  const sendRequestMut = trpc.matching.sendRequest.useMutation();
  const acceptRequestMut = trpc.matching.acceptRequest.useMutation();
  const rejectRequestMut = trpc.matching.rejectRequest.useMutation();

  const createGroupMut = trpc.matching.createGroup.useMutation();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isGroupOpen, setIsGroupOpen] = useState(false);
  const [selectedFriendId, setSelectedFriendId] = useState("");
  const [groupFriendIds, setGroupFriendIds] = useState<number[]>([]);
  const [groupTheme, setGroupTheme] = useState("");
  const [groupTurns, setGroupTurns] = useState(3);
  const [theme, setTheme] = useState("");
  const [turns, setTurns] = useState(5);
  const [requestMsg, setRequestMsg] = useState("");
  const [requestTargetId, setRequestTargetId] = useState<number | null>(null);

  // Multilingual matching state
  const [isMultilingualOpen, setIsMultilingualOpen] = useState(false);
  const [multiLang1, setMultiLang1] = useState("日本語");
  const [multiLang2, setMultiLang2] = useState("English");
  const [multiTheme, setMultiTheme] = useState("");
  const [multiSelectedFriend, setMultiSelectedFriend] = useState("");
  const createMultilingualMut = trpc.matching.createMultilingual.useMutation();
  const predictMut = trpc.matching.predictScore.useMutation();
  const [prediction, setPrediction] = useState<any>(null);

  const handleCreate = async () => {
    if (!selectedFriendId || !theme.trim()) { toast.error("友達とテーマを選択してください"); return; }
    if (!myTwin) { toast.error("まず自分の分身AIを作成してください"); return; }
    const friend = friends?.find(f => f.friend.id === parseInt(selectedFriendId));
    if (!friend?.twin) { toast.error("この友達はまだ分身AIを作成していません"); return; }
    try {
      // Use streaming mode — creates session, then navigates to session page where SSE streaming begins
      const result = await startStreaming.mutateAsync({ friendId: friend.friend.id, theme, turns });
      setIsCreateOpen(false); setSelectedFriendId(""); setTheme(""); setTurns(5); setPrediction(null);
      navigate(`/matching/${result.sessionId}`);
    } catch (error: any) { toast.error(error?.message || "作成に失敗しました"); }
  };

  const handlePredict = async () => {
    if (!selectedFriendId || !theme.trim()) { toast.error("友達とテーマを選択してください"); return; }
    try {
      const result = await predictMut.mutateAsync({ friendId: parseInt(selectedFriendId), theme });
      setPrediction(result);
    } catch (e: any) { toast.error(e.message || "予測に失敗しました"); }
  };

  const handleCreateGroup = async () => {
    if (groupFriendIds.length < 2 || !groupTheme.trim()) { toast.error("2人以上の友達とテーマを選択してください"); return; }
    if (!myTwin) { toast.error("まず自分の分身AIを作成してください"); return; }
    try {
      const result = await createGroupMut.mutateAsync({ friendIds: groupFriendIds, theme: groupTheme, turns: groupTurns });
      setIsGroupOpen(false); setGroupFriendIds([]); setGroupTheme(""); setGroupTurns(3);
      navigate(`/matching/group/${result.sessionId}`);
    } catch (error: any) { toast.error(error?.message || "グループマッチング作成に失敗しました"); }
  };

  const toggleGroupFriend = (id: number) => {
    setGroupFriendIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 4 ? [...prev, id] : prev);
  };

  const handleCreateMultilingual = async () => {
    if (!multiSelectedFriend || !multiTheme.trim()) { toast.error("友達とテーマを選択してください"); return; }
    try {
      const result = await createMultilingualMut.mutateAsync({
        friendId: parseInt(multiSelectedFriend),
        theme: multiTheme,
        language1: multiLang1,
        language2: multiLang2,
      });
      setIsMultilingualOpen(false);
      navigate(`/matching/${result.sessionId}`);
    } catch (e: any) { toast.error(e.message || "作成に失敗しました"); }
  };

  const handleQuickMatch = (friendId: number, friendName: string) => {
    setSelectedFriendId(friendId.toString());
    setTheme(`${friendName}とのビジネス協業の可能性`);
    setIsCreateOpen(true);
  };

  const handleSendRequest = async (userId: number) => {
    try {
      await sendRequestMut.mutateAsync({ receiverUserId: userId, message: requestMsg || undefined });
      toast.success("リクエストを送信しました");
      setRequestTargetId(null); setRequestMsg("");
      refetchDiscover(); refetchSent();
    } catch (error: any) { toast.error(error?.message || "送信に失敗しました"); }
  };

  const handleAcceptRequest = async (requestId: number) => {
    try {
      await acceptRequestMut.mutateAsync({ requestId });
      toast.success("リクエストを承認しました");
      refetchRecv(); refetchDiscover();
    } catch (error: any) { toast.error(error?.message || "承認に失敗しました"); }
  };

  const handleRejectRequest = async (requestId: number) => {
    try {
      await rejectRequestMut.mutateAsync({ requestId });
      toast.success("リクエストを拒否しました");
      refetchRecv();
    } catch (error: any) { toast.error(error?.message || "拒否に失敗しました"); }
  };

  const handleRunDialogue = async (sessionId: number) => {
    try { toast.info("対話を開始しています..."); await runDialogue.mutateAsync({ sessionId, turns: 5 }); toast.success("対話が完了しました"); refetchSessions(); }
    catch { toast.error("対話の実行に失敗しました"); }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "running": return <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />;
      case "failed": return <XCircle className="h-4 w-4 text-red-500" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };
  const getStatusText = (s: string) => s === "completed" ? "完了" : s === "running" ? "実行中" : s === "failed" ? "失敗" : "待機中";

  const friendsWithTwin = friends?.filter(f => f.twin) || [];
  const me = user as any;
  const tutorialDone = me?.tutorialCompleted === 1;
  const displayedSessions = tutorialDone ? sessions?.filter((s: any) => !s.isNpcSession) || [] : sessions || [];
  const npcSessions = sessions?.filter((s: any) => s.isNpcSession) || [];
  const trustScore = trustData?.score ?? 0;

  const sortedSessions = [...(displayedSessions || [])].sort((a: any, b: any) => {
    if (a.status === "completed" && b.status !== "completed") return -1;
    if (a.status !== "completed" && b.status === "completed") return 1;
    if (a.compatibilityScore != null && b.compatibilityScore != null) return b.compatibilityScore - a.compatibilityScore;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const pendingRecvCount = receivedReqs?.length ?? 0;

  return (
    <DashboardLayout>
      <div className="space-y-6" role="main" aria-label="ビジネスマッチング">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">ビジネスマッチング</h1>
            <p className="text-muted-foreground mt-2">
              信頼度スコアが近いユーザーとマッチングしましょう
            </p>
          </div>
          <div className="flex items-center gap-2">
          <Link href="/matching/analytics">
            <Button variant="outline" size="sm"><BarChart3 className="h-4 w-4 mr-2" />分析</Button>
          </Link>
          <Link href="/predictions">
            <Button variant="outline" size="sm"><Target className="h-4 w-4 mr-2" />AI予測</Button>
          </Link>
          <Dialog open={isGroupOpen} onOpenChange={setIsGroupOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={!myTwin || friendsWithTwin.length < 2}><Users className="h-4 w-4 mr-2" />グループ</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>グループマッチング（3〜5人）</DialogTitle>
                <DialogDescription>複数の友達と同時にマッチング対話を行います</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <Label>参加者を選択（2〜4人）</Label>
                  <div className="space-y-2 mt-2 max-h-40 overflow-y-auto">
                    {friendsWithTwin.map((f: any) => (
                      <label key={f.friend.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={groupFriendIds.includes(f.friend.id)}
                          onChange={() => toggleGroupFriend(f.friend.id)}
                          disabled={!groupFriendIds.includes(f.friend.id) && groupFriendIds.length >= 4}
                          className="rounded border-gray-300"
                        />
                        <span className="text-sm font-medium">{f.friend.name}</span>
                        {f.twin?.name && <span className="text-xs text-muted-foreground">({f.twin.name})</span>}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{groupFriendIds.length}/4 選択中（あなたを含めて{groupFriendIds.length + 1}人）</p>
                </div>
                <div>
                  <Label htmlFor="group-theme">テーマ</Label>
                  <Input id="group-theme" placeholder="例: 新規事業アイデアのブレインストーミング" value={groupTheme} onChange={(e) => setGroupTheme(e.target.value)} />
                </div>
                <div>
                  <Label>ラウンド数（各参加者の発言回数）</Label>
                  <Slider min={1} max={5} step={1} value={[groupTurns]} onValueChange={([v]) => setGroupTurns(v)} />
                  <p className="text-xs text-muted-foreground mt-1">{groupTurns}ラウンド（計{groupTurns * (groupFriendIds.length + 1)}ターン）</p>
                </div>
                <Button onClick={handleCreateGroup} disabled={groupFriendIds.length < 2 || !groupTheme.trim() || createGroupMut.isPending} className="w-full">
                  {createGroupMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />作成中...</> : <><Users className="h-4 w-4 mr-2" />グループマッチング開始</>}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={isMultilingualOpen} onOpenChange={setIsMultilingualOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={!myTwin || friendsWithTwin.length === 0}><Globe className="h-4 w-4 mr-2" />多言語</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>多言語マッチング対話</DialogTitle>
                <DialogDescription>異なる言語でツインが対話し、リアルタイム翻訳を表示します</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <Label>友達を選択</Label>
                  <Select value={multiSelectedFriend} onValueChange={setMultiSelectedFriend}>
                    <SelectTrigger><SelectValue placeholder="友達を選択" /></SelectTrigger>
                    <SelectContent>
                      {friendsWithTwin.map((f: any) => (
                        <SelectItem key={f.friend.id} value={f.friend.id.toString()}>
                          {f.friend.name} ({f.twin?.name})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>テーマ</Label>
                  <Input placeholder="例: 国際ビジネス展開の戦略" value={multiTheme} onChange={(e) => setMultiTheme(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>あなたの言語</Label>
                    <Select value={multiLang1} onValueChange={setMultiLang1}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="日本語">日本語</SelectItem>
                        <SelectItem value="English">English</SelectItem>
                        <SelectItem value="中文">中文</SelectItem>
                        <SelectItem value="한국어">한국어</SelectItem>
                        <SelectItem value="Español">Español</SelectItem>
                        <SelectItem value="Français">Français</SelectItem>
                        <SelectItem value="Deutsch">Deutsch</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>相手の言語</Label>
                    <Select value={multiLang2} onValueChange={setMultiLang2}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="日本語">日本語</SelectItem>
                        <SelectItem value="English">English</SelectItem>
                        <SelectItem value="中文">中文</SelectItem>
                        <SelectItem value="한국어">한국어</SelectItem>
                        <SelectItem value="Español">Español</SelectItem>
                        <SelectItem value="Français">Français</SelectItem>
                        <SelectItem value="Deutsch">Deutsch</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button onClick={handleCreateMultilingual} disabled={!multiSelectedFriend || !multiTheme.trim() || createMultilingualMut.isPending} className="w-full">
                  {createMultilingualMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />作成中...</> : <><Globe className="h-4 w-4 mr-2" />多言語マッチング開始</>}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={isCreateOpen} onOpenChange={(open) => { setIsCreateOpen(open); if (!open) setPrediction(null); }}>
            <DialogTrigger asChild>
              <Button size="sm" disabled={!myTwin}><Plus className="h-4 w-4 mr-2" />新規マッチング</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>新規マッチングセッション</DialogTitle>
                <DialogDescription>友達の分身AIを選んで、ビジネステーマを設定してください</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="p-3 rounded-lg bg-muted/50 border">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1"><Bot className="h-4 w-4" />あなたの分身AI</div>
                  <p className="font-medium">{myTwin?.name || "未作成"}</p>
                </div>
                <div className="space-y-2">
                  <Label>対話相手（友達の分身AI）</Label>
                  <Select value={selectedFriendId} onValueChange={setSelectedFriendId}>
                    <SelectTrigger><SelectValue placeholder="友達を選択" /></SelectTrigger>
                    <SelectContent>
                      {friendsWithTwin.length > 0 ? friendsWithTwin.map((friend) => (
                        <SelectItem key={friend.friend.id} value={friend.friend.id.toString()}>
                          {friend.twin?.name} ({friend.friend.name})
                        </SelectItem>
                      )) : <div className="p-2 text-sm text-muted-foreground text-center">分身AIを持つ友達がいません</div>}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="theme">対話テーマ</Label>
                  <Input id="theme" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="例: AI活用した新規事業の可能性" />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2"><MessageSquare className="h-4 w-4" />対話ターン数</Label>
                    <span className="text-sm font-medium text-primary">{turns}ターン</span>
                  </div>
                  <Slider value={[turns]} onValueChange={(v) => setTurns(v[0])} min={3} max={30} step={1} className="w-full" />
                  <div className="flex justify-between text-xs text-muted-foreground"><span>3（簡潔）</span><span>15（標準）</span><span>30（徹底議論）</span></div>
                </div>
                {/* AI Prediction */}
                <div className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium flex items-center gap-1"><Target className="h-4 w-4" />AI予測</span>
                    <Button variant="outline" size="sm" onClick={handlePredict} disabled={!selectedFriendId || !theme.trim() || predictMut.isPending}>
                      {predictMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                      予測する
                    </Button>
                  </div>
                  {prediction && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <div className={`text-2xl font-bold ${prediction.predictedScore >= 70 ? "text-green-500" : prediction.predictedScore >= 50 ? "text-blue-500" : "text-yellow-500"}`}>
                          {prediction.predictedScore}%
                        </div>
                        <div className="text-xs text-muted-foreground flex-1">
                          <p>{prediction.reasoning}</p>
                          <p className="mt-1">確信度: {prediction.confidence}% | 過去{prediction.pastMatchCount}回のデータ使用</p>
                        </div>
                      </div>
                      {prediction.tips?.length > 0 && (
                        <div className="text-xs space-y-1">
                          {prediction.tips.map((tip: string, i: number) => (
                            <p key={i} className="text-muted-foreground">💡 {tip}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>キャンセル</Button>
                  <Button onClick={handleCreate} disabled={startStreaming.isPending || friendsWithTwin.length === 0}>
                    {startStreaming.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    作成して対話開始
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {/* Warning banners */}
        {!myTwin && (
          <Card className="border-yellow-500/50 bg-yellow-500/10">
            <CardContent className="flex items-center gap-4 py-4">
              <Bot className="h-8 w-8 text-yellow-500" />
              <div className="flex-1"><p className="font-medium">まず分身AIを作成してください</p><p className="text-sm text-muted-foreground">マッチングを始めるには、自分の分身AIが必要です</p></div>
              <Link href="/twins"><Button>分身AIを作成</Button></Link>
            </CardContent>
          </Card>
        )}

        {!tutorialDone && npcSessions.length > 0 && (
          <Card className="border-cyan-500/50 bg-cyan-500/10">
            <CardContent className="flex items-center gap-4 py-4">
              <Bot className="h-8 w-8 text-cyan-500" />
              <div className="flex-1"><p className="font-medium">チュートリアルセッション表示中</p><p className="text-sm text-muted-foreground">ガイドキャラクターとの練習マッチングが表示されています。</p></div>
              <Button variant="outline" onClick={async () => { try { await completeTutorial.mutateAsync(); toast.success("チュートリアル完了"); window.location.reload(); } catch { toast.error("失敗しました"); } }} disabled={completeTutorial.isPending}>
                {completeTutorial.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}チュートリアル完了
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs defaultValue={!tutorialDone && npcSessions.length > 0 ? "history" : "discover"} className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="discover" className="gap-1.5"><Search className="h-4 w-4" />おすすめ候補</TabsTrigger>
            <TabsTrigger value="received" className="gap-1.5">
              <Inbox className="h-4 w-4" />受信
              {pendingRecvCount > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0 ml-1">{pendingRecvCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="sent" className="gap-1.5"><Send className="h-4 w-4" />送信済み</TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5"><History className="h-4 w-4" />履歴</TabsTrigger>
            <TabsTrigger value="scheduler" className="gap-1.5"><CalendarClock className="h-4 w-4" />自動</TabsTrigger>
          </TabsList>

          {/* ===== Tab: Discover ===== */}
          <TabsContent value="discover">
            <div className="space-y-4 mt-4">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="h-5 w-5 text-primary" />
                <p className="text-sm text-muted-foreground">あなたの信頼度: <span className="font-bold text-foreground">{trustScore}pt</span> — スコア差±20以内のユーザーが表示されます</p>
              </div>

              {discoverLoading ? (
                <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : discovered && discovered.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {discovered.map((c: any) => (
                    <Card key={c.userId} className="hover:border-primary/50 transition-colors">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <AvatarCircle name={c.name} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Link href={`/users/${c.userId}`}>
                                <p className="font-medium text-sm truncate hover:text-primary transition-colors cursor-pointer">{c.name}</p>
                              </Link>
                              {c.isFriend && <Badge variant="outline" className="text-[10px] px-1.5 py-0">友達</Badge>}
                            </div>
                            {c.company && <p className="text-xs text-muted-foreground truncate">{c.company}{c.industry ? ` / ${c.industry}` : ""}</p>}
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="secondary" className="text-xs">{c.trustScore}pt</Badge>
                              <ScoreDiffBadge diff={c.scoreDiff} />
                            </div>
                            {c.bio && <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{c.bio}</p>}
                            {c.commonTags && c.commonTags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {c.commonTags.map((tag: string, i: number) => (
                                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{tag}</span>
                                ))}
                              </div>
                            )}
                            {c.twin?.tags && c.twin.tags.length > 0 && (!c.commonTags || c.commonTags.length === 0) && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {c.twin.tags.slice(0, 3).map((tag: string, i: number) => (
                                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{tag}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="mt-3">
                          {c.requestStatus === "pending" && c.requestDirection === "sent" ? (
                            <Button size="sm" variant="outline" className="w-full" disabled><Clock className="h-3 w-3 mr-1" />リクエスト送信済み</Button>
                          ) : c.requestStatus === "pending" && c.requestDirection === "received" ? (
                            <div className="flex gap-2">
                              <Button size="sm" className="flex-1" onClick={() => handleAcceptRequest(c.requestId)} disabled={acceptRequestMut.isPending}>
                                <Check className="h-3 w-3 mr-1" />承認
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => handleRejectRequest(c.requestId)} disabled={rejectRequestMut.isPending}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : c.requestStatus === "accepted" ? (
                            <Button size="sm" className="w-full" onClick={() => handleQuickMatch(c.userId, c.name)} disabled={createSession.isPending}>
                              <Play className="h-3 w-3 mr-1" />マッチング開始
                            </Button>
                          ) : c.isFriend ? (
                            <Button size="sm" className="w-full" onClick={() => handleQuickMatch(c.userId, c.name)} disabled={createSession.isPending}>
                              <Play className="h-3 w-3 mr-1" />マッチング開始
                            </Button>
                          ) : requestTargetId === c.userId ? (
                            <div className="space-y-2">
                              <Input placeholder="メッセージ（任意）" value={requestMsg} onChange={(e) => setRequestMsg(e.target.value)} className="text-xs h-8" />
                              <div className="flex gap-2">
                                <Button size="sm" className="flex-1" onClick={() => handleSendRequest(c.userId)} disabled={sendRequestMut.isPending}>
                                  {sendRequestMut.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}送信
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => { setRequestTargetId(null); setRequestMsg(""); }}>取消</Button>
                              </div>
                            </div>
                          ) : (
                            <Button size="sm" variant="outline" className="w-full" onClick={() => setRequestTargetId(c.userId)}>
                              <UserPlus className="h-3 w-3 mr-1" />リクエスト送信
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Search className="h-12 w-12 text-muted-foreground mb-3" />
                    <h3 className="text-base font-medium mb-1">候補が見つかりません</h3>
                    <p className="text-muted-foreground text-sm text-center">信頼度スコアが近いユーザーがまだいません。プロフィールを充実させてスコアを上げましょう。</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* ===== Tab: Received Requests ===== */}
          <TabsContent value="received">
            <div className="space-y-4 mt-4">
              {recvLoading ? (
                <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : receivedReqs && receivedReqs.length > 0 ? (
                <div className="grid gap-3">
                  {receivedReqs.map((r: any) => (
                    <Card key={r.id} className="hover:border-primary/50 transition-colors">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-4">
                          <AvatarCircle name={r.senderName} size="sm" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{r.senderName}</p>
                            {r.senderCompany && <p className="text-xs text-muted-foreground">{r.senderCompany}{r.senderIndustry ? ` / ${r.senderIndustry}` : ""}</p>}
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="secondary" className="text-xs">{r.senderTrustScore}pt</Badge>
                              <ScoreDiffBadge diff={r.scoreDiff} />
                            </div>
                            {r.message && <p className="text-xs text-muted-foreground mt-1 italic">「{r.message}」</p>}
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <Button size="sm" onClick={() => handleAcceptRequest(r.id)} disabled={acceptRequestMut.isPending}>
                              {acceptRequestMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}承認
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleRejectRequest(r.id)} disabled={rejectRequestMut.isPending}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Inbox className="h-12 w-12 text-muted-foreground mb-3" />
                    <h3 className="text-base font-medium mb-1">受信リクエストはありません</h3>
                    <p className="text-muted-foreground text-sm text-center">他のユーザーからのマッチングリクエストがここに表示されます</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* ===== Tab: Sent Requests ===== */}
          <TabsContent value="sent">
            <div className="space-y-4 mt-4">
              {sentLoading ? (
                <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : sentReqs && sentReqs.length > 0 ? (
                <div className="grid gap-3">
                  {sentReqs.map((r: any) => (
                    <Card key={r.id}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-4">
                          <AvatarCircle name={r.receiverName} size="sm" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{r.receiverName}</p>
                            {r.receiverCompany && <p className="text-xs text-muted-foreground">{r.receiverCompany}</p>}
                            <Badge variant="secondary" className="text-xs mt-1">{r.receiverTrustScore}pt</Badge>
                            {r.message && <p className="text-xs text-muted-foreground mt-1 italic">「{r.message}」</p>}
                          </div>
                          <div className="shrink-0">
                            {r.status === "pending" && <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />保留中</Badge>}
                            {r.status === "accepted" && <Badge className="gap-1 bg-green-500/20 text-green-600 border-green-500/30"><CheckCircle className="h-3 w-3" />承認済み</Badge>}
                            {r.status === "rejected" && <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />拒否</Badge>}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Send className="h-12 w-12 text-muted-foreground mb-3" />
                    <h3 className="text-base font-medium mb-1">送信済みリクエストはありません</h3>
                    <p className="text-muted-foreground text-sm text-center">おすすめ候補からリクエストを送信しましょう</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* ===== Tab: History ===== */}
          <TabsContent value="history">
            <div className="space-y-4 mt-4">
              {/* Friend-based candidates (existing) */}
              {myTwin && candidates && candidates.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-medium">友達マッチング候補</h3>
                    <Badge variant="secondary" className="text-xs">{candidates.length}件</Badge>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {candidates.map((c: any) => (
                      <Card key={c.friend.id} className="hover:border-primary/50 transition-colors">
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <ScoreCircle score={c.score} size="md" source={c.scoreSource} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-sm truncate">{c.friend.name}</p>
                                {c.friend.isNpc && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">NPC</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground truncate">{c.twin.name}</p>
                              <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{c.twin.description?.slice(0, 80) || "プロフィール未設定"}</p>
                              {c.twin.tags && c.twin.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {c.twin.tags.slice(0, 3).map((tag: string, i: number) => (
                                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{tag}</span>
                                  ))}
                                </div>
                              )}
                              {c.bestResult && (
                                <div className="mt-2 p-2 rounded bg-muted/50 border border-muted">
                                  <div className="flex items-center gap-1 mb-0.5"><Star className="h-3 w-3 text-yellow-500" /><span className="text-[10px] font-medium">過去ベスト: {c.bestResult.score}%</span></div>
                                  <p className="text-[10px] text-muted-foreground line-clamp-1">{c.bestResult.summary}</p>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2 mt-3">
                            <Button size="sm" className="flex-1" onClick={() => handleQuickMatch(c.friend.id, c.friend.name)} disabled={createSession.isPending}>
                              <Play className="h-3 w-3 mr-1" />マッチング開始
                            </Button>
                            {c.bestResult?.sessionId && (
                              <Link href={`/matching/${c.bestResult.sessionId}`}><Button size="sm" variant="outline"><ArrowRight className="h-3 w-3" /></Button></Link>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* Session history */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium">マッチング履歴</h3>
                  {sortedSessions.length > 0 && <Badge variant="secondary" className="text-xs">{sortedSessions.length}件</Badge>}
                </div>
                {sessionsLoading ? (
                  <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                ) : sortedSessions.length > 0 ? (
                  <div className="grid gap-3">
                    {sortedSessions.map((session: any) => (
                      <Card key={session.id} className="hover:border-primary/50 transition-colors">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-4">
                            {session.compatibilityScore != null ? (
                              <ScoreCircle score={Math.round(session.compatibilityScore)} size="sm" />
                            ) : (
                              <div className="w-10 h-10 rounded-full border-2 border-muted flex items-center justify-center shrink-0">{getStatusIcon(session.status)}</div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-sm truncate">{session.theme}</p>
                                {session.isNpcSession && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">チュートリアル</Badge>}
                                {session.isGroup && <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0"><Users className="h-2.5 w-2.5 mr-0.5" />{session.participantCount}人</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground">{session.isGroup ? `グループ（${session.participantCount}人参加）` : `${session.twin1?.name || `Twin #${session.twin1Id}`} × ${session.twin2?.name || `Twin #${session.twin2Id}`}`}</p>
                              {session.resultSummary && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{session.resultSummary}</p>}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="text-right hidden sm:block">
                                <div className="flex items-center gap-1 justify-end">{getStatusIcon(session.status)}<span className="text-xs text-muted-foreground">{getStatusText(session.status)}</span></div>
                                <span className="text-[10px] text-muted-foreground">{new Date(session.createdAt).toLocaleDateString("ja-JP", { month: "short", day: "numeric" })}</span>
                              </div>
                              <div className="flex gap-1">
                                {session.status === "pending" && <Button size="sm" variant="outline" onClick={() => handleRunDialogue(session.id)} disabled={runDialogue.isPending}><Play className="h-3 w-3" /></Button>}
                                <Link href={session.isGroup ? `/matching/group/${session.id}` : `/matching/${session.id}`}><Button size="sm" variant="outline">詳細</Button></Link>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                      <Users className="h-12 w-12 text-muted-foreground mb-3" />
                      <h3 className="text-base font-medium mb-1">マッチング履歴がありません</h3>
                      <p className="text-muted-foreground text-sm text-center">おすすめ候補からマッチングを始めましょう</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ===== Tab: Scheduler ===== */}
          <TabsContent value="scheduler">
            <SchedulerTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

// ---------------------------------------------------------------------------
// Auto Matching Scheduler Tab
// ---------------------------------------------------------------------------

function SchedulerTab() {
  const { data: schedules, isLoading, refetch } = trpc.scheduler.list.useQuery();
  const { data: friends } = trpc.matching.availableFriends.useQuery();
  const createSchedule = trpc.scheduler.create.useMutation({ onSuccess: () => { refetch(); toast.success("スケジュールを作成しました"); } });
  const updateSchedule = trpc.scheduler.update.useMutation({ onSuccess: () => refetch() });
  const deleteSchedule = trpc.scheduler.delete.useMutation({ onSuccess: () => { refetch(); toast.success("スケジュールを削除しました"); } });

  const { data: notifSettings, refetch: refetchNotif } = trpc.notification.getSettings.useQuery();
  const updateNotif = trpc.notification.updateSettings.useMutation({ onSuccess: () => { refetchNotif(); toast.success("通知設定を更新しました"); } });

  const [newFriendId, setNewFriendId] = useState("");
  const [newTheme, setNewTheme] = useState("協業の可能性");
  const [newFreq, setNewFreq] = useState<"daily" | "weekly" | "biweekly">("weekly");

  const freqLabel: Record<string, string> = { daily: "毎日", weekly: "毎週", biweekly: "隔週" };

  return (
    <div className="space-y-6 mt-4">
      {/* Create new schedule */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            自動対話スケジュール
          </CardTitle>
          <CardDescription>分身AI同士が自動で定期的に対話を行います</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>友達</Label>
              <Select value={newFriendId} onValueChange={setNewFriendId}>
                <SelectTrigger><SelectValue placeholder="選択..." /></SelectTrigger>
                <SelectContent>
                  {(friends ?? []).map((f: any) => (
                    <SelectItem key={f.friend.id} value={String(f.friend.id)}>
                      {f.friend.name} ({f.twin?.name})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>頻度</Label>
              <Select value={newFreq} onValueChange={(v) => setNewFreq(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">毎日</SelectItem>
                  <SelectItem value="weekly">毎週</SelectItem>
                  <SelectItem value="biweekly">隔週</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>テーマ</Label>
              <Input value={newTheme} onChange={(e) => setNewTheme(e.target.value)} placeholder="協業の可能性" />
            </div>
          </div>
          <Button
            onClick={() => {
              if (!newFriendId) { toast.error("友達を選択してください"); return; }
              createSchedule.mutate({ friendId: Number(newFriendId), frequency: newFreq, theme: newTheme });
            }}
            disabled={createSchedule.isPending}
          >
            {createSchedule.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            スケジュール追加
          </Button>
        </CardContent>
      </Card>

      {/* Existing schedules */}
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : schedules && schedules.length > 0 ? (
        <div className="space-y-3">
          {schedules.map((s: any) => (
            <Card key={s.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{s.friendName || `ID:${s.friendId}`}</span>
                    <Badge variant={s.isActive ? "default" : "secondary"}>
                      {s.isActive ? freqLabel[s.frequency] || s.frequency : "停止中"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground truncate mt-0.5">{s.theme}</p>
                  {s.lastRunAt && <p className="text-xs text-muted-foreground">最終実行: {s.lastRunAt.slice(0, 16)}</p>}
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <Switch
                    checked={!!s.isActive}
                    onCheckedChange={(checked) => updateSchedule.mutate({ id: s.id, isActive: checked ? 1 : 0 })}
                  />
                  <Button variant="ghost" size="icon" onClick={() => deleteSchedule.mutate({ id: s.id })}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center py-8">
            <CalendarClock className="h-10 w-10 text-muted-foreground mb-2" />
            <p className="text-muted-foreground text-sm">自動対話スケジュールがありません</p>
          </CardContent>
        </Card>
      )}

      {/* Notification settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            通知設定
          </CardTitle>
          <CardDescription>マッチング完了時の通知方法</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">LINE通知</p>
              <p className="text-xs text-muted-foreground">LINE連携済みの場合に通知</p>
            </div>
            <Switch
              checked={!!notifSettings?.lineNotify}
              onCheckedChange={(checked) => updateNotif.mutate({ lineNotify: checked ? 1 : 0 })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">マッチング完了通知</p>
              <p className="text-xs text-muted-foreground">対話が完了した時に通知</p>
            </div>
            <Switch
              checked={!!notifSettings?.matchingComplete}
              onCheckedChange={(checked) => updateNotif.mutate({ matchingComplete: checked ? 1 : 0 })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">自動対話通知</p>
              <p className="text-xs text-muted-foreground">スケジュール実行時に通知</p>
            </div>
            <Switch
              checked={!!notifSettings?.scheduledMatching}
              onCheckedChange={(checked) => updateNotif.mutate({ scheduledMatching: checked ? 1 : 0 })}
            />
          </div>
          <div>
            <Label>Slack Webhook URL</Label>
            <div className="flex gap-2 mt-1">
              <Input
                placeholder="https://hooks.slack.com/services/..."
                defaultValue={notifSettings?.slackWebhookUrl || ""}
                onBlur={(e) => {
                  const val = e.target.value.trim();
                  if (val !== (notifSettings?.slackWebhookUrl || "")) {
                    updateNotif.mutate({ slackWebhookUrl: val || null });
                  }
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
