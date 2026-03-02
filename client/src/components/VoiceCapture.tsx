import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mic, MicOff, Send } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export function VoiceCapture({ onComplete }: { onComplete?: () => void }) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const recognitionRef = useRef<any>(null);

  const captureMutation = trpc.myTwin.captureVoicePersonality.useMutation();

  const isSupported = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const startRecording = useCallback(() => {
    if (!isSupported) {
      toast.error("このブラウザは音声認識に対応していません");
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "ja-JP";

    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (final) setTranscript(prev => prev + final);
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: any) => {
      if (event.error !== "no-speech") {
        toast.error(`音声認識エラー: ${event.error}`);
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
      setInterimTranscript("");
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, [isSupported]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const handleSubmit = async () => {
    if (!transcript.trim() || transcript.trim().length < 10) {
      toast.error("もう少し話してください（最低10文字）");
      return;
    }
    try {
      const result = await captureMutation.mutateAsync({ transcription: transcript.trim() });
      toast.success("音声から人格を反映しました");
      setTranscript("");
      onComplete?.();
    } catch (e: any) {
      toast.error(e.message || "音声分析に失敗しました");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Mic className="h-5 w-5 text-red-500" />
          音声入力で人格キャプチャ
        </CardTitle>
        <CardDescription>
          自分のことを話してください。AIが音声から性格・スキル・価値観を分析し、分身AIに反映します。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isSupported ? (
          <div className="text-center py-4 text-muted-foreground">
            <MicOff className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">このブラウザは音声認識に対応していません</p>
            <p className="text-xs mt-1">Chrome または Edge をお使いください</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-center gap-4">
              <Button
                size="lg"
                variant={isRecording ? "destructive" : "default"}
                onClick={isRecording ? stopRecording : startRecording}
                className="rounded-full w-16 h-16"
              >
                {isRecording ? (
                  <MicOff className="h-6 w-6" />
                ) : (
                  <Mic className="h-6 w-6" />
                )}
              </Button>
            </div>
            <p className="text-center text-sm text-muted-foreground">
              {isRecording ? (
                <span className="text-red-500 font-medium flex items-center justify-center gap-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  録音中... タップで停止
                </span>
              ) : (
                "マイクボタンを押して話し始めてください"
              )}
            </p>

            {(transcript || interimTranscript) && (
              <div className="rounded-lg border p-3 bg-muted/30 max-h-40 overflow-y-auto">
                <p className="text-sm whitespace-pre-wrap">
                  {transcript}
                  {interimTranscript && (
                    <span className="text-muted-foreground">{interimTranscript}</span>
                  )}
                </p>
              </div>
            )}

            {transcript && (
              <div className="flex items-center justify-between">
                <Badge variant="secondary">{transcript.length}文字</Badge>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setTranscript(""); setInterimTranscript(""); }}>
                    クリア
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSubmit}
                    disabled={captureMutation.isPending || transcript.trim().length < 10}
                  >
                    {captureMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-2" />分析中...</>
                    ) : (
                      <><Send className="h-4 w-4 mr-2" />分身AIに反映</>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
