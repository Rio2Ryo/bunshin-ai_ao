import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc, API_BASE } from "@/lib/trpc";
import { useParams, Link } from "wouter";
import { useState, useCallback, useRef, useEffect } from "react";
import { ArrowLeft, Bot, Loader2, BarChart3, MessageSquare, Lightbulb, AlertTriangle, CheckCircle, Download, Users, Calendar, DollarSign, Target, Rocket, Share2, Link as LinkIcon, ExternalLink, Search, Globe, Zap, ThumbsUp, ThumbsDown, Send as SendIcon, Eye, Play, GraduationCap, ChevronDown, ChevronUp } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LazyStreamdown as Streamdown } from "@/components/LazyStreamdown";
import { toast } from "sonner";
import { useMatchingRoom, type MatchingComment, type MatchingReaction } from "@/hooks/useMatchingRoom";
import { type MatchingTurn, type MatchingAnalysis } from "@/hooks/useMatchingStream";
import { useTranslation } from "@/contexts/LanguageContext";

export default function MatchingSession() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const sessionId = parseInt(id || "0");
  usePageMeta({ title: `マッチングセッション #${sessionId}`, description: "マッチング結果の詳細を確認。スコア、対話履歴、分析レポートを閲覧できます。", ogImage: "https://bunshin-ai.pages.dev/og/matching.svg", path: `/matching/${id}` });

  // Streaming state
  const [streamingTurns, setStreamingTurns] = useState<MatchingTurn[]>([]);
  const [streamingAnalysis, setStreamingAnalysis] = useState<MatchingAnalysis | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Comments & reactions state
  const [comments, setComments] = useState<MatchingComment[]>([]);
  const [reactions, setReactions] = useState<Map<number, { count: number; reacted: boolean }>>(new Map());
  const [commentInput, setCommentInput] = useState("");
  const [commentTurn, setCommentTurn] = useState<number | null>(null);

  // Coach mode state
  const [coachMode, setCoachMode] = useState(false);
  const [coachAdvice, setCoachAdvice] = useState<Record<number, any>>({});
  const [expandedCoach, setExpandedCoach] = useState<Record<number, boolean>>({});

  const { data, isLoading, isError, refetch } = trpc.matching.getSession.useQuery(
    { id: sessionId },
    { enabled: sessionId > 0 }
  );

  // Determine if we should stream (session is in 'running' state)
  const shouldStream = data?.session?.status === "running" && !streamingAnalysis;

  const onTurn = useCallback((turn: MatchingTurn) => {
    setStreamingTurns((prev) => [...prev, turn]);
    setIsStreaming(true);
  }, []);

  const onAnalysisStart = useCallback(() => {
    // Analysis is being generated
  }, []);

  const onAnalysisComplete = useCallback((analysis: MatchingAnalysis) => {
    setStreamingAnalysis(analysis);
  }, []);

  const onComplete = useCallback(() => {
    setIsStreaming(false);
    // Refetch to get the final persisted data
    refetch();
    toast.success(t("matchingSession.completed"));
  }, [refetch]);

  const onError = useCallback((message: string) => {
    setIsStreaming(false);
    toast.error(message);
  }, []);

  const onComment = useCallback((comment: MatchingComment) => {
    setComments((prev) => [...prev, comment]);
  }, []);

  const onReaction = useCallback((reaction: MatchingReaction) => {
    setReactions((prev) => {
      const next = new Map(prev);
      const existing = next.get(reaction.turnNumber) || { count: 0, reacted: false };
      next.set(reaction.turnNumber, { count: existing.count + 1, reacted: existing.reacted });
      return next;
    });
  }, []);

  const { phase, connected, sendComment, sendReaction, viewerCount } = useMatchingRoom({
    sessionId,
    enabled: shouldStream,
    onTurn,
    onAnalysisStart,
    onAnalysisComplete,
    onComplete,
    onError,
    onComment,
    onReaction,
    onViewerCount: undefined,
  });

  const handleSendComment = useCallback(() => {
    if (!commentInput.trim()) return;
    sendComment(commentTurn, commentInput.trim());
    setCommentInput("");
    setCommentTurn(null);
  }, [commentInput, commentTurn, sendComment]);

  // Coach mode mutations
  const toggleCoachMut = trpc.matching.toggleCoachMode.useMutation();
  const getCoachAdviceMut = trpc.matching.getCoachAdvice.useMutation();
  const { data: coachHistoryData } = trpc.matching.getCoachHistory.useQuery(
    { sessionId },
    { enabled: coachMode && sessionId > 0 }
  );

  // Pre-populate coach advice from history
  useEffect(() => {
    if (coachHistoryData && coachHistoryData.length > 0) {
      const adviceMap: Record<number, any> = {};
      for (const item of coachHistoryData) {
        adviceMap[item.turnNumber] = { techniques: item.techniques, suggestedQuestions: item.suggestedQuestions, improvementHints: item.improvementHints, overallAdvice: item.overallAdvice };
      }
      setCoachAdvice((prev) => ({ ...prev, ...adviceMap }));
    }
  }, [coachHistoryData]);

  const handleToggleCoachMode = async () => {
    try {
      await toggleCoachMut.mutateAsync({ sessionId, enabled: !coachMode });
      setCoachMode(!coachMode);
      toast.success(coachMode ? "コーチモードをOFFにしました" : "コーチモードをONにしました");
    } catch (e: any) {
      toast.error(e.message || "コーチモードの切替に失敗しました");
    }
  };

  const handleGetCoachAdvice = async (turnNumber: number) => {
    if (coachAdvice[turnNumber]) {
      setExpandedCoach((prev) => ({ ...prev, [turnNumber]: !prev[turnNumber] }));
      return;
    }
    try {
      const result = await getCoachAdviceMut.mutateAsync({ sessionId, turnNumber });
      setCoachAdvice((prev) => ({ ...prev, [turnNumber]: result }));
      setExpandedCoach((prev) => ({ ...prev, [turnNumber]: true }));
    } catch (e: any) {
      toast.error(e.message || "コーチアドバイスの取得に失敗しました");
    }
  };

  const handleLike = useCallback((turnNumber: number) => {
    sendReaction(turnNumber, "like");
    // Optimistic update
    setReactions((prev) => {
      const next = new Map(prev);
      const existing = next.get(turnNumber) || { count: 0, reacted: false };
      if (!existing.reacted) {
        next.set(turnNumber, { count: existing.count + 1, reacted: true });
      }
      return next;
    });
  }, [sendReaction]);

  // Helper to parse multilingual content
  const parseDialogueContent = (content: string) => {
    try {
      const parsed = JSON.parse(content);
      if (parsed.original && parsed.translated) return parsed;
    } catch {}
    return null;
  };

  // Auto-scroll streaming dialogue
  useEffect(() => {
    if (streamingTurns.length > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamingTurns]);

  const { data: reportData, refetch: fetchReport, isFetching: isExporting } = trpc.matching.exportReport.useQuery(
    { sessionId },
    { enabled: false }
  );

  // Feature 1: Friend invite mutation
  const inviteMutation = trpc.matching.inviteFriend.useMutation();
  const handleInviteFriend = async () => {
    try {
      await inviteMutation.mutateAsync({ sessionId });
      toast.success("友達に招待通知を送りました");
    } catch (e: any) {
      toast.error(e.message || "招待の送信に失敗しました");
    }
  };

  // Feature 3: Turn feedback
  const rateTurnMutation = trpc.matching.rateTurn.useMutation();
  const { data: feedbackData, refetch: refetchFeedback } = trpc.matching.getFeedback.useQuery(
    { sessionId },
    { enabled: sessionId > 0 }
  );
  const feedbackMap = new Map<number, string>();
  if (feedbackData) {
    for (const fb of feedbackData) {
      feedbackMap.set(fb.turnNumber, fb.rating);
    }
  }
  const handleRateTurn = async (turnNumber: number, rating: "up" | "down") => {
    try {
      await rateTurnMutation.mutateAsync({ sessionId, turnNumber, rating });
      refetchFeedback();
    } catch (e: any) {
      toast.error(e.message || "評価の送信に失敗しました");
    }
  };

  const [searchQuery, setSearchQuery] = useState("");
  const webSearchMutation = trpc.matching.webSearch.useMutation();
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const handleWebSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      const result = await webSearchMutation.mutateAsync({ query: searchQuery, sessionId });
      setSearchResults(prev => [result, ...prev]);
      setSearchQuery("");
    } catch (e: any) {
      toast.error(e.message || "検索に失敗しました");
    }
  };

  const handleExportPdf = async () => {
    try {
      const result = await fetchReport();
      if (result.data?.html) {
        // Open HTML in new window for printing
        const printWindow = window.open("", "_blank");
        if (printWindow) {
          printWindow.document.write(result.data.html);
          printWindow.document.close();
          toast.success("レポートを新しいタブで開きました。印刷またはPDF保存してください。");
        }
      }
    } catch (error) {
      toast.error("レポートの生成に失敗しました");
    }
  };

  const shareUrl = `https://bunshin-ai.pages.dev/matching/${sessionId}`;

  const handleShare = async () => {
    const shareText = data?.result
      ? `「${data.session.theme}」のマッチング結果: 相性 ${parseFloat(data.result.compatibilityScore || "0")}%`
      : `「${data?.session.theme}」のマッチングセッション`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "分身AI - マッチング結果",
          text: shareText,
          url: shareUrl,
        });
      } catch {
        // User cancelled
      }
    } else {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      toast.success("リンクをクリップボードにコピーしました");
    }
  };

  const handleShareLine = () => {
    const text = encodeURIComponent(
      data?.result
        ? `「${data.session.theme}」のマッチング結果: 相性 ${parseFloat(data.result.compatibilityScore || "0")}%\n${shareUrl}`
        : `「${data?.session.theme}」のマッチングセッション\n${shareUrl}`
    );
    window.open(`https://line.me/R/share?text=${text}`, "_blank");
  };

  const handleShareTwitter = () => {
    const text = encodeURIComponent(
      data?.result
        ? `「${data.session.theme}」のマッチング結果: 相性 ${parseFloat(data.result.compatibilityScore || "0")}% #分身AI`
        : `「${data?.session.theme}」のマッチングセッション #分身AI`
    );
    const url = encodeURIComponent(shareUrl);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank");
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    toast.success("リンクをクリップボードにコピーしました");
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (isError || !data?.session) {
    return (
      <DashboardLayout>
        <div className="text-center py-16">
          <p className="text-muted-foreground">セッションが見つかりません</p>
          <Link href="/matching">
            <Button className="mt-4">一覧に戻る</Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  const { session, twin1, twin2, dialogues, result } = data;
  const compatibilityScore = result?.compatibilityScore ? parseFloat(result.compatibilityScore) : 0;

  // Use streaming data if available, otherwise use persisted data
  const displayDialogues = streamingTurns.length > 0 ? streamingTurns : dialogues;
  const displayResult = streamingAnalysis || result;
  const displayScore = streamingAnalysis?.compatibilityScore ?? compatibilityScore;
  const isRunning = session.status === "running" && phase !== "complete";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/matching">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold">{session.theme}</h1>
                {isRunning && (
                  <span className="flex items-center gap-1.5 text-xs text-primary font-medium animate-pulse">
                    <Zap className="h-3.5 w-3.5" />
                    {phase === "dialogue" ? t("matchingSession.dialogueGenerating") : phase === "analysis" ? t("matchingSession.analyzing") : t("matchingSession.connecting")}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground">
                {twin1?.name || `Twin #${session.twin1Id}`} × {twin2?.name || `Twin #${session.twin2Id}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Viewer count badge */}
            {connected && viewerCount > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted rounded-full px-3 py-1">
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                {viewerCount}人が閲覧中
              </span>
            )}
            {/* Share Button */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Share2 className="h-4 w-4 mr-2" />
                  {t("matchingSession.share")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleShare}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t("matchingSession.share")}...
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleShareLine}>
                  <MessageSquare className="h-4 w-4 mr-2" />
                  {t("matchingSession.shareLine")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleShareTwitter}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t("matchingSession.shareX")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyLink}>
                  <LinkIcon className="h-4 w-4 mr-2" />
                  {t("matchingSession.copyLink")}
                </DropdownMenuItem>
                {data?.session?.settings?.friendId && (
                  <DropdownMenuItem onClick={handleInviteFriend} disabled={inviteMutation.isPending}>
                    <Users className="h-4 w-4 mr-2" />
                    友達を招待（リアルタイム観戦）
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Coach Mode Toggle */}
            {(session.status === "running" || session.status === "completed") && (
              <Button
                variant={coachMode ? "default" : "outline"}
                size="sm"
                onClick={handleToggleCoachMode}
                disabled={toggleCoachMut.isPending}
                className={coachMode ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}
              >
                {toggleCoachMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <GraduationCap className="h-4 w-4 mr-2" />
                )}
                {coachMode ? "コーチON" : "コーチ"}
              </Button>
            )}

            {/* Export Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPdf}
              disabled={isExporting}
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {t("matchingSession.exportPdf")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`${API_BASE}/api/export/matching/${sessionId}/csv`, '_blank')}
            >
              <Download className="h-4 w-4 mr-2" />
              {t("matchingSession.exportCsv")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`${API_BASE}/api/export/matching/${sessionId}/pdf`, '_blank')}
            >
              <Download className="h-4 w-4 mr-2" />
              {t("matchingSession.exportReport")}
            </Button>
            {session.status === "completed" && (
              <Link href={`/matching/replay/${sessionId}`}>
                <Button variant="outline" size="sm"><Play className="h-4 w-4 mr-2" />リプレイ</Button>
              </Link>
            )}
          </div>
        </div>

        {/* Streaming progress indicator */}
        {isRunning && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {phase === "dialogue" ? `${t("matchingSession.dialogueGenerating")} (${streamingTurns.length} ${t("matchingSession.turnsCompleted")})` : phase === "analysis" ? t("matchingSession.analyzing") : t("matchingSession.connecting")}
                  </p>
                  <Progress value={phase === "dialogue" ? (streamingTurns.length / 5) * 70 : phase === "analysis" ? 85 : 10} className="h-1.5 mt-2" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Score Overview */}
        {displayResult && (
          <Card className={`border-primary/50 ${streamingAnalysis && !result ? "animate-in fade-in-0 duration-500" : ""}`}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                {t("matchingSession.result")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-muted-foreground">{t("matchingSession.compatScore")}</span>
                      <span className="text-2xl font-bold text-primary">{displayScore}%</span>
                    </div>
                    <Progress value={displayScore} className="h-3" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">{t("matchingSession.summary")}</p>
                    <p className="font-medium">{displayResult.summary}</p>
                  </div>
                </div>
                
                {/* Score Breakdown */}
                {displayResult.scoreBreakdown && (
                  <div className="border-t pt-4">
                    <h4 className="text-sm font-medium mb-4">{t("matchingSession.scoreBreakdown")}</h4>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {/* Skill Match */}
                      <div className="bg-muted/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">{t("matchingSession.skillMatch")}</span>
                          <span className="text-sm font-bold text-primary">
                            {displayResult.scoreBreakdown.skillMatch?.score || 0}/20
                          </span>
                        </div>
                        <Progress value={(result.scoreBreakdown.skillMatch?.score || 0) * 5} className="h-2 mb-2" />
                        <p className="text-xs text-muted-foreground">
                          {displayResult.scoreBreakdown.skillMatch?.reason || "データなし"}
                        </p>
                      </div>
                      
                      {/* Value Alignment */}
                      <div className="bg-muted/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">{t("matchingSession.valueAlignment")}</span>
                          <span className="text-sm font-bold text-primary">
                            {displayResult.scoreBreakdown.valueAlignment?.score || 0}/20
                          </span>
                        </div>
                        <Progress value={(displayResult.scoreBreakdown.valueAlignment?.score || 0) * 5} className="h-2 mb-2" />
                        <p className="text-xs text-muted-foreground">
                          {displayResult.scoreBreakdown.valueAlignment?.reason || "データなし"}
                        </p>
                      </div>
                      
                      {/* Communication Style */}
                      <div className="bg-muted/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">{t("matchingSession.commStyle")}</span>
                          <span className="text-sm font-bold text-primary">
                            {displayResult.scoreBreakdown.communicationStyle?.score || 0}/20
                          </span>
                        </div>
                        <Progress value={(displayResult.scoreBreakdown.communicationStyle?.score || 0) * 5} className="h-2 mb-2" />
                        <p className="text-xs text-muted-foreground">
                          {displayResult.scoreBreakdown.communicationStyle?.reason || "データなし"}
                        </p>
                      </div>
                      
                      {/* Business Goal Fit */}
                      <div className="bg-muted/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">{t("matchingSession.goalFit")}</span>
                          <span className="text-sm font-bold text-primary">
                            {displayResult.scoreBreakdown.businessGoalFit?.score || 0}/20
                          </span>
                        </div>
                        <Progress value={(displayResult.scoreBreakdown.businessGoalFit?.score || 0) * 5} className="h-2 mb-2" />
                        <p className="text-xs text-muted-foreground">
                          {displayResult.scoreBreakdown.businessGoalFit?.reason || "データなし"}
                        </p>
                      </div>
                      
                      {/* Complementary Strengths */}
                      <div className="bg-muted/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">{t("matchingSession.complement")}</span>
                          <span className="text-sm font-bold text-primary">
                            {displayResult.scoreBreakdown.complementaryStrengths?.score || 0}/20
                          </span>
                        </div>
                        <Progress value={(displayResult.scoreBreakdown.complementaryStrengths?.score || 0) * 5} className="h-2 mb-2" />
                        <p className="text-xs text-muted-foreground">
                          {displayResult.scoreBreakdown.complementaryStrengths?.reason || "データなし"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="dialogue">
          <TabsList>
            <TabsTrigger value="dialogue">
              <MessageSquare className="h-4 w-4 mr-2" />
              {t("matchingSession.tabDialogue")}
            </TabsTrigger>
            <TabsTrigger value="analysis" disabled={!displayResult}>
              <BarChart3 className="h-4 w-4 mr-2" />
              {t("matchingSession.tabAnalysis")}
            </TabsTrigger>
            <TabsTrigger value="websearch">
              <Search className="h-4 w-4 mr-2" />
              {t("matchingSession.tabSearch")}
            </TabsTrigger>
          </TabsList>

          {/* Dialogue Tab */}
          <TabsContent value="dialogue">
            <Card>
              <CardHeader>
                <CardTitle>{t("matchingSession.dialogueTitle")}</CardTitle>
                <CardDescription>
                  {t("matchingSession.dialogueDesc")}（{dialogues?.length || 0} {t("matchingSession.turns")}）
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px] pr-4" ref={scrollRef}>
                  <div className="space-y-4">
                    {displayDialogues && displayDialogues.length > 0 ? (
                      displayDialogues.map((dialogue: any, i: number) => {
                        const speakerTwinId = dialogue.speakerTwinId;
                        const isTwin1 = speakerTwinId === session.twin1Id;
                        const speakerName = dialogue.speakerName || (isTwin1 ? twin1?.name : twin2?.name);
                        const turnNum = dialogue.turnNumber ?? (i + 1);
                        const turnReaction = reactions.get(turnNum);
                        const turnComments = comments.filter(c => c.turnNumber === turnNum);

                        return (
                          <div
                            key={dialogue.id || `stream-${i}`}
                            className={`group/turn animate-in fade-in-0 slide-in-from-bottom-2 duration-300`}
                          >
                            <div className={`flex gap-3 ${isTwin1 ? "" : "flex-row-reverse"}`}>
                              <div
                                className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                                  isTwin1 ? "bg-primary/20" : "bg-accent/20"
                                }`}
                              >
                                <Bot className={`h-5 w-5 ${isTwin1 ? "text-primary" : "text-accent"}`} />
                              </div>
                              <div
                                className={`flex-1 max-w-[80%] ${isTwin1 ? "" : "text-right"}`}
                              >
                                <p className="text-sm font-medium mb-1">
                                  {speakerName || `Twin #${speakerTwinId}`}
                                </p>
                                <div
                                  className={`rounded-lg p-3 ${
                                    isTwin1 ? "bg-muted" : "bg-accent/10"
                                  }`}
                                >
                                  {(() => {
                                    const multilingual = parseDialogueContent(dialogue.content);
                                    if (multilingual) {
                                      return (
                                        <div className="space-y-2">
                                          <div>
                                            <span className="text-xs font-medium text-muted-foreground">{multilingual.language || "原文"}</span>
                                            <Streamdown>{multilingual.original}</Streamdown>
                                          </div>
                                          <div className="border-t pt-2">
                                            <span className="text-xs font-medium text-primary/70 flex items-center gap-1"><Globe className="h-3 w-3" />翻訳</span>
                                            <Streamdown>{multilingual.translated}</Streamdown>
                                          </div>
                                        </div>
                                      );
                                    }
                                    return <Streamdown>{dialogue.content}</Streamdown>;
                                  })()}
                                </div>
                                {/* Like button + feedback + comment trigger */}
                                <div className={`flex items-center gap-2 mt-1 ${isTwin1 ? "" : "justify-end"}`}>
                                  <button
                                    onClick={() => handleLike(turnNum)}
                                    disabled={turnReaction?.reacted}
                                    className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors ${
                                      turnReaction?.reacted
                                        ? "bg-primary/10 text-primary"
                                        : "text-muted-foreground hover:bg-muted opacity-0 group-hover/turn:opacity-100 focus-visible:opacity-100"
                                    }`}
                                    aria-label={`いいね${turnReaction?.count ? `（${turnReaction.count}件）` : ""}`}
                                  >
                                    <ThumbsUp className="h-3 w-3" aria-hidden="true" />
                                    {turnReaction?.count ? turnReaction.count : ""}
                                  </button>
                                  {/* Feedback buttons (shown after session completes) */}
                                  {(session.status === "completed" || phase === "complete") && (
                                    <>
                                      <button
                                        onClick={() => handleRateTurn(turnNum, "up")}
                                        disabled={rateTurnMutation.isPending}
                                        className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors ${
                                          feedbackMap.get(turnNum) === "up"
                                            ? "bg-green-500/20 text-green-600"
                                            : "text-muted-foreground hover:bg-green-500/10 hover:text-green-600 opacity-0 group-hover/turn:opacity-100 focus-visible:opacity-100"
                                        }`}
                                        aria-label="良い発言"
                                      >
                                        <ThumbsUp className="h-3 w-3" aria-hidden="true" />
                                      </button>
                                      <button
                                        onClick={() => handleRateTurn(turnNum, "down")}
                                        disabled={rateTurnMutation.isPending}
                                        className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors ${
                                          feedbackMap.get(turnNum) === "down"
                                            ? "bg-red-500/20 text-red-600"
                                            : "text-muted-foreground hover:bg-red-500/10 hover:text-red-600 opacity-0 group-hover/turn:opacity-100 focus-visible:opacity-100"
                                        }`}
                                        aria-label="改善必要な発言"
                                      >
                                        <ThumbsDown className="h-3 w-3" aria-hidden="true" />
                                      </button>
                                    </>
                                  )}
                                  <button
                                    onClick={() => setCommentTurn(commentTurn === turnNum ? null : turnNum)}
                                    className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full text-muted-foreground hover:bg-muted opacity-0 group-hover/turn:opacity-100 focus-visible:opacity-100 transition-colors"
                                    aria-label="コメント"
                                    aria-expanded={commentTurn === turnNum}
                                  >
                                    <MessageSquare className="h-3 w-3" aria-hidden="true" />
                                    {turnComments.length > 0 ? turnComments.length : ""}
                                  </button>
                                </div>
                                {/* Inline comments for this turn */}
                                {turnComments.length > 0 && (
                                  <div className="mt-1.5 space-y-1 pl-2 border-l-2 border-muted">
                                    {turnComments.map((c, ci) => (
                                      <p key={ci} className="text-xs text-muted-foreground">
                                        <span className="font-medium text-foreground">{c.userName}</span>: {c.content}
                                      </p>
                                    ))}
                                  </div>
                                )}
                                {/* Comment input for this turn */}
                                {commentTurn === turnNum && (
                                  <div className="flex gap-1.5 mt-1.5">
                                    <Input
                                      value={commentInput}
                                      onChange={(e) => setCommentInput(e.target.value)}
                                      placeholder="コメントを入力..."
                                      className="h-7 text-xs"
                                      onKeyDown={(e) => { if (e.key === "Enter") handleSendComment(); }}
                                      autoFocus
                                      aria-label="コメント入力"
                                    />
                                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={handleSendComment} disabled={!commentInput.trim()} aria-label="コメント送信">
                                      <SendIcon className="h-3 w-3" aria-hidden="true" />
                                    </Button>
                                  </div>
                                )}
                                {/* Coach Advice Button */}
                                {coachMode && (session.status === "completed" || phase === "complete" || session.status === "running") && (
                                  <div className="mt-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs gap-1 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20"
                                      onClick={() => handleGetCoachAdvice(turnNum)}
                                      disabled={getCoachAdviceMut.isPending}
                                    >
                                      {getCoachAdviceMut.isPending ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <GraduationCap className="h-3 w-3" />
                                      )}
                                      コーチ
                                      {coachAdvice[turnNum] && (expandedCoach[turnNum] ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                    </Button>
                                    {/* Coach advice card */}
                                    {coachAdvice[turnNum] && expandedCoach[turnNum] && (
                                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-900/10 p-3 space-y-3 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                                        {/* Techniques */}
                                        {coachAdvice[turnNum].techniques && coachAdvice[turnNum].techniques.length > 0 && (
                                          <div>
                                            <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1.5">交渉テクニック</p>
                                            <div className="flex flex-wrap gap-1">
                                              {coachAdvice[turnNum].techniques.map((t: string, ti: number) => (
                                                <Badge key={ti} variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400">{t}</Badge>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                        {/* Suggested Questions */}
                                        {coachAdvice[turnNum].suggestedQuestions && coachAdvice[turnNum].suggestedQuestions.length > 0 && (
                                          <div>
                                            <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1.5">質問サジェスト</p>
                                            <ul className="space-y-1">
                                              {coachAdvice[turnNum].suggestedQuestions.map((q: string, qi: number) => (
                                                <li key={qi} className="text-xs text-muted-foreground flex items-start gap-1.5">
                                                  <Lightbulb className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />
                                                  {q}
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                        {/* Improvement Hints */}
                                        {coachAdvice[turnNum].improvementHints && coachAdvice[turnNum].improvementHints.length > 0 && (
                                          <div>
                                            <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1.5">発言改善ヒント</p>
                                            <ul className="space-y-1">
                                              {coachAdvice[turnNum].improvementHints.map((h: string, hi: number) => (
                                                <li key={hi} className="text-xs text-muted-foreground flex items-start gap-1.5">
                                                  <Target className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />
                                                  {h}
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                        {/* Overall Advice */}
                                        {coachAdvice[turnNum].overallAdvice && (
                                          <div>
                                            <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">総合アドバイス</p>
                                            <p className="text-xs text-muted-foreground">{coachAdvice[turnNum].overallAdvice}</p>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : isRunning ? (
                      <div className="text-center py-8">
                        <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin mb-4" />
                        <p className="text-muted-foreground">{t("matchingSession.generating")}</p>
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                        <p className="text-muted-foreground">{t("matchingSession.noDialogue")}</p>
                      </div>
                    )}
                    {/* Typing indicator during dialogue generation */}
                    {phase === "dialogue" && streamingTurns.length > 0 && (
                      <div className="flex gap-3">
                        <div className="h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 bg-muted">
                          <Bot className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="flex items-center gap-1 px-3 py-2 rounded-lg bg-muted">
                          <span className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Web Search Tab */}
          <TabsContent value="websearch">
            <div className="space-y-4">
              {/* Auto search results from dialogue */}
              {data?.session?.settings?.webSearchResults && data.session.settings.webSearchResults.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="h-5 w-5 text-blue-500" />
                      対話中のリアルタイム検索結果
                    </CardTitle>
                    <CardDescription>マッチング対話中に自動で検索された情報</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {data.session.settings.webSearchResults.map((sr: any, i: number) => (
                        <div key={i} className="border rounded-lg p-3 space-y-2">
                          <p className="text-sm font-medium text-primary">"{sr.query}"</p>
                          {sr.answer && <p className="text-sm text-muted-foreground">{sr.answer}</p>}
                          {sr.sources?.map((s: any, j: number) => (
                            <a key={j} href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-blue-500 hover:underline">
                              <ExternalLink className="h-3 w-3" />
                              {s.title}
                            </a>
                          ))}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Manual search */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Search className="h-5 w-5 text-primary" />
                    追加検索
                  </CardTitle>
                  <CardDescription>テーマに関連する情報を検索</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="検索キーワードを入力..."
                      onKeyDown={(e) => e.key === "Enter" && handleWebSearch()}
                    />
                    <Button onClick={handleWebSearch} disabled={webSearchMutation.isPending || !searchQuery.trim()}>
                      {webSearchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                  </div>

                  {searchResults.length > 0 && (
                    <div className="mt-4 space-y-4">
                      {searchResults.map((sr, i) => (
                        <div key={i} className="border rounded-lg p-4 space-y-3">
                          <p className="text-sm font-medium">"{sr.query}"</p>
                          {sr.answer && (
                            <div className="bg-primary/5 rounded-lg p-3">
                              <p className="text-sm">{sr.answer}</p>
                            </div>
                          )}
                          <div className="space-y-2">
                            {sr.results?.map((r: any, j: number) => (
                              <div key={j} className="border-l-2 border-primary/30 pl-3">
                                <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-500 hover:underline">
                                  {r.title}
                                </a>
                                <p className="text-xs text-muted-foreground mt-1">{r.content}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Analysis Tab */}
          <TabsContent value="analysis">
            {displayResult && (
              <div className="grid gap-6 md:grid-cols-2">
                {/* Collaboration Potential */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Lightbulb className="h-5 w-5 text-yellow-500" />
                      {t("matchingSession.collaboration")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">{displayResult.collaborationPotential}</p>
                  </CardContent>
                </Card>

                {/* Strengths */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                      {t("matchingSession.strengths")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {displayResult.strengths && displayResult.strengths.length > 0 ? (
                      <ul className="space-y-2">
                        {displayResult.strengths.map((strength: string, i: number) => (
                          <li key={i} className="flex items-start gap-2">
                            <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                            <span className="text-sm">{strength}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">データなし</p>
                    )}
                  </CardContent>
                </Card>

                {/* Challenges */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      {t("matchingSession.challenges")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {displayResult.challenges && displayResult.challenges.length > 0 ? (
                      <ul className="space-y-2">
                        {displayResult.challenges.map((challenge: string, i: number) => (
                          <li key={i} className="flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                            <span className="text-sm">{challenge}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">データなし</p>
                    )}
                  </CardContent>
                </Card>

                {/* Recommendations */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Lightbulb className="h-5 w-5 text-primary" />
                      {t("matchingSession.recommendations")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {displayResult.recommendations && displayResult.recommendations.length > 0 ? (
                      <ul className="space-y-2">
                        {displayResult.recommendations.map((rec: string, i: number) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="h-5 w-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center flex-shrink-0">
                              {i + 1}
                            </span>
                            <span className="text-sm">{rec}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">データなし</p>
                    )}
                  </CardContent>
                </Card>

                {/* Role Distribution */}
                {result?.roleDistribution && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-blue-500" />
                        {t("matchingSession.roleDistribution")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Streamdown>{result?.roleDistribution}</Streamdown>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Timeline */}
                {result?.timeline && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Calendar className="h-5 w-5 text-purple-500" />
                        {t("matchingSession.timeline")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Streamdown>{result?.timeline}</Streamdown>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Resources */}
                {result?.resources && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <DollarSign className="h-5 w-5 text-green-500" />
                        {t("matchingSession.resources")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Streamdown>{result?.resources}</Streamdown>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* KPIs */}
                {result?.kpis && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Target className="h-5 w-5 text-red-500" />
                        {t("matchingSession.kpi")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Streamdown>{result?.kpis}</Streamdown>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Next Steps */}
                {result?.nextSteps && (
                  <Card className="md:col-span-2 border-primary/50 bg-primary/5">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Rocket className="h-5 w-5 text-primary" />
                        {t("matchingSession.nextSteps")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Streamdown>{result?.nextSteps}</Streamdown>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Detailed Analysis */}
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle>{t("matchingSession.detailedAnalysis")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <Streamdown>{result?.detailedAnalysis || "詳細分析データがありません"}</Streamdown>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
