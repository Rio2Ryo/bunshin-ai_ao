import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useParams, Link } from "wouter";
import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { ArrowLeft, Bot, Play, Pause, SkipBack, SkipForward, Loader2, MessageSquare, StickyNote, Save, Trash2, Sparkles, Share2, Star } from "lucide-react";

export default function MatchingReplay() {
  const { id } = useParams<{ id: string }>();
  const sessionId = parseInt(id || "0");
  usePageMeta({ title: `リプレイ #${sessionId}`, description: "マッチング対話をターンごとにリプレイ再生", path: `/matching/replay/${id}` });

  const { data, isLoading } = trpc.matching.getReplayData.useQuery(
    { sessionId },
    { enabled: sessionId > 0 }
  );
  const saveNoteMut = trpc.matching.saveNote.useMutation();

  // Highlights
  const { data: highlightsData, refetch: refetchHighlights } = trpc.matching.getHighlights.useQuery(
    { sessionId },
    { enabled: sessionId > 0 }
  );
  const generateHighlightsMut = trpc.matching.generateHighlights.useMutation();
  const shareHighlightsMut = trpc.matching.shareHighlights.useMutation();

  const [currentTurn, setCurrentTurn] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(2000); // ms per turn
  const [noteText, setNoteText] = useState("");
  const [editingTurn, setEditingTurn] = useState<number | null>(null);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const dialogues = data?.dialogues ?? [];
  const totalTurns = dialogues.length;
  const highlights = (highlightsData as any)?.highlights ?? [];

  // Playback control
  useEffect(() => {
    if (isPlaying && currentTurn < totalTurns - 1) {
      playTimerRef.current = setInterval(() => {
        setCurrentTurn(prev => {
          if (prev >= totalTurns - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, playbackSpeed);
    }
    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, [isPlaying, totalTurns, playbackSpeed, currentTurn]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      const turns = scrollRef.current.querySelectorAll("[data-turn]");
      if (turns[currentTurn]) {
        turns[currentTurn].scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [currentTurn]);

  const handlePlay = () => setIsPlaying(!isPlaying);
  const handlePrev = () => { setIsPlaying(false); setCurrentTurn(prev => Math.max(0, prev - 1)); };
  const handleNext = () => { setIsPlaying(false); setCurrentTurn(prev => Math.min(totalTurns - 1, prev + 1)); };
  const handleReset = () => { setIsPlaying(false); setCurrentTurn(0); };

  const getNote = useCallback((turnNumber: number) => {
    return data?.notes?.find((n: any) => n.turnNumber === turnNumber)?.content || "";
  }, [data?.notes]);

  const handleSaveNote = async (turnNumber: number) => {
    try {
      await saveNoteMut.mutateAsync({ sessionId, turnNumber, content: noteText });
      toast.success(noteText ? "メモを保存しました" : "メモを削除しました");
      setEditingTurn(null);
      setNoteText("");
    } catch (e: any) {
      toast.error(e.message || "保存に失敗しました");
    }
  };

  const startEditNote = (turnNumber: number) => {
    setEditingTurn(turnNumber);
    setNoteText(getNote(turnNumber));
  };

  const handleGenerateHighlights = async () => {
    try {
      await generateHighlightsMut.mutateAsync({ sessionId });
      toast.success("ハイライトを生成しました");
      refetchHighlights();
    } catch (e: any) {
      toast.error(e.message || "ハイライト生成に失敗しました");
    }
  };

  const handleShareHighlights = async () => {
    try {
      await shareHighlightsMut.mutateAsync({ sessionId, postToFeed: true });
      toast.success("ハイライトをフィードに共有しました");
    } catch (e: any) {
      toast.error(e.message || "共有に失敗しました");
    }
  };

  const getHighlightForTurn = (turnNumber: number) => {
    return highlights.find((h: any) => h.turnNumber === turnNumber);
  };

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case "high": return "bg-red-500/10 text-red-600 border-red-300";
      case "medium": return "bg-yellow-500/10 text-yellow-600 border-yellow-300";
      case "low": return "bg-green-500/10 text-green-600 border-green-300";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getImpactLabel = (impact: string) => {
    switch (impact) {
      case "high": return "高インパクト";
      case "medium": return "中インパクト";
      case "low": return "低インパクト";
      default: return impact;
    }
  };

  if (isLoading) {
    return <DashboardLayout><div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div></DashboardLayout>;
  }

  if (!data) {
    return <DashboardLayout><p className="text-center text-muted-foreground py-8">セッションが見つかりません</p></DashboardLayout>;
  }

  const { session, twin1, twin2, result } = data;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href={`/matching/${sessionId}`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Play className="h-6 w-6 text-primary" />
              対話リプレイ
            </h1>
            <p className="text-sm text-muted-foreground">{session.theme}</p>
          </div>
          {result && (
            <Badge variant="secondary" className="text-lg px-3 py-1">
              スコア: {parseFloat(result.compatibilityScore)}%
            </Badge>
          )}
        </div>

        {/* Playback Controls */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-4">
              <Button size="sm" variant="outline" onClick={handleReset}><SkipBack className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" onClick={handlePrev} disabled={currentTurn <= 0}><SkipBack className="h-4 w-4" /></Button>
              <Button size="sm" onClick={handlePlay}>
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button size="sm" variant="outline" onClick={handleNext} disabled={currentTurn >= totalTurns - 1}><SkipForward className="h-4 w-4" /></Button>
              <div className="flex-1">
                <Slider
                  min={0}
                  max={Math.max(0, totalTurns - 1)}
                  step={1}
                  value={[currentTurn]}
                  onValueChange={([v]) => { setIsPlaying(false); setCurrentTurn(v); }}
                />
              </div>
              <span className="text-sm font-mono text-muted-foreground w-16 text-right">
                {currentTurn + 1}/{totalTurns}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-muted-foreground">速度:</span>
              {[3000, 2000, 1000, 500].map(speed => (
                <Button
                  key={speed}
                  size="sm"
                  variant={playbackSpeed === speed ? "default" : "outline"}
                  className="h-6 text-xs px-2"
                  onClick={() => setPlaybackSpeed(speed)}
                >
                  {speed === 3000 ? "0.5x" : speed === 2000 ? "1x" : speed === 1000 ? "2x" : "4x"}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Highlights Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-yellow-500" />
                ハイライト
              </CardTitle>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleGenerateHighlights}
                  disabled={generateHighlightsMut.isPending}
                >
                  {generateHighlightsMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-1" />
                  )}
                  ハイライト生成
                </Button>
                {highlights.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleShareHighlights}
                    disabled={shareHighlightsMut.isPending}
                  >
                    {shareHighlightsMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Share2 className="h-4 w-4 mr-1" />
                    )}
                    共有
                  </Button>
                )}
              </div>
            </div>
            <CardDescription>対話の中で注目すべきポイントを自動検出</CardDescription>
          </CardHeader>
          {highlights.length > 0 && (
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                {highlights.map((h: any, i: number) => (
                  <div
                    key={i}
                    className="relative p-3 rounded-lg border bg-card hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => {
                      setIsPlaying(false);
                      setCurrentTurn(h.turnNumber);
                    }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Star className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                        <span className="font-medium text-sm">{h.title}</span>
                      </div>
                      <Badge variant="outline" className="text-xs flex-shrink-0">
                        Turn {(h.turnNumber ?? 0) + 1}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{h.reason}</p>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-xs ${getImpactColor(h.impact)}`}>
                        {getImpactLabel(h.impact)}
                      </Badge>
                      {h.category && (
                        <Badge variant="secondary" className="text-xs">
                          {h.category}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>

        {/* Dialogue with replay */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {twin1?.name || "Twin 1"} vs {twin2?.name || "Twin 2"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px] pr-4" ref={scrollRef}>
              <div className="space-y-4">
                {dialogues.map((d: any, i: number) => {
                  const isTwin1 = d.speakerTwinId === session.twin1Id;
                  const speakerName = isTwin1 ? twin1?.name : twin2?.name;
                  const isVisible = i <= currentTurn;
                  const isCurrent = i === currentTurn;
                  const turnNote = getNote(d.turnNumber ?? i);
                  const highlight = getHighlightForTurn(d.turnNumber ?? i);

                  return (
                    <div
                      key={i}
                      data-turn={i}
                      className={`transition-all duration-500 ${
                        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none h-0 overflow-hidden"
                      } ${isCurrent ? "ring-2 ring-primary/30 rounded-lg" : ""}`}
                    >
                      {/* Highlight overlay */}
                      {highlight && isVisible && (
                        <div className={`mb-2 p-2 rounded-lg border-l-4 ${
                          highlight.impact === "high" ? "border-l-red-500 bg-red-50 dark:bg-red-900/10" :
                          highlight.impact === "medium" ? "border-l-yellow-500 bg-yellow-50 dark:bg-yellow-900/10" :
                          "border-l-green-500 bg-green-50 dark:bg-green-900/10"
                        }`}>
                          <div className="flex items-center gap-2">
                            <Star className="h-3.5 w-3.5 text-yellow-500" />
                            <span className="text-xs font-medium">{highlight.title}</span>
                            <Badge className={`text-[10px] px-1.5 py-0 ${getImpactColor(highlight.impact)}`}>
                              {getImpactLabel(highlight.impact)}
                            </Badge>
                            {highlight.category && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{highlight.category}</Badge>
                            )}
                          </div>
                        </div>
                      )}
                      <div className={`flex gap-3 p-2 rounded-lg ${isTwin1 ? "" : "flex-row-reverse"}`}>
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${isTwin1 ? "bg-primary/20" : "bg-accent/20"}`}>
                          <Bot className={`h-5 w-5 ${isTwin1 ? "text-primary" : "text-accent"}`} />
                        </div>
                        <div className={`flex-1 max-w-[80%] ${isTwin1 ? "" : "text-right"}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-medium">{speakerName}</p>
                            <Badge variant="outline" className="text-xs">Turn {(d.turnNumber ?? i) + 1}</Badge>
                          </div>
                          <div className={`rounded-lg p-3 text-sm ${isTwin1 ? "bg-muted" : "bg-accent/10"}`}>
                            {d.content}
                          </div>
                          {/* Note section */}
                          <div className="mt-1 flex items-center gap-1">
                            <button
                              onClick={() => startEditNote(d.turnNumber ?? i)}
                              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                            >
                              <StickyNote className="h-3 w-3" />
                              {turnNote ? "メモあり" : "メモ追加"}
                            </button>
                          </div>
                          {/* Note editor */}
                          {editingTurn === (d.turnNumber ?? i) && (
                            <div className="mt-2 space-y-2 p-2 border rounded-lg bg-background">
                              <Textarea
                                value={noteText}
                                onChange={(e) => setNoteText(e.target.value)}
                                placeholder="このターンについてのメモ..."
                                className="min-h-[60px] text-sm"
                              />
                              <div className="flex gap-2 justify-end">
                                <Button size="sm" variant="ghost" onClick={() => { setEditingTurn(null); setNoteText(""); }}>
                                  キャンセル
                                </Button>
                                {turnNote && (
                                  <Button size="sm" variant="destructive" onClick={() => { setNoteText(""); handleSaveNote(d.turnNumber ?? i); }}>
                                    <Trash2 className="h-3 w-3 mr-1" />削除
                                  </Button>
                                )}
                                <Button size="sm" onClick={() => handleSaveNote(d.turnNumber ?? i)} disabled={saveNoteMut.isPending}>
                                  {saveNoteMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Save className="h-3 w-3 mr-1" />保存</>}
                                </Button>
                              </div>
                            </div>
                          )}
                          {/* Show saved note */}
                          {turnNote && editingTurn !== (d.turnNumber ?? i) && (
                            <div className="mt-1 p-2 text-xs bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200">
                              <StickyNote className="h-3 w-3 inline mr-1" />{turnNote}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
