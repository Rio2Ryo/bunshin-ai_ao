import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Bot, Send, Loader2, SkipForward } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

const STEPS = [
  "仕事・スキル",
  "経験・実績",
  "興味・趣味",
  "性格・価値観",
  "確認",
];

export default function Onboarding() {
  const [, navigate] = useLocation();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [completing, setCompleting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: me, isLoading: meLoading } = trpc.auth.me.useQuery();
  const { data: onboardingSession } = trpc.onboarding.getSession.useQuery(undefined, {
    enabled: !!me,
  });
  const { data: sessionData } = trpc.chat.getSession.useQuery(
    { id: sessionId! },
    { enabled: !!sessionId }
  );

  const sendMessage = trpc.chat.sendMessage.useMutation();
  const completeMutation = trpc.onboarding.complete.useMutation();
  const utils = trpc.useUtils();

  // Redirect if not logged in or already completed
  useEffect(() => {
    if (meLoading) return;
    if (!me) {
      navigate("/login");
      return;
    }
    if ((me as any).onboardingCompleted === 1) {
      navigate("/dashboard");
    }
  }, [me, meLoading, navigate]);

  // Get session ID from sessionStorage or onboarding query
  useEffect(() => {
    const stored = sessionStorage.getItem("onboardingSessionId");
    if (stored) {
      setSessionId(parseInt(stored));
    } else if (onboardingSession) {
      setSessionId(onboardingSession.id);
      sessionStorage.setItem("onboardingSessionId", String(onboardingSession.id));
    }
  }, [onboardingSession]);

  // Load existing messages
  useEffect(() => {
    if (sessionData?.messages) {
      setMessages(sessionData.messages.map((m) => ({ role: m.role, content: m.content })));
      // Estimate current step from message count
      const userMsgCount = sessionData.messages.filter((m) => m.role === "user").length;
      setCurrentStep(Math.min(Math.floor(userMsgCount / 2) + 1, 5));
    }
  }, [sessionData]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleProfileData = useCallback(async (content: string) => {
    const match = content.match(/---PROFILE_DATA---([\s\S]*?)---END_PROFILE_DATA---/);
    if (!match) return false;

    try {
      const data = JSON.parse(match[1].trim());
      setCompleting(true);
      await completeMutation.mutateAsync({
        description: data.description || "",
        personality: data.personality || "",
        rawInput: data.rawInput || "",
      });
      sessionStorage.removeItem("onboardingSessionId");
      await utils.auth.me.invalidate();
      toast.success("分身AIのプロフィールが完成しました！");
      // Short delay for the toast to show
      setTimeout(() => navigate("/dashboard"), 1500);
      return true;
    } catch {
      toast.error("プロフィールの保存に失敗しました");
      setCompleting(false);
      return false;
    }
  }, [completeMutation, navigate, utils]);

  const handleSend = async () => {
    if (!message.trim() || !sessionId || sendMessage.isPending) return;

    const userMessage = message.trim();
    setMessage("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    try {
      const result = await sendMessage.mutateAsync({
        sessionId,
        content: userMessage,
      });
      setMessages((prev) => [...prev, { role: "assistant", content: result.response }]);

      // Update step estimate
      setCurrentStep((prev) => Math.min(prev + 1, 5));

      // Check for profile data completion
      await handleProfileData(result.response);
    } catch {
      toast.error("メッセージの送信に失敗しました");
    }
  };

  const handleSkip = async () => {
    try {
      await completeMutation.mutateAsync({});
      sessionStorage.removeItem("onboardingSessionId");
      await utils.auth.me.invalidate();
      navigate("/dashboard");
    } catch {
      toast.error("スキップに失敗しました");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (meLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (completing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <div className="relative">
          <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center animate-pulse">
            <Bot className="h-10 w-10 text-primary" />
          </div>
        </div>
        <p className="text-lg font-medium">分身AIを作成中...</p>
        <p className="text-sm text-muted-foreground">プロフィールを保存しています</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <span className="font-semibold text-gradient">分身AI セットアップ</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSkip} className="text-muted-foreground">
            <SkipForward className="h-4 w-4 mr-1" />
            スキップ
          </Button>
        </div>
      </header>

      {/* Progress bar */}
      <div className="max-w-3xl mx-auto w-full px-4 py-3">
        <div className="flex items-center gap-2">
          {STEPS.map((step, i) => (
            <div key={step} className="flex-1 flex flex-col items-center gap-1">
              <div
                className={`h-1.5 w-full rounded-full transition-colors ${
                  i < currentStep ? "bg-primary" : "bg-muted"
                }`}
              />
              <span className={`text-[10px] hidden sm:block ${i < currentStep ? "text-primary" : "text-muted-foreground"}`}>
                {step}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-hidden max-w-3xl mx-auto w-full">
        <div ref={scrollRef} className="h-full overflow-y-auto px-4 pb-4 space-y-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {msg.role === "assistant" && (
                  <div className="flex items-center gap-2 mb-1">
                    <Bot className="h-3 w-3" />
                    <span className="text-xs font-medium">分身AI</span>
                  </div>
                )}
                <p className="text-sm whitespace-pre-wrap">
                  {msg.content.replace(/---PROFILE_DATA---[\s\S]*?---END_PROFILE_DATA---/, "").trim()}
                </p>
              </div>
            </div>
          ))}
          {sendMessage.isPending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">考え中...</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input area */}
      <div className="border-t bg-background/95 backdrop-blur sticky bottom-0">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex gap-2">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="メッセージを入力..."
              disabled={sendMessage.isPending || !sessionId}
              className="flex-1"
            />
            <Button
              onClick={handleSend}
              disabled={!message.trim() || sendMessage.isPending || !sessionId}
              size="icon"
            >
              {sendMessage.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
