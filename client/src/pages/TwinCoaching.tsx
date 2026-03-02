import { useState, useRef, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { MessageCircleHeart, Send, Loader2, Play, Square, Clock, MessageSquare } from "lucide-react";

type CoachingMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export default function TwinCoaching() {
  usePageMeta({ title: "ツインコーチング", description: "ツインとリアルタイムで対話してフィードバック", path: "/coaching" });

  const { data: twinData } = trpc.myTwin.get.useQuery();
  const { data: sessions, refetch: refetchSessions } = trpc.myTwin.listCoachingSessions.useQuery();

  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<CoachingMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [viewingSessionId, setViewingSessionId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: viewSession } = trpc.myTwin.getCoachingSession.useQuery(
    { sessionId: viewingSessionId! },
    { enabled: !!viewingSessionId }
  );

  const twinId = (twinData as any)?.id as number | undefined;

  const startMut = trpc.myTwin.startCoaching.useMutation({
    onSuccess: (data) => {
      setActiveSessionId(data.sessionId);
      setMessages([]);
      toast.success("コーチングを開始しました");
      refetchSessions();
    },
    onError: (e) => toast.error(e.message),
  });

  const sendMut = trpc.myTwin.sendCoachingMessage.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.content }]);
      if (data.applied) {
        toast.success("ツインのパラメータが更新されました！");
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const endMut = trpc.myTwin.endCoaching.useMutation({
    onSuccess: () => {
      setActiveSessionId(null);
      setMessages([]);
      toast.success("コーチングセッションを終了しました");
      refetchSessions();
    },
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!inputText.trim() || !activeSessionId || sendMut.isPending) return;
    const userMsg: CoachingMessage = { role: "user", content: inputText.trim() };
    setMessages((prev) => [...prev, userMsg]);
    sendMut.mutate({ sessionId: activeSessionId, message: inputText.trim() });
    setInputText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const twinName = (twinData as any)?.name || "ツイン";

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageCircleHeart className="h-6 w-6" /> ツインコーチング
          </h1>
          <p className="text-muted-foreground text-sm mt-1">ツインとリアルタイムで対話してフィードバック</p>
        </div>

        <Tabs defaultValue="coaching">
          <TabsList>
            <TabsTrigger value="coaching">コーチング</TabsTrigger>
            <TabsTrigger value="history">履歴</TabsTrigger>
          </TabsList>

          {/* ===== コーチングタブ ===== */}
          <TabsContent value="coaching" className="space-y-4 mt-4">
            {!activeSessionId ? (
              <Card>
                <CardContent className="py-12 text-center space-y-4">
                  <MessageCircleHeart className="h-12 w-12 mx-auto text-muted-foreground" />
                  <div>
                    <p className="text-lg font-semibold">コーチングセッション</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {twinName}と対話して、パーソナリティやスキルを調整しましょう
                    </p>
                  </div>
                  <Button
                    onClick={() => { if (twinId) startMut.mutate({ twinId }); else toast.error("ツインが見つかりません"); }}
                    disabled={startMut.isPending || !twinId}
                    size="lg"
                  >
                    {startMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                    コーチング開始
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card className="flex flex-col" style={{ height: "calc(100vh - 320px)", minHeight: 400 }}>
                {/* Header */}
                <CardHeader className="py-3 border-b flex flex-row items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageCircleHeart className="h-5 w-5" />
                    {twinName}とのコーチング
                  </CardTitle>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => endMut.mutate({ sessionId: activeSessionId })}
                    disabled={endMut.isPending}
                  >
                    {endMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Square className="h-4 w-4 mr-2" />}
                    セッション終了
                  </Button>
                </CardHeader>

                {/* Messages */}
                <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
                  {messages.length === 0 && (
                    <p className="text-center text-muted-foreground text-sm py-8">
                      メッセージを送信してコーチングを始めましょう。
                      <br />例：「もっと積極的に」「専門用語を減らして」
                    </p>
                  )}
                  {messages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : msg.role === "system"
                            ? "bg-muted text-muted-foreground"
                            : "bg-card border"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  {sendMut.isPending && (
                    <div className="flex justify-start">
                      <div className="bg-card border rounded-lg px-4 py-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </CardContent>

                {/* Input */}
                <div className="border-t p-3 flex gap-2">
                  <Input
                    placeholder="メッセージを入力..."
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={sendMut.isPending}
                  />
                  <Button
                    onClick={handleSend}
                    disabled={!inputText.trim() || sendMut.isPending}
                    size="icon"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            )}
          </TabsContent>

          {/* ===== 履歴タブ ===== */}
          <TabsContent value="history" className="space-y-4 mt-4">
            {viewingSessionId && viewSession ? (
              <div className="space-y-4">
                <Button variant="outline" size="sm" onClick={() => setViewingSessionId(null)}>
                  ← 一覧に戻る
                </Button>
                <Card>
                  <CardHeader className="py-3 border-b">
                    <CardTitle className="text-base">
                      セッション #{viewingSessionId}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
                    {((viewSession as any).messages ?? []).map((msg: any, i: number) => (
                      <div
                        key={i}
                        className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : msg.role === "system"
                              ? "bg-muted text-muted-foreground"
                              : "bg-card border"
                          }`}
                        >
                          {msg.content}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            ) : (
              <>
                {(!sessions || (sessions as any[]).length === 0) && (
                  <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                      コーチング履歴がありません。
                    </CardContent>
                  </Card>
                )}
                {(sessions as any[] ?? []).map((s: any) => (
                  <Card
                    key={s.id}
                    className="cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => setViewingSessionId(s.id)}
                  >
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <MessageSquare className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <p className="font-semibold text-sm">{s.twinName || twinName}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                              <Clock className="h-3 w-3" />
                              <span>{s.createdAt ? new Date(s.createdAt).toLocaleDateString("ja-JP") : "---"}</span>
                              <span>{s.messageCount ?? 0}メッセージ</span>
                            </div>
                          </div>
                        </div>
                        <Badge variant={s.status === "active" ? "default" : "secondary"}>
                          {s.status === "active" ? "進行中" : "完了"}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
