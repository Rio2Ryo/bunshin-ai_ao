import { useState, useEffect, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Brain, Clock, Trophy, Target, TrendingUp, AlertTriangle, CheckCircle, XCircle, Loader2, Play } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

type QuizQuestion = {
  id: number;
  question: string;
  options: string[];
  correctIndex?: number;
  explanation?: string;
};

export default function KnowledgeQuiz() {
  usePageMeta({ title: "ナレッジクイズ", description: "ツインのナレッジをクイズで確認", path: "/quiz" });

  const [questionCount, setQuestionCount] = useState("10");
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [quizActive, setQuizActive] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [answerResult, setAnswerResult] = useState<{ correct: boolean; explanation: string } | null>(null);
  const [score, setScore] = useState(0);
  const [quizFinished, setQuizFinished] = useState(false);
  const [timer, setTimer] = useState(0);
  const [timerActive, setTimerActive] = useState(false);

  // Timer
  useEffect(() => {
    if (!timerActive) return;
    const interval = setInterval(() => setTimer((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [timerActive]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Queries
  const { data: historyRaw } = trpc.myTwin.getQuizHistory.useQuery();
  const history = (historyRaw as any) || { attempts: [], totalAttempts: 0, averageAccuracy: 0, averageTime: 0 };

  const { data: weakRaw } = trpc.myTwin.getWeakKnowledge.useQuery();
  const weakItems = (weakRaw as any[]) || [];

  const { data: trendRaw } = trpc.myTwin.getQuizScoreTrend.useQuery();
  const trendData = (trendRaw as any[]) || [];

  // Mutations
  const generateMut = trpc.myTwin.generateQuiz.useMutation({
    onSuccess: (data: any) => {
      const q = data?.questions || data || [];
      if (q.length > 0) {
        setQuestions(q);
        setCurrentQuestionIdx(0);
        setScore(0);
        setQuizActive(true);
        setQuizFinished(false);
        setSelectedAnswer(null);
        setAnswerResult(null);
        setTimer(0);
        setTimerActive(true);
        toast.success("クイズを開始します！");
      } else {
        toast.error("クイズの生成に失敗しました");
      }
    },
    onError: (err: any) => {
      toast.error(err.message || "クイズの生成に失敗しました");
    },
  });

  const answerMut = trpc.myTwin.answerQuiz.useMutation({
    onSuccess: (data: any) => {
      const correct = data?.correct ?? data?.isCorrect ?? false;
      const explanation = data?.explanation || "解説なし";
      setAnswerResult({ correct, explanation });
      if (correct) setScore((s) => s + 1);
    },
    onError: (err: any) => {
      toast.error(err.message || "回答の送信に失敗しました");
    },
  });

  const handleAnswer = useCallback((optionIdx: number) => {
    if (selectedAnswer !== null) return;
    setSelectedAnswer(optionIdx);
    const q = questions[currentQuestionIdx];
    answerMut.mutate({
      quizId: q.id,
      selectedIndex: optionIdx,
    });
  }, [selectedAnswer, questions, currentQuestionIdx, answerMut]);

  const handleNext = useCallback(() => {
    if (currentQuestionIdx + 1 >= questions.length) {
      setQuizFinished(true);
      setQuizActive(false);
      setTimerActive(false);
      return;
    }
    setCurrentQuestionIdx((i) => i + 1);
    setSelectedAnswer(null);
    setAnswerResult(null);
  }, [currentQuestionIdx, questions.length]);

  const currentQuestion = questions[currentQuestionIdx];
  const progressPercent = questions.length > 0 ? ((currentQuestionIdx + (answerResult ? 1 : 0)) / questions.length) * 100 : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <Brain className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold">ナレッジクイズ</h1>
        </div>

        <Tabs defaultValue="quiz">
          <TabsList>
            <TabsTrigger value="quiz">クイズ挑戦</TabsTrigger>
            <TabsTrigger value="history">履歴・統計</TabsTrigger>
            <TabsTrigger value="weakness">弱点分析</TabsTrigger>
          </TabsList>

          {/* クイズ挑戦タブ */}
          <TabsContent value="quiz" className="space-y-4 mt-4">
            {!quizActive && !quizFinished && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Play className="h-5 w-5" />
                    クイズを開始
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">問題数:</span>
                    <Select value={questionCount} onValueChange={setQuestionCount}>
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5問</SelectItem>
                        <SelectItem value="10">10問</SelectItem>
                        <SelectItem value="15">15問</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={() => generateMut.mutate({ count: Number(questionCount) })}
                      disabled={generateMut.isPending}
                    >
                      {generateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Brain className="h-4 w-4 mr-2" />}
                      クイズ生成
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {quizActive && currentQuestion && (
              <div className="space-y-4">
                {/* Progress bar + timer */}
                <div className="flex items-center gap-4">
                  <Progress value={progressPercent} className="flex-1" />
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    {formatTime(timer)}
                  </div>
                  <Badge variant="outline">
                    {currentQuestionIdx + 1} / {questions.length}
                  </Badge>
                </div>

                {/* Question card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">
                      Q{currentQuestionIdx + 1}. {currentQuestion.question}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(currentQuestion.options || []).map((option: string, idx: number) => {
                      let btnVariant: "outline" | "default" | "destructive" = "outline";
                      let icon = null;
                      if (answerResult !== null) {
                        if (idx === selectedAnswer && answerResult.correct) {
                          btnVariant = "default";
                          icon = <CheckCircle className="h-4 w-4 mr-2 text-green-300" />;
                        } else if (idx === selectedAnswer && !answerResult.correct) {
                          btnVariant = "destructive";
                          icon = <XCircle className="h-4 w-4 mr-2" />;
                        }
                      }
                      return (
                        <Button
                          key={idx}
                          variant={btnVariant}
                          className="w-full justify-start text-left h-auto py-3 px-4"
                          onClick={() => handleAnswer(idx)}
                          disabled={selectedAnswer !== null}
                        >
                          {icon}
                          <span className="font-mono mr-2 opacity-60">{String.fromCharCode(65 + idx)}.</span>
                          {option}
                        </Button>
                      );
                    })}
                  </CardContent>
                </Card>

                {/* Answer result */}
                {answerResult && (
                  <Card className={answerResult.correct ? "border-green-500/50 bg-green-500/5" : "border-red-500/50 bg-red-500/5"}>
                    <CardContent className="py-4">
                      <div className="flex items-center gap-2 mb-2">
                        {answerResult.correct ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-500" />
                        )}
                        <span className="font-semibold">
                          {answerResult.correct ? "正解！" : "不正解"}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{answerResult.explanation}</p>
                      <Button className="mt-3" onClick={handleNext}>
                        {currentQuestionIdx + 1 >= questions.length ? "結果を見る" : "次の問題へ"}
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Final score */}
            {quizFinished && (
              <Card>
                <CardContent className="py-8 text-center space-y-4">
                  <Trophy className="h-16 w-16 mx-auto text-yellow-500" />
                  <h2 className="text-3xl font-bold">{score} / {questions.length}</h2>
                  <p className="text-muted-foreground">
                    正答率: {questions.length > 0 ? Math.round((score / questions.length) * 100) : 0}% | 所要時間: {formatTime(timer)}
                  </p>
                  <div className="flex justify-center gap-3">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setQuizFinished(false);
                        setQuestions([]);
                      }}
                    >
                      もう一度
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* 履歴・統計タブ */}
          <TabsContent value="history" className="space-y-4 mt-4">
            {/* Stats cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="py-4 text-center">
                  <Target className="h-8 w-8 mx-auto mb-2 text-blue-500" />
                  <p className="text-2xl font-bold">{history.totalAttempts ?? 0}</p>
                  <p className="text-sm text-muted-foreground">総挑戦回数</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4 text-center">
                  <Trophy className="h-8 w-8 mx-auto mb-2 text-yellow-500" />
                  <p className="text-2xl font-bold">{Math.round(history.averageAccuracy ?? 0)}%</p>
                  <p className="text-sm text-muted-foreground">平均正答率</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4 text-center">
                  <Clock className="h-8 w-8 mx-auto mb-2 text-green-500" />
                  <p className="text-2xl font-bold">{Math.round(history.averageTime ?? 0)}秒</p>
                  <p className="text-sm text-muted-foreground">平均回答時間</p>
                </CardContent>
              </Card>
            </div>

            {/* Accuracy trend chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  正答率の推移
                </CardTitle>
              </CardHeader>
              <CardContent>
                {trendData.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">まだデータがありません</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(value: number) => [`${value}%`, "正答率"]} />
                      <Line type="monotone" dataKey="accuracy" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Recent attempts table */}
            <Card>
              <CardHeader>
                <CardTitle>最近の挑戦</CardTitle>
              </CardHeader>
              <CardContent>
                {(history.attempts || []).length === 0 ? (
                  <p className="text-center py-4 text-muted-foreground">まだ挑戦がありません</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-2">日時</th>
                          <th className="text-center py-2 px-2">スコア</th>
                          <th className="text-center py-2 px-2">正答率</th>
                          <th className="text-center py-2 px-2">所要時間</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(history.attempts as any[]).slice(0, 10).map((a: any, idx: number) => (
                          <tr key={idx} className="border-b last:border-0">
                            <td className="py-2 px-2">
                              {a.date ? new Date(a.date).toLocaleDateString("ja-JP") : "—"}
                            </td>
                            <td className="text-center py-2 px-2">
                              {a.score ?? 0}/{a.total ?? 0}
                            </td>
                            <td className="text-center py-2 px-2">
                              <Badge variant={
                                (a.accuracy ?? 0) >= 80 ? "default" :
                                (a.accuracy ?? 0) >= 50 ? "secondary" : "destructive"
                              }>
                                {Math.round(a.accuracy ?? 0)}%
                              </Badge>
                            </td>
                            <td className="text-center py-2 px-2">
                              {a.time ? formatTime(a.time) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 弱点分析タブ */}
          <TabsContent value="weakness" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-500" />
                  弱点ナレッジ
                </CardTitle>
              </CardHeader>
              <CardContent>
                {weakItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Brain className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>クイズに挑戦すると弱点が分析されます</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {weakItems.map((item: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-3 p-3 rounded-lg border">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{item.topic || item.title || `項目 ${idx + 1}`}</p>
                          {item.suggestion && (
                            <p className="text-sm text-muted-foreground mt-1">{item.suggestion}</p>
                          )}
                        </div>
                        <div className="w-24 shrink-0">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span>正答率</span>
                            <span>{Math.round(item.accuracy ?? 0)}%</span>
                          </div>
                          <Progress
                            value={item.accuracy ?? 0}
                            className="h-2"
                          />
                        </div>
                        <Badge variant={
                          (item.accuracy ?? 0) < 30 ? "destructive" :
                          (item.accuracy ?? 0) < 60 ? "secondary" : "default"
                        }>
                          {(item.accuracy ?? 0) < 30 ? "要強化" : (item.accuracy ?? 0) < 60 ? "要復習" : "OK"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
