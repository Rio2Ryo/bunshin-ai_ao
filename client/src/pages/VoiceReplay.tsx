import { useState, useEffect, useRef, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Mic } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "@/hooks/usePageMeta";

export default function VoiceReplay() {
  usePageMeta({ title: "音声リプレイ", description: "マッチング対話を音声で再生", path: "/voice-replay" });
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTurn, setCurrentTurn] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [autoMode, setAutoMode] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const { data: sessions } = trpc.matching.sessions.useQuery();
  const { data: replayData } = trpc.matching.getReplayData.useQuery(
    { sessionId: Number(selectedSession) }, { enabled: !!selectedSession }
  );

  const dialogues = replayData?.dialogues ?? [];
  const completedSessions = (sessions ?? []).filter((s: any) => s.status === "completed");

  // Load available voices
  useEffect(() => {
    const loadVoices = () => {
      const v = window.speechSynthesis?.getVoices() ?? [];
      setVoices(v);
    };
    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
  }, []);

  const getVoiceForSpeaker = useCallback((speaker: string, index: number): SpeechSynthesisVoice | null => {
    const jaVoices = voices.filter(v => v.lang.startsWith("ja"));
    if (jaVoices.length === 0) return voices[0] || null;
    return jaVoices[index % jaVoices.length] || jaVoices[0];
  }, [voices]);

  const speakTurn = useCallback((turnIndex: number) => {
    if (!window.speechSynthesis || turnIndex >= dialogues.length) {
      setIsPlaying(false);
      return;
    }

    window.speechSynthesis.cancel();
    const d = dialogues[turnIndex];
    const utterance = new SpeechSynthesisUtterance(d.content || "");
    utterance.rate = speed;
    utterance.volume = isMuted ? 0 : 1;
    utterance.pitch = turnIndex % 2 === 0 ? 1.0 : 1.2;

    const voice = getVoiceForSpeaker(d.speaker, turnIndex % 2);
    if (voice) utterance.voice = voice;

    utterance.onend = () => {
      if (autoMode && turnIndex + 1 < dialogues.length) {
        setCurrentTurn(turnIndex + 1);
        setTimeout(() => speakTurn(turnIndex + 1), 500);
      } else if (!autoMode) {
        setIsPlaying(false);
      } else {
        setIsPlaying(false);
      }
    };

    utteranceRef.current = utterance;
    setCurrentTurn(turnIndex);
    window.speechSynthesis.speak(utterance);
  }, [dialogues, speed, isMuted, autoMode, getVoiceForSpeaker]);

  const handlePlay = () => {
    if (isPlaying) {
      window.speechSynthesis?.cancel();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      speakTurn(currentTurn);
    }
  };

  const handleNext = () => {
    window.speechSynthesis?.cancel();
    const next = Math.min(currentTurn + 1, dialogues.length - 1);
    setCurrentTurn(next);
    if (isPlaying) speakTurn(next);
  };

  const handlePrev = () => {
    window.speechSynthesis?.cancel();
    const prev = Math.max(currentTurn - 1, 0);
    setCurrentTurn(prev);
    if (isPlaying) speakTurn(prev);
  };

  useEffect(() => {
    return () => { window.speechSynthesis?.cancel(); };
  }, [selectedSession]);

  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Mic className="h-6 w-6" /> 音声リプレイ</h1>
          <p className="text-muted-foreground text-sm mt-1">マッチング対話を音声合成で再生</p>
        </div>

        {!supported && (
          <Card className="border-yellow-500/50">
            <CardContent className="p-4 text-sm text-yellow-600">お使いのブラウザはWeb Speech Synthesis APIに対応していません。Chrome/Edge/Safariをお試しください。</CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-lg">セッション選択</CardTitle></CardHeader>
          <CardContent>
            <Select value={selectedSession} onValueChange={v => { setSelectedSession(v); setCurrentTurn(0); setIsPlaying(false); window.speechSynthesis?.cancel(); }}>
              <SelectTrigger><SelectValue placeholder="マッチングセッションを選択" /></SelectTrigger>
              <SelectContent>
                {completedSessions.map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.theme || `セッション #${s.id}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {dialogues.length > 0 && (
          <>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-center gap-4 mb-4">
                  <Button variant="outline" size="icon" onClick={handlePrev} disabled={currentTurn === 0}><SkipBack className="h-4 w-4" /></Button>
                  <Button size="lg" className="rounded-full w-14 h-14" onClick={handlePlay}>
                    {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 ml-0.5" />}
                  </Button>
                  <Button variant="outline" size="icon" onClick={handleNext} disabled={currentTurn >= dialogues.length - 1}><SkipForward className="h-4 w-4" /></Button>
                  <Button variant={isMuted ? "destructive" : "outline"} size="icon" onClick={() => setIsMuted(!isMuted)}>
                    {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </Button>
                </div>

                <div className="flex items-center gap-4 text-sm">
                  <span className="text-muted-foreground w-20">Turn {currentTurn + 1}/{dialogues.length}</span>
                  <Slider value={[currentTurn]} max={dialogues.length - 1} step={1} onValueChange={v => { setCurrentTurn(v[0]); window.speechSynthesis?.cancel(); setIsPlaying(false); }} className="flex-1" />
                </div>

                <div className="flex items-center gap-4 mt-3">
                  <span className="text-xs text-muted-foreground">速度: {speed}x</span>
                  <Slider value={[speed]} min={0.5} max={2} step={0.25} onValueChange={v => setSpeed(v[0])} className="w-32" />
                  <Button variant={autoMode ? "default" : "outline"} size="sm" onClick={() => setAutoMode(!autoMode)} className="text-xs">
                    {autoMode ? "自動再生 ON" : "自動再生 OFF"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-2">
              {dialogues.map((d: any, i: number) => (
                <Card key={i} className={`cursor-pointer transition-all ${i === currentTurn ? "border-primary ring-1 ring-primary/30" : "opacity-60 hover:opacity-100"}`} onClick={() => { setCurrentTurn(i); if (isPlaying) { window.speechSynthesis?.cancel(); speakTurn(i); } }}>
                  <CardContent className="p-3 flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${i % 2 === 0 ? "bg-primary/10 text-primary" : "bg-orange-100 text-orange-600 dark:bg-orange-900/30"}`}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={i % 2 === 0 ? "default" : "secondary"} className="text-xs">{d.speaker}</Badge>
                        {i === currentTurn && isPlaying && <Badge variant="outline" className="text-xs animate-pulse">再生中</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">{d.content}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}

        {selectedSession && dialogues.length === 0 && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">対話データがありません</CardContent></Card>
        )}
      </div>
    </DashboardLayout>
  );
}
