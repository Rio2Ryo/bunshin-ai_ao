import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Rocket, Users, MessageSquare, Play, ChevronRight, ChevronLeft, Sparkles, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

const STEPS = ["友達を選ぶ", "テーマを決める", "開始"];

export default function MatchingQuickStart() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [selectedFriendId, setSelectedFriendId] = useState<number | null>(null);
  const [selectedTheme, setSelectedTheme] = useState("");
  const [customTheme, setCustomTheme] = useState("");
  const [dismissed, setDismissed] = useState(false);

  const quickStartQuery = trpc.matching.quickStart.useQuery();
  const startStreaming = trpc.matching.startStreaming.useMutation();

  const data = quickStartQuery.data;

  if (dismissed || quickStartQuery.isLoading || !data?.eligible) return null;

  const selectedFriend = data.friends.find((f: any) => f.friendId === selectedFriendId);
  const finalTheme = selectedTheme === "__custom__" ? customTheme : selectedTheme;
  const defaultTurns = data.defaultTurns || 5;

  const handleStart = async () => {
    if (!selectedFriendId || !finalTheme.trim()) {
      toast.error("友達とテーマを選択してください");
      return;
    }
    try {
      const result = await startStreaming.mutateAsync({
        friendId: selectedFriendId,
        theme: finalTheme,
        turns: defaultTurns,
      });
      navigate(`/matching/${result.sessionId}`);
    } catch (error: any) {
      toast.error(error?.message || "マッチング開始に失敗しました");
    }
  };

  return (
    <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-primary/10 relative">
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 h-7 w-7 p-0"
        onClick={() => setDismissed(true)}
      >
        <X className="h-4 w-4" />
      </Button>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Rocket className="h-5 w-5 text-primary" />
          クイックスタート
          {data.completedCount === 0 && <Badge variant="secondary" className="text-[10px]">初回</Badge>}
        </CardTitle>
        <CardDescription>3ステップでマッチングを開始</CardDescription>
        {/* Step indicator */}
        <div className="flex items-center gap-2 mt-2">
          {STEPS.map((label, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-medium
                ${i < step ? "bg-primary text-primary-foreground" : i === step ? "bg-primary text-primary-foreground ring-2 ring-primary/30" : "bg-muted text-muted-foreground"}`}>
                {i < step ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              <span className={`text-xs ${i === step ? "font-medium" : "text-muted-foreground"}`}>{label}</span>
              {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            </div>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {/* Step 0: Select friend */}
        {step === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground mb-3">マッチングする友達を選んでください</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {data.friends.map((friend: any) => (
                <div
                  key={friend.friendId}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                    ${selectedFriendId === friend.friendId ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                  onClick={() => setSelectedFriendId(friend.friendId)}
                >
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={friend.avatarUrl} />
                    <AvatarFallback className="text-xs">{(friend.friendName || "?")[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium truncate">{friend.twinName || friend.friendName}</span>
                      {friend.isNpc && <Badge variant="outline" className="text-[9px] px-1 py-0">NPC</Badge>}
                    </div>
                    {friend.company && <p className="text-xs text-muted-foreground truncate">{friend.company}</p>}
                    {friend.twinTags.length > 0 && (
                      <div className="flex gap-1 mt-0.5">
                        {friend.twinTags.map((tag: string, i: number) => (
                          <Badge key={i} variant="secondary" className="text-[9px] px-1 py-0">{tag}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedFriendId === friend.friendId && <Check className="h-4 w-4 text-primary shrink-0" />}
                </div>
              ))}
            </div>
            {data.friends.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">分身AIを持つ友達がいません</p>
            )}
            <div className="flex justify-end mt-3">
              <Button size="sm" onClick={() => setStep(1)} disabled={!selectedFriendId}>
                次へ <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 1: Select theme */}
        {step === 1 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground mb-3">対話テーマを選んでください（またはカスタム入力）</p>
            <div className="grid grid-cols-1 gap-1.5">
              {data.suggestedThemes.map((t: string, i: number) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors text-sm
                    ${selectedTheme === t ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                  onClick={() => { setSelectedTheme(t); setCustomTheme(""); }}
                >
                  <Sparkles className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="flex-1">{t}</span>
                  {selectedTheme === t && <Check className="h-4 w-4 text-primary shrink-0" />}
                </div>
              ))}
              <div
                className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors text-sm
                  ${selectedTheme === "__custom__" ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                onClick={() => setSelectedTheme("__custom__")}
              >
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 text-muted-foreground">自分でテーマを入力...</span>
              </div>
            </div>
            {selectedTheme === "__custom__" && (
              <input
                className="w-full mt-2 px-3 py-2 rounded-md border bg-background text-sm"
                placeholder="テーマを入力してください"
                value={customTheme}
                onChange={(e) => setCustomTheme(e.target.value)}
                autoFocus
              />
            )}
            <div className="flex justify-between mt-3">
              <Button variant="outline" size="sm" onClick={() => setStep(0)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> 戻る
              </Button>
              <Button size="sm" onClick={() => setStep(2)} disabled={!finalTheme.trim()}>
                次へ <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Confirm & start */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={selectedFriend?.avatarUrl} />
                  <AvatarFallback>{(selectedFriend?.friendName || "?")[0]}</AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-medium text-sm">{selectedFriend?.twinName || selectedFriend?.friendName}</div>
                  {selectedFriend?.company && <p className="text-xs text-muted-foreground">{selectedFriend.company}</p>}
                </div>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">テーマ: </span>
                <span className="font-medium">{finalTheme}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">ターン数: </span>
                <span className="font-medium">{defaultTurns}ターン</span>
              </div>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> 戻る
              </Button>
              <Button onClick={handleStart} disabled={startStreaming.isPending}>
                {startStreaming.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                マッチング開始
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
