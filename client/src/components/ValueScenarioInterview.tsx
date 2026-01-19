import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Send, Loader2, CheckCircle2, MessageSquare, Target } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ValueScenarioInterviewProps {
  onComplete?: () => void;
}

export function ValueScenarioInterview({ onComplete }: ValueScenarioInterviewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [currentScenarioIndex, setCurrentScenarioIndex] = useState(0);
  const [totalScenarios, setTotalScenarios] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const interviewMutation = trpc.myTwin.valueScenarioInterview.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);
      setIsComplete(data.isComplete);
      setCurrentScenarioIndex(data.currentScenarioIndex);
      setTotalScenarios(data.totalScenarios);

      if (data.isComplete) {
        toast.success("価値観シナリオへの回答が完了しました！");
        onComplete?.();
      }
    },
    onError: (error) => {
      toast.error(`エラーが発生しました: ${error.message}`);
    },
  });

  const progressQuery = trpc.myTwin.getScenarioProgress.useQuery();

  // 進捗データを取得したら状態を更新
  useEffect(() => {
    if (progressQuery.data) {
      setCurrentScenarioIndex(progressQuery.data.completed);
      setTotalScenarios(progressQuery.data.total);
    }
  }, [progressQuery.data]);

  // インタビュー開始
  const startInterview = () => {
    interviewMutation.mutate({
      previousMessages: [],
    });
  };

  // メッセージ送信
  const sendMessage = () => {
    if (!input.trim() || interviewMutation.isPending) return;

    const userMessage = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setInput("");

    interviewMutation.mutate({
      previousMessages: [...messages, { role: "user", content: userMessage }],
      userResponse: userMessage,
    });
  };

  // 自動スクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // キーボードショートカット
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const progress = totalScenarios > 0 ? (currentScenarioIndex / totalScenarios) * 100 : 0;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          価値観シナリオインタビュー
        </CardTitle>
        <CardDescription>
          具体的な状況に対するあなたの考えを教えてください。友達の分身AIがあなたの価値観を評価し、徳波形・地雷波形を生成します。
        </CardDescription>
        {totalScenarios > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>進捗: {currentScenarioIndex} / {totalScenarios} シナリオ</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}
      </CardHeader>
      <CardContent>
        {messages.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              価値観シナリオインタビューを開始すると、様々な状況に対するあなたの考えを聞かせていただきます。
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              例: 「大地震が発生し、被災地でボランティアを募集しています。あなたは参加しますか？」
            </p>
            <Button onClick={startInterview} disabled={interviewMutation.isPending}>
              {interviewMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  準備中...
                </>
              ) : (
                "インタビューを開始"
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* メッセージ表示エリア */}
            <div className="h-[400px] overflow-y-auto border rounded-lg p-4 space-y-4 bg-muted/30">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 ${
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-card border"
                    }`}
                  >
                    <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                  </div>
                </div>
              ))}
              {interviewMutation.isPending && (
                <div className="flex justify-start">
                  <div className="bg-card border rounded-lg px-4 py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 入力エリア */}
            {!isComplete ? (
              <div className="flex gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="あなたの考えを入力してください..."
                  className="min-h-[80px] resize-none"
                  disabled={interviewMutation.isPending}
                />
                <Button
                  onClick={sendMessage}
                  disabled={!input.trim() || interviewMutation.isPending}
                  size="icon"
                  className="h-auto"
                >
                  {interviewMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ) : (
              <div className="text-center py-4">
                <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-2" />
                <p className="text-green-600 font-medium">インタビュー完了！</p>
                <p className="text-sm text-muted-foreground mt-2">
                  あなたの価値観波形が生成されました。
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
