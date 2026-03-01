import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useParams, Link, useLocation } from "wouter";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Bot, Send, Loader2, Plus, MessageSquare, User, MoreVertical, Pencil, Trash2, Check, X, ChevronDown, Clock } from "lucide-react";
import { LazyStreamdown as Streamdown } from "@/components/LazyStreamdown";

function formatTime(dateStr?: string | null) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function TypingDots() {
  return (
    <div className="flex gap-1 items-center h-5">
      <span className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
    </div>
  );
}

export default function Chat() {
  usePageMeta({ title: "チャット", description: "分身AIとのチャット", path: "/chat" });
  const { sessionId } = useParams<{ sessionId?: string }>();
  const [, navigate] = useLocation();

  const { data: myTwin } = trpc.myTwin.get.useQuery();
  const { data: sessions, refetch: refetchSessions } = trpc.chat.sessions.useQuery();
  const { data: sessionData } = trpc.chat.getSession.useQuery(
    { id: parseInt(sessionId || "0") },
    { enabled: !!sessionId }
  );

  const createSession = trpc.chat.createSession.useMutation();
  const sendMessage = trpc.chat.sendMessage.useMutation();
  const deleteSession = trpc.chat.deleteSession.useMutation();
  const renameSession = trpc.chat.renameSession.useMutation();

  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Array<{ role: string; content: string; createdAt?: string }>>([]);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [mobileSessionOpen, setMobileSessionOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sessionId) {
      setCurrentSessionId(parseInt(sessionId));
    }
  }, [sessionId]);

  useEffect(() => {
    if (sessionData?.messages) {
      setMessages(sessionData.messages.map((m: any) => ({ role: m.role, content: m.content, createdAt: m.createdAt })));
    }
  }, [sessionData]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sendMessage.isPending]);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus input after assistant responds
  useEffect(() => {
    if (!sendMessage.isPending && inputRef.current) {
      inputRef.current.focus();
    }
  }, [sendMessage.isPending]);

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
      setMobileSessionOpen(false);
      navigate(`/chat/${result.id}`);
    } catch {
      toast.error("チャットの開始に失敗しました");
    }
  };

  const handleSendMessage = async () => {
    if (!message.trim() || !currentSessionId) return;

    const userMessage = message.trim();
    setMessage("");
    const now = new Date().toISOString();
    setMessages((prev) => [...prev, { role: "user", content: userMessage, createdAt: now }]);

    try {
      const result = await sendMessage.mutateAsync({
        sessionId: currentSessionId,
        content: userMessage,
      });
      setMessages((prev) => [...prev, { role: "assistant", content: result.response, createdAt: new Date().toISOString() }]);
      // Refresh sessions to pick up auto-title
      refetchSessions();
    } catch {
      toast.error("メッセージの送信に失敗しました");
      setMessages((prev) => prev.slice(0, -1));
    }
  };

  const handleDelete = async (id: number) => {
    setMenuOpenId(null);
    try {
      await deleteSession.mutateAsync({ id });
      refetchSessions();
      if (currentSessionId === id) {
        setCurrentSessionId(null);
        setMessages([]);
        navigate("/chat");
      }
      toast.success("チャットを削除しました");
    } catch {
      toast.error("削除に失敗しました");
    }
  };

  const handleStartRename = (id: number, currentTitle: string) => {
    setMenuOpenId(null);
    setRenamingId(id);
    setRenameTitle(currentTitle || "");
  };

  const handleRename = async () => {
    if (!renamingId || !renameTitle.trim()) return;
    try {
      await renameSession.mutateAsync({ id: renamingId, title: renameTitle.trim() });
      refetchSessions();
      setRenamingId(null);
      toast.success("名前を変更しました");
    } catch {
      toast.error("名前変更に失敗しました");
    }
  };

  const handleCancelRename = () => {
    setRenamingId(null);
    setRenameTitle("");
  };

  const renderSessionItem = (session: { id: number; title?: string | null; messageCount?: number }) => {
    const isRenaming = renamingId === session.id;
    const isActive = currentSessionId === session.id;

    if (isRenaming) {
      return (
        <div key={session.id} className="flex items-center gap-1 p-1">
          <Input
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            className="h-7 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") handleCancelRename();
            }}
          />
          <Button size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0" onClick={handleRename}>
            <Check className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0" onClick={handleCancelRename}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      );
    }

    return (
      <div key={session.id} className="relative group">
        <Link href={`/chat/${session.id}`} onClick={() => setMobileSessionOpen(false)}>
          <div
            className={`p-2 rounded-lg cursor-pointer transition-colors pr-8 ${
              isActive ? "bg-primary/20 text-primary" : "hover:bg-muted"
            }`}
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="text-sm truncate block">{session.title || "チャット"}</span>
                {session.messageCount != null && session.messageCount > 0 && (
                  <span className="text-[10px] text-muted-foreground">{session.messageCount}件</span>
                )}
              </div>
            </div>
          </div>
        </Link>
        <div className="absolute right-1 top-1/2 -translate-y-1/2">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpenId(menuOpenId === session.id ? null : session.id);
            }}
            aria-label="チャットメニュー"
            aria-expanded={menuOpenId === session.id}
          >
            <MoreVertical className="h-3 w-3" aria-hidden="true" />
          </Button>
          {menuOpenId === session.id && (
            <div ref={menuRef} className="absolute right-0 top-full mt-1 z-50 bg-popover border rounded-md shadow-md py-1 min-w-[120px]" role="menu">
              <button
                className="flex items-center gap-2 px-3 py-1.5 text-sm w-full hover:bg-muted text-left"
                onClick={(e) => { e.stopPropagation(); handleStartRename(session.id, session.title || ""); }}
                role="menuitem"
              >
                <Pencil className="h-3 w-3" aria-hidden="true" /> 名前変更
              </button>
              <button
                className="flex items-center gap-2 px-3 py-1.5 text-sm w-full hover:bg-muted text-left text-destructive"
                onClick={(e) => { e.stopPropagation(); handleDelete(session.id); }}
                role="menuitem"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" /> 削除
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-8rem)] flex gap-4" role="main" aria-label="チャット">
        {/* Sidebar - Sessions (desktop) */}
        <div className="w-64 flex-shrink-0 hidden lg:block" role="complementary" aria-label="チャット履歴">
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">チャット履歴</CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              <ScrollArea className="h-[calc(100vh-14rem)]">
                <div className="space-y-1">
                  {sessions?.map((session) => renderSessionItem(session as any))}
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
            {/* Mobile session selector */}
            <div className="lg:hidden mt-2 relative">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-between text-sm"
                onClick={() => setMobileSessionOpen(!mobileSessionOpen)}
              >
                <span className="flex items-center gap-2 truncate">
                  <MessageSquare className="h-4 w-4 flex-shrink-0" />
                  {currentSessionId
                    ? sessions?.find((s) => s.id === currentSessionId)?.title || "チャット"
                    : "セッションを選択"}
                </span>
                <ChevronDown className={`h-4 w-4 flex-shrink-0 transition-transform ${mobileSessionOpen ? "rotate-180" : ""}`} />
              </Button>
              {mobileSessionOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover border rounded-md shadow-md max-h-60 overflow-y-auto">
                  <div className="p-1 space-y-1">
                    {sessions?.map((session) => renderSessionItem(session as any))}
                    {(!sessions || sessions.length === 0) && (
                      <p className="text-sm text-muted-foreground p-2 text-center">チャット履歴なし</p>
                    )}
                  </div>
                </div>
              )}
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
                  <div className="space-y-4" role="log" aria-label="チャットメッセージ" aria-live="polite">
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
                        <div className={`max-w-[70%] ${msg.role === "user" ? "text-right" : ""}`}>
                          <div
                            className={`rounded-lg p-3 ${
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
                          {msg.createdAt && (
                            <span className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-0.5">
                              <Clock className="h-2.5 w-2.5" />
                              {formatTime(msg.createdAt)}
                            </span>
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
                          <TypingDots />
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
                      ref={inputRef}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="メッセージを入力..."
                      disabled={sendMessage.isPending}
                      aria-label="メッセージ入力"
                    />
                    <Button type="submit" disabled={!message.trim() || sendMessage.isPending} aria-label="送信">
                      {sendMessage.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Send className="h-4 w-4" aria-hidden="true" />
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
