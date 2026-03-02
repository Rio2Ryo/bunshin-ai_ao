import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Calendar, Loader2, Users, Plus, CheckCircle, Trophy, ArrowLeft } from "lucide-react";

export default function CommunityEvents() {
  usePageMeta({ title: "コミュニティイベント", description: "オープンマッチングイベント", path: "/events" });

  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("list");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    description: "",
    theme: "",
    maxParticipants: 10,
    scheduledAt: "",
  });

  const { data: eventsData, refetch: refetchEvents } = trpc.matching.listCommunityEvents.useQuery();
  const { data: eventDetail, refetch: refetchDetail } = trpc.matching.getCommunityEvent.useQuery(
    { eventId: selectedEventId! },
    { enabled: !!selectedEventId }
  );

  const events = (eventsData as any[]) || [];
  const detail = eventDetail as any;

  const createEvent = trpc.matching.createCommunityEvent.useMutation({
    onSuccess: () => {
      toast.success("イベントを作成しました");
      setShowCreateDialog(false);
      setCreateForm({ title: "", description: "", theme: "", maxParticipants: 10, scheduledAt: "" });
      refetchEvents();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const joinEvent = trpc.matching.joinCommunityEvent.useMutation({
    onSuccess: () => {
      toast.success("参加申請しました");
      refetchEvents();
      if (selectedEventId) refetchDetail();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const approveParticipant = trpc.matching.approveParticipant.useMutation({
    onSuccess: () => {
      toast.success("参加を承認しました");
      refetchDetail();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const runEvent = trpc.matching.runCommunityEvent.useMutation({
    onSuccess: () => {
      toast.success("イベントを実行しました");
      refetchDetail();
      refetchEvents();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleCreateEvent = () => {
    if (!createForm.title.trim() || !createForm.scheduledAt) {
      toast.error("タイトルと日時を入力してください");
      return;
    }
    createEvent.mutate({
      title: createForm.title.trim(),
      description: createForm.description.trim(),
      theme: createForm.theme.trim(),
      maxParticipants: createForm.maxParticipants,
      scheduledAt: createForm.scheduledAt,
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "upcoming": return <Badge className="bg-blue-500 text-white">開催予定</Badge>;
      case "completed": return <Badge className="bg-green-500 text-white">完了</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getParticipantStatusBadge = (status: string) => {
    switch (status) {
      case "pending": return <Badge className="bg-yellow-500 text-white">承認待ち</Badge>;
      case "approved": return <Badge className="bg-green-500 text-white">参加済み</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const handleSelectEvent = (eventId: number) => {
    setSelectedEventId(eventId);
    setActiveTab("detail");
  };

  const report = detail?.reportData;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Calendar className="h-7 w-7 text-indigo-500" />
          <h1 className="text-2xl font-bold">コミュニティイベント</h1>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="list">イベント一覧</TabsTrigger>
            <TabsTrigger value="detail" disabled={!selectedEventId}>イベント詳細</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="space-y-4">
            <div className="flex justify-end">
              <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    イベント作成
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>新しいイベントを作成</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>タイトル</Label>
                      <Input
                        placeholder="イベント名"
                        value={createForm.title}
                        onChange={(e) => setCreateForm((p) => ({ ...p, title: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>説明</Label>
                      <Textarea
                        placeholder="イベントの詳細..."
                        value={createForm.description}
                        onChange={(e) => setCreateForm((p) => ({ ...p, description: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>テーマ</Label>
                      <Input
                        placeholder="例: AI技術, スタートアップ"
                        value={createForm.theme}
                        onChange={(e) => setCreateForm((p) => ({ ...p, theme: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>最大参加人数</Label>
                      <Input
                        type="number"
                        min={2}
                        max={50}
                        value={createForm.maxParticipants}
                        onChange={(e) => setCreateForm((p) => ({ ...p, maxParticipants: Number(e.target.value) }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>開催日時</Label>
                      <Input
                        type="datetime-local"
                        value={createForm.scheduledAt}
                        onChange={(e) => setCreateForm((p) => ({ ...p, scheduledAt: e.target.value }))}
                      />
                    </div>
                    <Button onClick={handleCreateEvent} disabled={createEvent.isPending} className="w-full">
                      {createEvent.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />作成中...</>
                      ) : (
                        "作成"
                      )}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {events.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  まだイベントがありません。新しいイベントを作成しましょう！
                </CardContent>
              </Card>
            ) : (
              events.map((event: any) => (
                <Card
                  key={event.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => handleSelectEvent(event.id)}
                >
                  <CardContent className="py-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-lg">{event.title}</h3>
                        <p className="text-sm text-muted-foreground">主催: {event.organizerName || "不明"}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {event.theme && <Badge variant="outline">{event.theme}</Badge>}
                        {getStatusBadge(event.status)}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        {new Date(event.scheduledAt).toLocaleString("ja-JP")}
                      </div>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Users className="h-4 w-4" />
                        {event.participantCount ?? 0} / {event.maxParticipants}
                      </div>
                    </div>
                    <Progress
                      value={((event.participantCount ?? 0) / (event.maxParticipants || 1)) * 100}
                      className="h-2"
                    />
                    <div className="flex items-center justify-between">
                      {event.myStatus === null || event.myStatus === undefined ? (
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            joinEvent.mutate({ eventId: event.id });
                          }}
                          disabled={joinEvent.isPending}
                        >
                          参加する
                        </Button>
                      ) : event.myStatus === "pending" ? (
                        <Badge className="bg-yellow-500 text-white">承認待ち</Badge>
                      ) : (
                        <Badge className="bg-green-500 text-white">参加済み</Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="detail" className="space-y-4">
            {!detail ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  イベントを選択してください
                </CardContent>
              </Card>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => { setActiveTab("list"); setSelectedEventId(null); }}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  一覧に戻る
                </Button>

                <Card>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-xl">{detail.title}</CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">主催: {detail.organizerName || "不明"}</p>
                      </div>
                      {getStatusBadge(detail.status)}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {detail.description && <p className="text-sm">{detail.description}</p>}
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      {detail.theme && (
                        <div className="flex items-center gap-1">
                          テーマ: <Badge variant="outline">{detail.theme}</Badge>
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {new Date(detail.scheduledAt).toLocaleString("ja-JP")}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="h-5 w-5" />
                      参加者 ({detail.participants?.length || 0} / {detail.maxParticipants})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {!detail.participants || detail.participants.length === 0 ? (
                      <p className="text-center text-muted-foreground py-4">まだ参加者がいません</p>
                    ) : (
                      <div className="space-y-2">
                        {detail.participants.map((p: any, i: number) => (
                          <div key={p.userId} className="flex items-center justify-between py-2 border-b last:border-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium w-8">
                                {p.rank === 1 ? "🥇" : p.rank === 2 ? "🥈" : p.rank === 3 ? "🥉" : `${i + 1}.`}
                              </span>
                              <span className="font-medium">{p.userName || "ユーザー"}</span>
                              {getParticipantStatusBadge(p.status)}
                            </div>
                            <div className="flex items-center gap-2">
                              {p.matchingScore != null && (
                                <span className="text-sm text-muted-foreground">スコア: {p.matchingScore}</span>
                              )}
                              {p.status === "pending" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => approveParticipant.mutate({ eventId: detail.id, userId: p.userId })}
                                  disabled={approveParticipant.isPending}
                                >
                                  <CheckCircle className="h-4 w-4 mr-1" />
                                  承認
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {detail.status === "upcoming" && (
                  <Button
                    onClick={() => runEvent.mutate({ eventId: detail.id })}
                    disabled={runEvent.isPending}
                    className="w-full"
                  >
                    {runEvent.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />イベント実行中...</>
                    ) : (
                      <><Trophy className="h-4 w-4 mr-2" />イベント実行</>
                    )}
                  </Button>
                )}

                {detail.status === "completed" && report && (
                  <Card className="border-green-200 bg-green-50">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Trophy className="h-5 w-5 text-yellow-500" />
                        イベントレポート
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {report.summary && <p className="text-sm">{report.summary}</p>}

                      {report.highlights?.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-sm mb-1">ハイライト</h4>
                          <ul className="list-disc list-inside text-sm text-muted-foreground">
                            {report.highlights.map((h: string, i: number) => <li key={i}>{h}</li>)}
                          </ul>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        {report.bestPair && (
                          <div>
                            <p className="text-sm text-muted-foreground">ベストペア</p>
                            <p className="font-semibold">{typeof report.bestPair === "string" ? report.bestPair : `${report.bestPair.user1} & ${report.bestPair.user2}`}</p>
                          </div>
                        )}
                        {report.avgScore != null && (
                          <div>
                            <p className="text-sm text-muted-foreground">平均スコア</p>
                            <p className="font-semibold">{report.avgScore}</p>
                          </div>
                        )}
                      </div>

                      {report.recommendations?.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-sm mb-1">おすすめ</h4>
                          <ul className="list-disc list-inside text-sm text-muted-foreground">
                            {report.recommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
