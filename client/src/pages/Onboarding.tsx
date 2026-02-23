import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Bot, Send, Loader2, SkipForward, ArrowRight, MessageSquare, Users, Shield, Sparkles, Zap, Target } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

const ONBOARDING_STEPS = [
  { label: "サービス概要", icon: Sparkles },
  { label: "機能説明", icon: Zap },
  { label: "マッチング説明", icon: Target },
  { label: "NPC紹介", icon: MessageSquare },
  { label: "自己紹介", icon: Users },
];

export default function Onboarding() {
  const [, navigate] = useLocation();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [step, setStep] = useState(0);
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
  const { data: friends } = trpc.friends.list.useQuery(undefined, { enabled: !!me });

  const sendMessage = trpc.chat.sendMessage.useMutation();
  const completeMutation = trpc.onboarding.complete.useMutation();
  const utils = trpc.useUtils();

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

  useEffect(() => {
    const stored = sessionStorage.getItem("onboardingSessionId");
    if (stored) {
      setSessionId(parseInt(stored));
    } else if (onboardingSession) {
      setSessionId(onboardingSession.id);
      sessionStorage.setItem("onboardingSessionId", String(onboardingSession.id));
    }
  }, [onboardingSession]);

  useEffect(() => {
    if (sessionData?.messages) {
      setMessages(sessionData.messages.map((m) => ({ role: m.role, content: m.content })));
      const userMsgCount = sessionData.messages.filter((m) => m.role === "user").length;
      if (userMsgCount > 0 && step < 4) {
        setStep(4);
      }
    }
  }, [sessionData]);

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
      setTimeout(() => navigate("/dashboard"), 2000);
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

  const npcFriends = friends?.filter((f) => f.friend.isNpc) || [];

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
        <div className="flex items-center gap-1">
          {ONBOARDING_STEPS.map((s, i) => (
            <div key={s.label} className="flex-1 flex flex-col items-center gap-1">
              <div
                className={`h-1.5 w-full rounded-full transition-colors ${
                  i <= step ? "bg-primary" : "bg-muted"
                }`}
              />
              <span className={`text-[10px] hidden sm:block ${i <= step ? "text-primary" : "text-muted-foreground"}`}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Step 0: サービス概要 */}
      {step === 0 && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-lg w-full space-y-8 text-center">
            <div className="relative mx-auto w-24 h-24">
              <div className="w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center">
                <Bot className="h-12 w-12 text-primary" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center border-2 border-background">
                <Sparkles className="h-4 w-4 text-green-500" />
              </div>
            </div>

            <div className="space-y-3">
              <h1 className="text-3xl font-bold">
                <span className="text-gradient">分身AI</span>へようこそ！
              </h1>
              <p className="text-muted-foreground text-base leading-relaxed">
                あなた専用の「デジタル分身AI」を作成し、<br />
                ビジネスマッチングを自動で行うサービスです。
              </p>
            </div>

            <Card className="border-primary/20 bg-primary/5 text-left">
              <CardContent className="p-5 space-y-3">
                <p className="font-medium text-sm">分身AIとは？</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  あなたの性格・スキル・経験を学んだAIが、あなたの代わりにビジネスパートナー候補と対話します。
                  相性が良いパートナーを自動で見つけてくれるので、効率的にネットワークを広げられます。
                </p>
              </CardContent>
            </Card>

            <Button size="lg" onClick={() => setStep(1)} className="w-full max-w-xs mx-auto">
              次へ
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 1: 機能説明 */}
      {step === 1 && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-lg w-full space-y-6 text-center">
            <Zap className="h-10 w-10 text-primary mx-auto" />
            <h2 className="text-2xl font-bold">主な機能</h2>

            <div className="grid gap-3 text-left">
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="flex items-start gap-3 p-4">
                  <Bot className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">分身AI作成</p>
                    <p className="text-xs text-muted-foreground">会話を通じてあなたの分身AIが自動で完成します</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="flex items-start gap-3 p-4">
                  <MessageSquare className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">AIチャット</p>
                    <p className="text-xs text-muted-foreground">自分の分身AIといつでも会話して育てられます</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="flex items-start gap-3 p-4">
                  <Shield className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">信頼度スコア</p>
                    <p className="text-xs text-muted-foreground">活動に応じてスコアが上がり、より多くの機能が使えます</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Button size="lg" onClick={() => setStep(2)} className="w-full max-w-xs mx-auto">
              次へ
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: マッチング説明 */}
      {step === 2 && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-lg w-full space-y-6 text-center">
            <Target className="h-10 w-10 text-primary mx-auto" />
            <h2 className="text-2xl font-bold">ビジネスマッチング</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              分身AI同士が自動で対話し、ビジネスの相性を分析します。
            </p>

            <div className="space-y-4 text-left">
              <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/30">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-sm font-bold text-primary">1</span>
                </div>
                <div>
                  <p className="font-medium text-sm">友達を追加</p>
                  <p className="text-xs text-muted-foreground">フレンドコードで友達を追加、または発見ページで探す</p>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/30">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-sm font-bold text-primary">2</span>
                </div>
                <div>
                  <p className="font-medium text-sm">マッチング開始</p>
                  <p className="text-xs text-muted-foreground">テーマを設定すると分身AI同士が対話を始めます</p>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/30">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-sm font-bold text-primary">3</span>
                </div>
                <div>
                  <p className="font-medium text-sm">結果を確認</p>
                  <p className="text-xs text-muted-foreground">相性スコアと具体的な提案をレポートでお届けします</p>
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              信頼度スコア30以上で実ユーザーとのマッチングが解放されます
            </p>

            <Button size="lg" onClick={() => setStep(3)} className="w-full max-w-xs mx-auto">
              次へ
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: NPC紹介 */}
      {step === 3 && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-lg w-full space-y-6 text-center">
            <Users className="h-10 w-10 text-primary mx-auto" />
            <h2 className="text-2xl font-bold">ガイドキャラクター紹介</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              2人のガイドが友達として追加されました。<br />
              チュートリアルとしてマッチング練習ができます。
            </p>

            <div className="grid gap-3 text-left">
              {npcFriends.length > 0 ? npcFriends.map((f) => (
                <Card key={f.friend.id} className="border-muted">
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-500 to-purple-500 flex items-center justify-center shrink-0">
                      <span className="text-white font-bold text-lg">{f.friend.name?.charAt(0)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{f.friend.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {f.twin?.description?.slice(0, 60) || "ガイドキャラクター"}
                      </p>
                    </div>
                    <span className="text-xs text-primary bg-primary/10 px-2 py-1 rounded-full shrink-0">ガイド</span>
                  </CardContent>
                </Card>
              )) : (
                <Card className="border-muted">
                  <CardContent className="p-4 text-center text-sm text-muted-foreground">
                    ガイドキャラクターを準備中...
                  </CardContent>
                </Card>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              チャットページにガイドからのメッセージが届いています。<br />
              次のステップであなた自身の情報を入力しましょう。
            </p>

            <Button size="lg" onClick={() => setStep(4)} className="w-full max-w-xs mx-auto">
              自己紹介へ進む
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Profile chat */}
      {step === 4 && (
        <>
          <div className="flex-1 overflow-hidden max-w-3xl mx-auto w-full">
            <div ref={scrollRef} className="h-full overflow-y-auto px-4 pb-4 space-y-4">
              {messages.length === 0 && !sessionId && (
                <div className="flex justify-center pt-8">
                  <div className="text-center space-y-2">
                    <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
                    <p className="text-sm text-muted-foreground">セッションを読み込んでいます...</p>
                  </div>
                </div>
              )}
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
        </>
      )}
    </div>
  );
}
