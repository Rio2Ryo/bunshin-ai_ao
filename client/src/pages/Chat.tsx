import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { useParams, Link } from "wouter";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Bot, Send, Loader2, Plus, MessageSquare, User } from "lucide-react";
import { Streamdown } from "streamdown";

export default function Chat() {
  const { sessionId } = useParams<{ sessionId?: string }>();

  const { data: myTwin } = trpc.myTwin.get.useQuery();
  const { data: sessions, refetch: refetchSessions } = trpc.chat.sessions.useQuery();
  const { data: sessionData, refetch: refetchSession } = trpc.chat.getSession.useQuery(
    { id: parseInt(sessionId || "0") },
    { enabled: !!sessionId }
  );

  const createSession = trpc.chat.createSession.useMutation();
  const sendMessage = trpc.chat.sendMessage.useMutation();

  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);

  const scrollRef = useRef<HTMLDivElement>(null);

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
    if (!myTwin) {
      toast.error("まず分身AIを作成してください");
      return;
    }

    try {
      const result = await createSession.mutateAsync({
        title: `${myTwin.name}とのチャット`,
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
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-4 w-4" />
                          <span className="text-sm truncate">
                            {session.title || "チャット"}
                          </span>
                        </div>
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
          <CardHeader className="pb-2 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">
                  {myTwin ? `${myTwin.name}とチャット` : "分身AIチャット"}
                </CardTitle>
              </div>
              <Button size="sm" onClick={handleStartChat} disabled={!myTwin}>
                <Plus className="h-4 w-4 mr-1" />
                新規チャット
              </Button>
            </div>
          </CardHeader>

          <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
            {!myTwin ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <Bot className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">分身AIを作成してください</h3>
                  <p className="text-muted-foreground mb-4">
                    チャットを始めるには、まず分身AIを作成する必要があります
                  </p>
                  <Link href="/twins">
                    <Button>分身AIを作成</Button>
                  </Link>
                </div>
              </div>
            ) : !currentSessionId ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <MessageSquare className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">チャットを始めましょう</h3>
                  <p className="text-muted-foreground mb-4">
                    あなたの分身AI「{myTwin.name}」と会話できます
                  </p>
                  <Button onClick={handleStartChat}>
                    <Plus className="h-4 w-4 mr-2" />
                    新規チャット
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {/* Messages */}
                <ScrollArea className="flex-1 p-4" ref={scrollRef}>
                  <div className="space-y-4">
                    {messages.map((msg, index) => (
                      <div
                        key={index}
                        className={`flex gap-3 ${
                          msg.role === "user" ? "justify-end" : "justify-start"
                        }`}
                      >
                        {msg.role !== "user" && (
                          <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                            <Bot className="h-4 w-4 text-primary" />
                          </div>
                        )}
                        <div
                          className={`max-w-[70%] rounded-lg p-3 ${
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          }`}
                        >
                          {msg.role === "user" ? (
                            <p>{msg.content}</p>
                          ) : (
                            <Streamdown>{msg.content}</Streamdown>
                          )}
                        </div>
                        {msg.role === "user" && (
                          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                            <User className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                    ))}
                    {sendMessage.isPending && (
                      <div className="flex gap-3 justify-start">
                        <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                          <Bot className="h-4 w-4 text-primary" />
                        </div>
                        <div className="bg-muted rounded-lg p-3">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>

                {/* Input */}
                <div className="p-4 border-t">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSendMessage();
                    }}
                    className="flex gap-2"
                  >
                    <Input
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="メッセージを入力..."
                      disabled={sendMessage.isPending}
                    />
                    <Button type="submit" disabled={!message.trim() || sendMessage.isPending}>
                      {sendMessage.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </form>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
