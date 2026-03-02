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
import { ArrowLeft, Bot, Play, Pause, SkipBack, SkipForward, Loader2, MessageSquare, StickyNote, Save, Trash2 } from "lucide-react";

export default function MatchingReplay() {
  const { id } = useParams<{ id: string }>();
  const sessionId = parseInt(id || "0");
  usePageMeta({ title: `リプレイ #${sessionId}`, description: "マッチング対話をターンごとにリプレイ再生", path: `/matching/replay/${id}` });

  const { data, isLoading } = trpc.matching.getReplayData.useQuery(
    { sessionId },
    { enabled: sessionId > 0 }
  );
  const saveNoteMut = trpc.matching.saveNote.useMutation();

  const [currentTurn, setCurrentTurn] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(2000); // ms per turn
  const [noteText, setNoteText] = useState("");
  const [editingTurn, setEditingTurn] = useState<number | null>(null);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const dialogues = data?.dialogues ?? [];
  const totalTurns = dialogues.length;

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

                  return (
                    <div
                      key={i}
                      data-turn={i}
                      className={`transition-all duration-500 ${
                        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none h-0 overflow-hidden"
                      } ${isCurrent ? "ring-2 ring-primary/30 rounded-lg" : ""}`}
                    >
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
