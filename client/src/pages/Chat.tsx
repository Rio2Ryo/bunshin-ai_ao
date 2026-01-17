import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { useParams, useSearch, Link } from "wouter";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Bot, Send, Loader2, Plus, MessageSquare, User } from "lucide-react";
import { Streamdown } from "streamdown";

export default function Chat() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const twinIdFromQuery = searchParams.get("twinId");

  const { data: twins } = trpc.twins.list.useQuery();
  const { data: sessions, refetch: refetchSessions } = trpc.chat.sessions.useQuery();
  const { data: sessionData, refetch: refetchSession } = trpc.chat.getSession.useQuery(
    { id: parseInt(sessionId || "0") },
    { enabled: !!sessionId }
  );

  const createSession = trpc.chat.createSession.useMutation();
  const sendMessage = trpc.chat.sendMessage.useMutation();

  const [selectedTwinId, setSelectedTwinId] = useState<string>("");
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (twinIdFromQuery) {
      setSelectedTwinId(twinIdFromQuery);
    }
  }, [twinIdFromQuery]);

  useEffect(() => {
    if (sessionId) {
      setCurrentSessionId(parseInt(sessionId));
    }
  }, [sessionId]);

  useEffect(() => {
    if (sessionData?.messages) {
      setMessages(sessionData.messages.map((m) => ({ role: m.role, content: m.content })));
    }
  }, [sessionData]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleStartChat = async () => {
    if (!selectedTwinId) {
      toast.error("分身AIを選択してください");
      return;
    }

    try {
      const result = await createSession.mutateAsync({
        twinId: parseInt(selectedTwinId),
      });
      setCurrentSessionId(result.id);
      setMessages([]);
      refetchSessions();
      toast.success("チャットを開始しました");
    } catch (error) {
      toast.error("チャットの開始に失敗しました");
    }
  };

  const handleSendMessage = async () => {
    if (!message.trim() || !currentSessionId) return;

    const userMessage = message.trim();
    setMessage("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    try {
      const result = await sendMessage.mutateAsync({
        sessionId: currentSessionId,
        content: userMessage,
      });
      setMessages((prev) => [...prev, { role: "assistant", content: result.response }]);
    } catch (error) {
      toast.error("メッセージの送信に失敗しました");
      setMessages((prev) => prev.slice(0, -1));
    }
  };

  const currentTwin = twins?.find((t) => t.id === (sessionData?.session?.twinId || parseInt(selectedTwinId)));

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-8rem)] flex gap-4">
        {/* Sidebar - Sessions */}
        <div className="w-64 flex-shrink-0 hidden lg:block">
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">チャット履歴</CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              <ScrollArea className="h-[calc(100vh-14rem)]">
                <div className="space-y-1">
                  {sessions?.map((session) => (
                    <Link key={session.id} href={`/chat/${session.id}`}>
                      <div
                        className={`p-2 rounded-lg cursor-pointer transition-colors ${
                          currentSessionId === session.id
                            ? "bg-primary/20 text-primary"
                            : "hover:bg-muted"
                        }`}
                      >
                        <p className="text-sm font-medium truncate">{session.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(session.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Main Chat Area */}
        <Card className="flex-1 flex flex-col">
          <CardHeader className="border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {currentTwin ? (
                  <>
                    <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <Bot className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{currentTwin.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">分身AIとチャット</p>
                    </div>
                  </>
                ) : (
                  <CardTitle>新しいチャット</CardTitle>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex-1 flex flex-col p-0">
            {!currentSessionId ? (
              /* Start New Chat */
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="text-center max-w-md">
                  <MessageSquare className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-xl font-semibold mb-2">分身AIとチャット</h3>
                  <p className="text-muted-foreground mb-6">
                    分身AIを選択してチャットを開始しましょう。
                  </p>
                  <div className="space-y-4">
                    <Select value={selectedTwinId} onValueChange={setSelectedTwinId}>
                      <SelectTrigger>
                        <SelectValue placeholder="分身AIを選択" />
                      </SelectTrigger>
                      <SelectContent>
                        {twins?.map((twin) => (
                          <SelectItem key={twin.id} value={String(twin.id)}>
                            {twin.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={handleStartChat}
                      disabled={!selectedTwinId || createSession.isPending}
                      className="w-full"
                    >
                      {createSession.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      <Plus className="h-4 w-4 mr-2" />
                      チャットを開始
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Messages */}
                <ScrollArea ref={scrollRef} className="flex-1 p-4">
                  <div className="space-y-4 max-w-3xl mx-auto">
                    {messages.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-muted-foreground">
                          メッセージを送信して会話を始めましょう
                        </p>
                      </div>
                    ) : (
                      messages.map((msg, i) => (
                        <div
                          key={i}
                          className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
                        >
                          {msg.role !== "user" && (
                            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                              <Bot className="h-4 w-4 text-primary" />
                            </div>
                          )}
                          <div
                            className={`rounded-lg p-3 max-w-[80%] ${
                              msg.role === "user"
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted"
                            }`}
                          >
                            {msg.role === "user" ? (
                              <p className="whitespace-pre-wrap">{msg.content}</p>
                            ) : (
                              <Streamdown>{msg.content}</Streamdown>
                            )}
                          </div>
                          {msg.role === "user" && (
                            <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                              <User className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                      ))
                    )}
                    {sendMessage.isPending && (
                      <div className="flex gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                          <Bot className="h-4 w-4 text-primary" />
                        </div>
                        <div className="rounded-lg p-3 bg-muted">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>

                {/* Input */}
                <div className="p-4 border-t">
                  <div className="max-w-3xl mx-auto flex gap-2">
                    <Input
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="メッセージを入力..."
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                      disabled={sendMessage.isPending}
                    />
                    <Button
                      onClick={handleSendMessage}
                      disabled={!message.trim() || sendMessage.isPending}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
