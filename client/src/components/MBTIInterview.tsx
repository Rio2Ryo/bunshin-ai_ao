import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Loader2, MessageCircle, CheckCircle2, Brain, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface MBTIType {
  type: string;
  dimensions: {
    EI: number;
    SN: number;
    TF: number;
    JP: number;
  };
  description: string;
  strengths: string[];
  weaknesses: string[];
  compatibleTypes: string[];
  careerSuggestions: string[];
}

interface MBTIInterviewProps {
  onComplete?: (mbtiType: MBTIType) => void;
}

// MBTIタイプの色分け
const getMBTIColor = (type: string) => {
  const analysts = ["INTJ", "INTP", "ENTJ", "ENTP"];
  const diplomats = ["INFJ", "INFP", "ENFJ", "ENFP"];
  const sentinels = ["ISTJ", "ISFJ", "ESTJ", "ESFJ"];
  const explorers = ["ISTP", "ISFP", "ESTP", "ESFP"];
  
  if (analysts.includes(type)) return "bg-purple-500";
  if (diplomats.includes(type)) return "bg-green-500";
  if (sentinels.includes(type)) return "bg-blue-500";
  if (explorers.includes(type)) return "bg-yellow-500";
  return "bg-gray-500";
};

const getMBTIGroup = (type: string) => {
  const analysts = ["INTJ", "INTP", "ENTJ", "ENTP"];
  const diplomats = ["INFJ", "INFP", "ENFJ", "ENFP"];
  const sentinels = ["ISTJ", "ISFJ", "ESTJ", "ESFJ"];
  const explorers = ["ISTP", "ISFP", "ESTP", "ESFP"];
  
  if (analysts.includes(type)) return "分析家";
  if (diplomats.includes(type)) return "外交官";
  if (sentinels.includes(type)) return "番人";
  if (explorers.includes(type)) return "探検家";
  return "";
};

export function MBTIInterview({ onComplete }: MBTIInterviewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [mbtiType, setMbtiType] = useState<MBTIType | null>(null);
  const questionRef = useRef<HTMLDivElement>(null);

  const interviewMutation = trpc.myTwin.mbtiInterview.useMutation({
    onSuccess: (data) => {
      // AIの質問を追加
      setMessages(prev => [...prev, { role: "assistant", content: data.question }]);
      
      // 次の質問に自動スクロール
      setTimeout(() => {
        questionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      
      if (data.isComplete && data.mbtiType) {
        setIsComplete(true);
        setMbtiType(data.mbtiType);
        toast.success("MBTI診断が完了しました！");
        onComplete?.(data.mbtiType);
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

  // 次元のラベルを取得
  const getDimensionLabel = (dimension: string, value: number) => {
    switch (dimension) {
      case "EI":
        return value > 0 ? "外向型 (E)" : "内向型 (I)";
      case "SN":
        return value > 0 ? "直観型 (N)" : "感覚型 (S)";
      case "TF":
        return value > 0 ? "感情型 (F)" : "思考型 (T)";
      case "JP":
        return value > 0 ? "知覚型 (P)" : "判断型 (J)";
      default:
        return "";
    }
  };

  if (isComplete && mbtiType) {
    return (
      <Card className="border-purple-500/50 bg-purple-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-purple-600">
            <CheckCircle2 className="h-5 w-5" />
            MBTI診断完了
          </CardTitle>
          <CardDescription>
            あなたのMBTI性格タイプが判定されました
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* MBTIタイプ表示 */}
          <div className="text-center">
            <Badge className={`${getMBTIColor(mbtiType.type)} text-white text-2xl px-6 py-2`}>
              {mbtiType.type}
            </Badge>
            <p className="text-sm text-muted-foreground mt-2">{getMBTIGroup(mbtiType.type)}</p>
          </div>

          {/* 説明 */}
          <p className="text-center text-muted-foreground">{mbtiType.description}</p>

          {/* 4つの次元 */}
          <div className="space-y-3">
            <h4 className="font-medium">性格の次元</h4>
            {Object.entries(mbtiType.dimensions).map(([key, value]) => (
              <div key={key} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{getDimensionLabel(key, value)}</span>
                  <span className="text-muted-foreground">{Math.abs(value)}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all ${value > 0 ? 'bg-purple-500' : 'bg-blue-500'}`}
                    style={{ width: `${Math.abs(value)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* 強み・弱み */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="font-medium text-green-600 mb-2">強み</h4>
              <ul className="text-sm space-y-1">
                {mbtiType.strengths.map((s, i) => (
                  <li key={i} className="flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-green-500" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-orange-600 mb-2">課題</h4>
              <ul className="text-sm space-y-1">
                {mbtiType.weaknesses.map((w, i) => (
                  <li key={i} className="text-muted-foreground">• {w}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* 相性の良いタイプ */}
          <div>
            <h4 className="font-medium mb-2">相性の良いタイプ</h4>
            <div className="flex flex-wrap gap-2">
              {mbtiType.compatibleTypes.map((t, i) => (
                <Badge key={i} variant="outline" className={getMBTIColor(t) + " text-white"}>
                  {t}
                </Badge>
              ))}
            </div>
          </div>

          {/* キャリア提案 */}
          <div>
            <h4 className="font-medium mb-2">適したキャリア</h4>
            <div className="flex flex-wrap gap-2">
              {mbtiType.careerSuggestions.map((c, i) => (
                <Badge key={i} variant="secondary">{c}</Badge>
              ))}
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
            MBTI性格診断
          </CardTitle>
          <CardDescription>
            8-10個の質問に答えることで、あなたの16タイプのMBTI性格を診断します
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
                MBTI診断を開始
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
          MBTI性格診断
        </CardTitle>
        <CardDescription>
          質問に自由に回答してください（{messages.filter(m => m.role === "user").length}/10問程度）
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 最新の質問のみ表示（1つずつ） */}
        <div ref={questionRef} className="space-y-3">
          {messages.length > 0 && (
            <div className="bg-muted rounded-lg px-4 py-3">
              <p className="text-sm text-muted-foreground mb-1">質問 {messages.filter(m => m.role === "assistant").length}</p>
              <p>{messages.filter(m => m.role === "assistant").slice(-1)[0]?.content}</p>
            </div>
          )}
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
