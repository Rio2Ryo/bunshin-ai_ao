import { useState, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Mic, Image, BarChart3, History, Loader2, MicOff, Send } from "lucide-react";
import { toast } from "sonner";

export default function MultimodalInput() {
  const [tab, setTab] = useState("input");
  const [voiceText, setVoiceText] = useState("");
  const [imageText, setImageText] = useState("");
  const [voiceTitle, setVoiceTitle] = useState("");
  const [imageTitle, setImageTitle] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  const stats = trpc.myTwin.getMultimodalStats.useQuery();
  const inputs = trpc.myTwin.listMultimodalInputs.useQuery();
  const voiceMutation = trpc.myTwin.processVoiceInput.useMutation();
  const imageMutation = trpc.myTwin.processImageInput.useMutation();
  const utils = trpc.useUtils();

  const startRecording = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { toast.error("このブラウザは音声認識に対応していません"); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = "ja-JP";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      setVoiceText(transcript);
    };
    recognition.onerror = () => { setIsRecording(false); toast.error("音声認識エラー"); };
    recognition.onend = () => setIsRecording(false);
    recognition.start();
    recognitionRef.current = recognition;
    setIsRecording(true);
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  };

  const handleVoiceSubmit = async () => {
    if (!voiceText.trim()) return;
    try {
      await voiceMutation.mutateAsync({ transcript: voiceText, title: voiceTitle || undefined });
      utils.myTwin.getMultimodalStats.invalidate();
      utils.myTwin.listMultimodalInputs.invalidate();
      setVoiceText(""); setVoiceTitle("");
      toast.success("音声メモをナレッジベースに追加しました");
    } catch { toast.error("処理に失敗しました"); }
  };

  const handleImageSubmit = async () => {
    if (!imageText.trim()) return;
    try {
      await imageMutation.mutateAsync({ imageDescription: imageText, title: imageTitle || undefined });
      utils.myTwin.getMultimodalStats.invalidate();
      utils.myTwin.listMultimodalInputs.invalidate();
      setImageText(""); setImageTitle("");
      toast.success("画像テキストをナレッジベースに追加しました");
    } catch { toast.error("処理に失敗しました"); }
  };

  const TYPE_LABELS: Record<string, string> = { voice: "音声", image: "画像", screenshot: "スクショ" };
  const TYPE_COLORS: Record<string, string> = { voice: "bg-blue-500", image: "bg-green-500", screenshot: "bg-purple-500" };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">マルチモーダル入力</h1>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="input"><Mic className="h-4 w-4 mr-1" />入力</TabsTrigger>
            <TabsTrigger value="stats"><BarChart3 className="h-4 w-4 mr-1" />統計</TabsTrigger>
            <TabsTrigger value="history"><History className="h-4 w-4 mr-1" />履歴</TabsTrigger>
          </TabsList>

          <TabsContent value="input">
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Mic className="h-5 w-5" />音声メモ</CardTitle>
                  <CardDescription>音声認識でナレッジを自動追加</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button onClick={isRecording ? stopRecording : startRecording} variant={isRecording ? "destructive" : "default"} className="w-full">
                    {isRecording ? <><MicOff className="h-4 w-4 mr-2" />録音停止</> : <><Mic className="h-4 w-4 mr-2" />録音開始</>}
                  </Button>
                  {isRecording && <div className="flex items-center gap-2"><div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" /><span className="text-sm text-red-500">録音中...</span></div>}
                  <Input placeholder="タイトル（任意）" value={voiceTitle} onChange={e => setVoiceTitle(e.target.value)} />
                  <Textarea placeholder="音声テキスト（自動入力 or 手動入力）" value={voiceText} onChange={e => setVoiceText(e.target.value)} rows={4} />
                  <Button onClick={handleVoiceSubmit} disabled={voiceMutation.isPending || !voiceText.trim()} className="w-full">
                    {voiceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    ナレッジに追加
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Image className="h-5 w-5" />画像・OCR</CardTitle>
                  <CardDescription>スクリーンショットや画像からテキストを入力</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input placeholder="タイトル（任意）" value={imageTitle} onChange={e => setImageTitle(e.target.value)} />
                  <Textarea placeholder="画像から読み取ったテキストを貼り付け" value={imageText} onChange={e => setImageText(e.target.value)} rows={6} />
                  <Button onClick={handleImageSubmit} disabled={imageMutation.isPending || !imageText.trim()} className="w-full">
                    {imageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    ナレッジに追加
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="stats">
            {stats.data && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card><CardContent className="pt-4 text-center"><Mic className="h-6 w-6 mx-auto text-blue-500 mb-1" /><p className="text-2xl font-bold">{stats.data.voice}</p><p className="text-xs text-muted-foreground">音声メモ</p></CardContent></Card>
                <Card><CardContent className="pt-4 text-center"><Image className="h-6 w-6 mx-auto text-green-500 mb-1" /><p className="text-2xl font-bold">{stats.data.image}</p><p className="text-xs text-muted-foreground">画像入力</p></CardContent></Card>
                <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold">{stats.data.total}</p><p className="text-xs text-muted-foreground">合計</p></CardContent></Card>
                <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold">{stats.data.avgAccuracy != null ? `${stats.data.avgAccuracy}%` : "-"}</p><p className="text-xs text-muted-foreground">平均精度</p></CardContent></Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="history">
            <div className="space-y-2">
              {(inputs.data ?? []).map((inp: any) => (
                <Card key={inp.id}>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={`${TYPE_COLORS[inp.inputType] || "bg-gray-500"} text-white`}>{TYPE_LABELS[inp.inputType] || inp.inputType}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(inp.createdAt).toLocaleDateString("ja-JP")}</span>
                      {inp.feedbackRating && <Badge variant={inp.feedbackRating === "good" ? "default" : "destructive"}>{inp.feedbackRating === "good" ? "\u{1F44D}" : "\u{1F44E}"}</Badge>}
                    </div>
                    <p className="text-sm">{inp.processedText?.substring(0, 150) || inp.rawContent?.substring(0, 150)}</p>
                  </CardContent>
                </Card>
              ))}
              {!inputs.data?.length && <p className="text-muted-foreground">入力履歴がありません</p>}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
