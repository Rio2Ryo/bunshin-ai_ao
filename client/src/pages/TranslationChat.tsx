import { useState, useRef, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Languages, Send, ThumbsUp, ThumbsDown, MessageSquare, Globe, Loader2 } from "lucide-react";

const LANGUAGE_OPTIONS = [
  { value: "ja", label: "日本語" },
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
  { value: "ko", label: "한국어" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
] as const;

const LANG_MAP: Record<string, string> = {
  ja: "日本語",
  en: "English",
  zh: "中文",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
};

export default function TranslationChat() {
  usePageMeta({ title: "翻訳チャット", description: "リアルタイム翻訳チャット", path: "/translation-chat" });

  const [activeTab, setActiveTab] = useState("chat");
  const [selectedFriend, setSelectedFriend] = useState<string>("");
  const [userLang, setUserLang] = useState("ja");
  const [friendLang, setFriendLang] = useState("en");
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const friendsQuery = trpc.friends.list.useQuery();
  const sessionListQuery = trpc.matching.listTranslationChats.useQuery();
  const messagesQuery = trpc.matching.getTranslationChatMessages.useQuery(
    { sessionId: activeSessionId! },
    { enabled: !!activeSessionId, refetchInterval: 5000 }
  );

  const createMutation = trpc.matching.createTranslationChat.useMutation({
    onSuccess: (data: any) => {
      setActiveSessionId(data.id ?? data.sessionId);
      toast.success("翻訳チャットを開始しました");
    },
    onError: (err: any) => toast.error(err.message || "作成に失敗しました"),
  });

  const sendMutation = trpc.matching.sendTranslationMessage.useMutation({
    onSuccess: () => {
      setMessageInput("");
      messagesQuery.refetch();
    },
    onError: (err: any) => toast.error(err.message || "送信に失敗しました"),
  });

  const rateMutation = trpc.matching.rateTranslation.useMutation({
    onSuccess: () => {
      messagesQuery.refetch();
    },
    onError: (err: any) => toast.error(err.message || "評価に失敗しました"),
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQuery.data]);

  const handleCreateSession = () => {
    if (!selectedFriend) {
      toast.error("友達を選択してください");
      return;
    }
    createMutation.mutate({
      friendId: Number(selectedFriend),
      userLang,
      friendLang,
    });
  };

  const handleSendMessage = () => {
    if (!activeSessionId || !messageInput.trim()) return;
    sendMutation.mutate({
      sessionId: activeSessionId,
      text: messageInput.trim(),
    });
  };

  const handleRate = (messageId: number, rating: "up" | "down") => {
    rateMutation.mutate({ messageId, rating });
  };

  const friends = friendsQuery.data ?? [];
  const sessions = sessionListQuery.data ?? [];
  const messages: any[] = (messagesQuery.data as any[]) ?? [];

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/20">
            <Languages className="h-6 w-6 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">翻訳チャット</h1>
            <p className="text-sm text-muted-foreground">リアルタイム翻訳付きチャット</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="chat">
              <MessageSquare className="h-4 w-4 mr-1" />
              チャット
            </TabsTrigger>
            <TabsTrigger value="sessions">
              <Globe className="h-4 w-4 mr-1" />
              セッション一覧
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Chat */}
          <TabsContent value="chat" className="space-y-4">
            {!activeSessionId ? (
              <Card>
                <CardHeader>
                  <CardTitle>新しい翻訳チャット</CardTitle>
                  <CardDescription>友達と言語ペアを選んでチャットを開始</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">友達</label>
                    <Select value={selectedFriend} onValueChange={setSelectedFriend}>
                      <SelectTrigger>
                        <SelectValue placeholder="友達を選択" />
                      </SelectTrigger>
                      <SelectContent>
                        {(friends as any[]).map((f: any) => (
                          <SelectItem key={f.friendId || f.id} value={String(f.friendId || f.id)}>
                            {f.friendName || f.displayName || "友達"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">あなたの言語</label>
                      <Select value={userLang} onValueChange={setUserLang}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LANGUAGE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">相手の言語</label>
                      <Select value={friendLang} onValueChange={setFriendLang}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LANGUAGE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button
                    onClick={handleCreateSession}
                    disabled={createMutation.isPending || !selectedFriend}
                    className="w-full"
                  >
                    {createMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Languages className="h-4 w-4 mr-2" />
                    )}
                    チャット開始
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card className="flex flex-col h-[calc(100vh-280px)] min-h-[400px]">
                <CardHeader className="pb-2 flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">翻訳チャット</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{LANG_MAP[userLang] || userLang}</Badge>
                      <span className="text-muted-foreground">↔</span>
                      <Badge variant="outline">{LANG_MAP[friendLang] || friendLang}</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setActiveSessionId(null);
                          setMessageInput("");
                        }}
                      >
                        戻る
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto space-y-3 pb-2">
                  {messages.length === 0 && (
                    <div className="text-center text-muted-foreground py-8">
                      <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">メッセージを送信してチャットを開始</p>
                    </div>
                  )}
                  {messages.map((msg: any) => {
                    const isSelf = msg.userId === undefined || msg.sender === "self";
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isSelf ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                            isSelf
                              ? "bg-blue-600/20 text-blue-100 border border-blue-500/30"
                              : "bg-muted text-muted-foreground border border-border"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-[10px] px-1 py-0">
                              {LANG_MAP[msg.originalLang] || msg.originalLang || "auto"}
                            </Badge>
                          </div>
                          <p className="text-sm leading-relaxed">{msg.originalText}</p>
                          {msg.translatedText && (
                            <p className="text-xs text-muted-foreground mt-1 pt-1 border-t border-border/50 leading-relaxed">
                              <Badge variant="outline" className="text-[10px] px-1 py-0 mr-1">
                                {LANG_MAP[msg.targetLang] || msg.targetLang || ""}
                              </Badge>
                              {msg.translatedText}
                            </p>
                          )}
                          <div className="flex items-center gap-1 mt-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`h-6 w-6 p-0 ${msg.qualityRating === "up" ? "text-green-400" : "text-muted-foreground"}`}
                              onClick={() => handleRate(msg.id, "up")}
                            >
                              <ThumbsUp className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`h-6 w-6 p-0 ${msg.qualityRating === "down" ? "text-red-400" : "text-muted-foreground"}`}
                              onClick={() => handleRate(msg.id, "down")}
                            >
                              <ThumbsDown className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </CardContent>
                <div className="p-3 border-t flex gap-2 flex-shrink-0">
                  <Input
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    placeholder="メッセージを入力..."
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={sendMutation.isPending || !messageInput.trim()}
                    size="icon"
                  >
                    {sendMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </Card>
            )}
          </TabsContent>

          {/* Tab 2: Session List */}
          <TabsContent value="sessions" className="space-y-4">
            {sessions.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>まだ翻訳チャットセッションがありません</p>
                </CardContent>
              </Card>
            ) : (
              (sessions as any[]).map((s: any) => (
                <Card
                  key={s.id}
                  className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => {
                    setActiveSessionId(s.id);
                    if (s.userLang) setUserLang(s.userLang);
                    if (s.friendLang) setFriendLang(s.friendLang);
                    setActiveTab("chat");
                  }}
                >
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-medium">{s.friendName || "友達"}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs">
                            {LANG_MAP[s.userLang] || s.userLang}
                          </Badge>
                          <span className="text-xs text-muted-foreground">↔</span>
                          <Badge variant="outline" className="text-xs">
                            {LANG_MAP[s.friendLang] || s.friendLang}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">
                          {s.messageCount ?? 0} メッセージ
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {s.createdAt ? new Date(s.createdAt).toLocaleDateString("ja-JP") : ""}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
