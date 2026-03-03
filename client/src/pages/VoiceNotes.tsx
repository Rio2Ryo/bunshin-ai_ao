import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useState, useRef, useCallback } from "react";
import { Mic, MicOff, Loader2, FileText, CheckCircle, ArrowLeft, Trash2, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function VoiceNotes() {
  usePageMeta({ title: "音声ノート", description: "マッチングの音声メモを記録・要約", path: "/voice-notes" });

  const [sessionId, setSessionId] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [turnNumber, setTurnNumber] = useState<number | undefined>();
  const recognitionRef = useRef<any>(null);

  const { data: sessions } = trpc.matching.sessions.useQuery();
  const { data: notes, refetch: refetchNotes } = trpc.matching.getVoiceNotes.useQuery(
    { sessionId: sessionId! },
    { enabled: !!sessionId }
  );

  const addNoteMut = trpc.matching.addVoiceNote.useMutation();
  const summarizeMut = trpc.matching.summarizeVoiceNotes.useMutation();

  const startRecording = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("お使いのブラウザは音声認識に対応していません");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "ja-JP";
    recognition.continuous = true;
    recognition.interimResults = true;

    let finalTranscript = "";
    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setTranscript(finalTranscript + interim);
    };
    recognition.onerror = () => {
      setIsRecording(false);
      toast.error("音声認識エラーが発生しました");
    };
    recognition.onend = () => setIsRecording(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    setTranscript("");
  }, []);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }, []);

  const saveNote = async () => {
    if (!transcript.trim() || !sessionId) return;
    try {
      await addNoteMut.mutateAsync({ sessionId, turnNumber, transcript: transcript.trim() });
      toast.success("音声ノートを保存しました");
      setTranscript("");
      setTurnNumber(undefined);
      refetchNotes();
    } catch (e: any) {
      toast.error(e.message || "保存に失敗しました");
    }
  };

  const handleSummarize = async () => {
    if (!sessionId) return;
    try {
      const result = await summarizeMut.mutateAsync({ sessionId });
      toast.success(`要約完了: アクションアイテム${result.actionItems.length}件抽出`);
      refetchNotes();
    } catch (e: any) {
      toast.error(e.message || "要約に失敗しました");
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/matching">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Mic className="h-6 w-6 text-primary" />
              音声ノート
            </h1>
            <p className="text-muted-foreground">マッチングの音声メモを記録・AI要約</p>
          </div>
        </div>

        <Tabs defaultValue="record">
          <TabsList>
            <TabsTrigger value="record"><Mic className="h-4 w-4 mr-2" />録音</TabsTrigger>
            <TabsTrigger value="notes"><FileText className="h-4 w-4 mr-2" />ノート一覧</TabsTrigger>
          </TabsList>

          <TabsContent value="record">
            <Card>
              <CardHeader>
                <CardTitle>音声メモ録音</CardTitle>
                <CardDescription>セッションを選択し、音声メモを録音してください</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">セッション選択</label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={sessionId ?? ""}
                    onChange={(e) => setSessionId(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">セッションを選択...</option>
                    {(sessions ?? []).map((s: any) => (
                      <option key={s.id} value={s.id}>#{s.id} {s.theme} ({s.status})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">ターン番号（オプション）</label>
                  <input
                    type="number"
                    min={1}
                    className="w-32 rounded-md border bg-background px-3 py-2 text-sm"
                    value={turnNumber ?? ""}
                    onChange={(e) => setTurnNumber(e.target.value ? Number(e.target.value) : undefined)}
                    placeholder="全体"
                  />
                </div>

                <div className="flex items-center gap-3">
                  {isRecording ? (
                    <Button onClick={stopRecording} variant="destructive" size="lg">
                      <MicOff className="h-5 w-5 mr-2" />録音停止
                    </Button>
                  ) : (
                    <Button onClick={startRecording} size="lg" disabled={!sessionId}>
                      <Mic className="h-5 w-5 mr-2" />録音開始
                    </Button>
                  )}
                  {isRecording && (
                    <span className="flex items-center gap-2 text-sm text-red-500 animate-pulse">
                      <span className="h-2 w-2 rounded-full bg-red-500" />録音中...
                    </span>
                  )}
                </div>

                {transcript && (
                  <div className="space-y-3">
                    <div className="rounded-lg border bg-muted/50 p-4">
                      <p className="text-sm whitespace-pre-wrap">{transcript}</p>
                    </div>
                    <Button onClick={saveNote} disabled={addNoteMut.isPending || !sessionId}>
                      {addNoteMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                      ノートを保存
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notes">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>ノート一覧</CardTitle>
                    <CardDescription>保存済み音声ノート{sessionId ? ` (セッション #${sessionId})` : ""}</CardDescription>
                  </div>
                  {notes && notes.length > 0 && (
                    <Button onClick={handleSummarize} disabled={summarizeMut.isPending} variant="outline">
                      {summarizeMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                      AI要約
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {!sessionId ? (
                  <p className="text-center py-8 text-muted-foreground">セッションを選択してください</p>
                ) : !notes?.length ? (
                  <p className="text-center py-8 text-muted-foreground">音声ノートがまだありません</p>
                ) : (
                  <div className="space-y-3">
                    {notes.map((note: any) => (
                      <div key={note.id} className="rounded-lg border p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Mic className="h-4 w-4 text-primary" />
                            <span className="text-sm font-medium">
                              {note.turnNumber ? `ターン ${note.turnNumber}` : "全体メモ"}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(note.createdAt).toLocaleString("ja-JP")}
                          </span>
                        </div>
                        <p className="text-sm">{note.transcript}</p>
                        {note.summary && (
                          <div className="bg-primary/5 rounded p-2">
                            <p className="text-xs font-medium text-primary mb-1">AI要約</p>
                            <p className="text-xs">{note.summary}</p>
                          </div>
                        )}
                        {note.actionItems?.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {note.actionItems.map((item: string, i: number) => (
                              <Badge key={i} variant="outline" className="text-xs">{item}</Badge>
                            ))}
                          </div>
                        )}
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
