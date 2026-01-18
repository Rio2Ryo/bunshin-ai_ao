import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Loader2, MessageCircle, CheckCircle2, Brain } from "lucide-react";
import { toast } from "sonner";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface PersonalityInterviewProps {
  onComplete?: (traits: {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
  }) => void;
}

export function PersonalityInterview({ onComplete }: PersonalityInterviewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [traits, setTraits] = useState<{
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
  } | null>(null);

  const interviewMutation = trpc.myTwin.personalityInterview.useMutation({
    onSuccess: (data) => {
      // AIの質問を追加
      setMessages(prev => [...prev, { role: "assistant", content: data.question }]);
      
      if (data.isComplete && data.traits) {
        setIsComplete(true);
        setTraits(data.traits);
        toast.success("性格診断が完了しました！");
        onComplete?.(data.traits);
      }
    },
    onError: (error) => {
      toast.error(`エラー: ${error.message}`);
    }
  });

  const startInterview = () => {
    interviewMutation.mutate({
      previousMessages: [],
      userResponse: undefined
    });
  };

  const sendResponse = () => {
    if (!userInput.trim()) return;

    // ユーザーの回答を追加
    const newMessages: Message[] = [...messages, { role: "user", content: userInput }];
    setMessages(newMessages);
    setUserInput("");

    // AIに送信
    interviewMutation.mutate({
      previousMessages: newMessages,
      userResponse: userInput
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendResponse();
    }
  };

  if (isComplete && traits) {
    return (
      <Card className="border-green-500/50 bg-green-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-5 w-5" />
            性格診断完了
          </CardTitle>
          <CardDescription>
            あなたのビッグ・ファイブ性格特性が分析されました
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span>開放性</span>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${traits.openness}%` }}
                  />
                </div>
                <span className="text-sm font-medium w-12 text-right">{traits.openness}%</span>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span>誠実性</span>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${traits.conscientiousness}%` }}
                  />
                </div>
                <span className="text-sm font-medium w-12 text-right">{traits.conscientiousness}%</span>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span>外向性</span>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-yellow-500 rounded-full transition-all"
                    style={{ width: `${traits.extraversion}%` }}
                  />
                </div>
                <span className="text-sm font-medium w-12 text-right">{traits.extraversion}%</span>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span>協調性</span>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-purple-500 rounded-full transition-all"
                    style={{ width: `${traits.agreeableness}%` }}
                  />
                </div>
                <span className="text-sm font-medium w-12 text-right">{traits.agreeableness}%</span>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span>神経症的傾向</span>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-red-500 rounded-full transition-all"
                    style={{ width: `${traits.neuroticism}%` }}
                  />
                </div>
                <span className="text-sm font-medium w-12 text-right">{traits.neuroticism}%</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (messages.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            性格診断インタビュー
          </CardTitle>
          <CardDescription>
            自由会話形式で5-7個の質問に答えることで、あなたの性格特性を分析します
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={startInterview} disabled={interviewMutation.isPending}>
            {interviewMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                準備中...
              </>
            ) : (
              <>
                <MessageCircle className="mr-2 h-4 w-4" />
                インタビューを開始
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          性格診断インタビュー
        </CardTitle>
        <CardDescription>
          質問に自由に回答してください（{messages.filter(m => m.role === "user").length}/7問程度）
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* メッセージ履歴 */}
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {interviewMutation.isPending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-4 py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            </div>
          )}
        </div>

        {/* 入力フィールド */}
        <div className="flex gap-2">
          <Input
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="回答を入力..."
            disabled={interviewMutation.isPending}
          />
          <Button 
            onClick={sendResponse} 
            disabled={!userInput.trim() || interviewMutation.isPending}
          >
            送信
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
