import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { BookOpen, Share2, FolderOpen, Sparkles, Clock, Heart, Zap, Users, Loader2, Copy, Plus } from "lucide-react";

export default function MatchingStoryboard() {
  usePageMeta({ title: "ストーリーボード", description: "マッチングストーリー生成・共有", path: "/storyboard" });

  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [newCollectionName, setNewCollectionName] = useState("");

  // Queries
  const { data: sessionsRaw } = trpc.matching.sessions.useQuery();
  const sessions = (sessionsRaw as any[]) || [];
  const completedSessions = sessions.filter((s: any) => s.status === "completed" || s.matchingResults);

  const { data: storyboardRaw, isLoading: storyboardLoading } = trpc.matching.getStoryboard.useQuery(
    { sessionId: selectedSessionId! },
    { enabled: selectedSessionId !== null }
  );
  const storyboard = storyboardRaw as any;

  const { data: collectionsRaw, refetch: refetchCollections } = trpc.matching.listStoryboardCollections.useQuery();
  const collections = (collectionsRaw as any[]) || [];

  // Mutations
  const generateMut = trpc.matching.generateStoryboard.useMutation({
    onSuccess: () => {
      toast.success("ストーリーボードを生成しました");
    },
    onError: (err: any) => {
      toast.error(err.message || "生成に失敗しました");
    },
  });

  const shareMut = trpc.matching.shareStoryboard.useMutation({
    onSuccess: (data: any) => {
      const code = data?.shareCode || data?.code || "SHARED";
      setShareCode(code);
      toast.success("シェアコードを生成しました");
    },
    onError: (err: any) => {
      toast.error(err.message || "シェアに失敗しました");
    },
  });

  const createCollectionMut = trpc.matching.createStoryboardCollection.useMutation({
    onSuccess: () => {
      toast.success("コレクションを作成しました");
      setNewCollectionName("");
      refetchCollections();
    },
    onError: (err: any) => {
      toast.error(err.message || "作成に失敗しました");
    },
  });

  // Story sections
  const sections = storyboard?.sections || storyboard?.story?.sections || [];
  const keyMoments = storyboard?.keyMoments || storyboard?.story?.keyMoments || [];
  const characters = storyboard?.characters || storyboard?.story?.characters || [];

  const sectionIcons: Record<string, React.ReactNode> = {
    "起": <Sparkles className="h-4 w-4 text-blue-500" />,
    "承": <Clock className="h-4 w-4 text-yellow-500" />,
    "転": <Zap className="h-4 w-4 text-orange-500" />,
    "結": <Heart className="h-4 w-4 text-pink-500" />,
  };

  const sectionColors: Record<string, string> = {
    "起": "border-l-blue-500",
    "承": "border-l-yellow-500",
    "転": "border-l-orange-500",
    "結": "border-l-pink-500",
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <BookOpen className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold">ストーリーボード</h1>
        </div>

        <Tabs defaultValue="generate">
          <TabsList>
            <TabsTrigger value="generate">ストーリー生成</TabsTrigger>
            <TabsTrigger value="collection">コレクション</TabsTrigger>
            <TabsTrigger value="share">共有</TabsTrigger>
          </TabsList>

          {/* ストーリー生成タブ */}
          <TabsContent value="generate" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  マッチングストーリーを生成
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <Select
                    value={selectedSessionId?.toString() || ""}
                    onValueChange={(v) => setSelectedSessionId(Number(v))}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="マッチングセッションを選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {completedSessions.length === 0 && (
                        <SelectItem value="none" disabled>完了済みセッションがありません</SelectItem>
                      )}
                      {completedSessions.map((s: any) => (
                        <SelectItem key={s.id} value={s.id.toString()}>
                          セッション #{s.id} — {s.candidateName || s.candidate_name || `ID:${s.candidateId || s.candidate_id}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => selectedSessionId && generateMut.mutate({ sessionId: selectedSessionId })}
                    disabled={!selectedSessionId || generateMut.isPending}
                  >
                    {generateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    生成
                  </Button>
                </div>
              </CardContent>
            </Card>

            {storyboardLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            )}

            {storyboard && !storyboardLoading && (
              <div className="space-y-4">
                {/* Story sections - 起承転結 */}
                <div className="grid gap-4">
                  {(sections.length > 0 ? sections : [
                    { label: "起", title: "出会い", content: storyboard?.introduction || "ストーリーの始まり" },
                    { label: "承", title: "展開", content: storyboard?.development || "議論が深まる" },
                    { label: "転", title: "転機", content: storyboard?.turning || "転換点" },
                    { label: "結", title: "結末", content: storyboard?.conclusion || "まとめ" },
                  ]).map((section: any, idx: number) => {
                    const label = section.label || ["起", "承", "転", "結"][idx] || "章";
                    return (
                      <Card key={idx} className={`border-l-4 ${sectionColors[label] || "border-l-gray-400"}`}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-lg flex items-center gap-2">
                            {sectionIcons[label] || <BookOpen className="h-4 w-4" />}
                            <Badge variant="outline" className="text-sm">{label}</Badge>
                            {section.title || `第${idx + 1}章`}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-muted-foreground whitespace-pre-wrap">
                            {section.content || section.text || section.description || ""}
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {/* Key Moment Timeline */}
                {keyMoments.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Clock className="h-5 w-5" />
                        キーモーメント
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {keyMoments.map((m: any, idx: number) => (
                          <Badge
                            key={idx}
                            variant="secondary"
                            className="px-3 py-1.5 text-sm"
                          >
                            <Zap className="h-3 w-3 mr-1" />
                            {m.label || m.title || m.moment || `Moment ${idx + 1}`}
                            {m.turn && <span className="ml-1 text-xs opacity-70">Turn {m.turn}</span>}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Character Cards */}
                {characters.length > 0 && (
                  <div className="grid sm:grid-cols-2 gap-4">
                    {characters.map((char: any, idx: number) => (
                      <Card key={idx}>
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center gap-2 text-base">
                            <Users className="h-4 w-4" />
                            {char.name || `キャラクター ${idx + 1}`}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {char.role && (
                            <Badge variant="outline">{char.role}</Badge>
                          )}
                          {char.psychologicalArc && (
                            <p className="text-sm text-muted-foreground">{char.psychologicalArc}</p>
                          )}
                          {char.traits && (
                            <div className="flex flex-wrap gap-1">
                              {(Array.isArray(char.traits) ? char.traits : []).map((trait: string, tidx: number) => (
                                <Badge key={tidx} variant="secondary" className="text-xs">{trait}</Badge>
                              ))}
                            </div>
                          )}
                          {char.arc && (
                            <p className="text-sm text-muted-foreground">{char.arc}</p>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* コレクションタブ */}
          <TabsContent value="collection" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FolderOpen className="h-5 w-5" />
                  コレクション管理
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-3">
                  <Input
                    placeholder="新しいコレクション名"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    onClick={() => newCollectionName.trim() && createCollectionMut.mutate({ name: newCollectionName.trim() })}
                    disabled={!newCollectionName.trim() || createCollectionMut.isPending}
                  >
                    {createCollectionMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                    作成
                  </Button>
                </div>
              </CardContent>
            </Card>

            {collections.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>コレクションがまだありません</p>
                  <p className="text-sm mt-1">上のフォームから作成してください</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {collections.map((col: any) => (
                  <Card key={col.id}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <FolderOpen className="h-4 w-4" />
                        {col.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          {col.storyCount ?? col.story_count ?? 0} ストーリー
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          {col.createdAt ? new Date(col.createdAt).toLocaleDateString("ja-JP") : "—"}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* 共有タブ */}
          <TabsContent value="share" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Share2 className="h-5 w-5" />
                  ストーリーを共有
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <Select
                    value={selectedSessionId?.toString() || ""}
                    onValueChange={(v) => setSelectedSessionId(Number(v))}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="共有するセッションを選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {completedSessions.map((s: any) => (
                        <SelectItem key={s.id} value={s.id.toString()}>
                          セッション #{s.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => selectedSessionId && shareMut.mutate({ sessionId: selectedSessionId })}
                    disabled={!selectedSessionId || shareMut.isPending}
                  >
                    {shareMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Share2 className="h-4 w-4 mr-2" />}
                    シェアコード生成
                  </Button>
                </div>

                {shareCode && (
                  <Card className="bg-muted">
                    <CardContent className="py-4">
                      <p className="text-sm text-muted-foreground mb-2">シェアコード</p>
                      <div className="flex items-center gap-2">
                        <code className="text-lg font-mono bg-background px-3 py-1 rounded flex-1 text-center">
                          {shareCode}
                        </code>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            navigator.clipboard.writeText(shareCode);
                            toast.success("コピーしました");
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* SNS-style preview card */}
                {storyboard && (
                  <Card className="overflow-hidden">
                    <div className="bg-gradient-to-r from-primary/20 to-primary/5 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <BookOpen className="h-5 w-5 text-primary" />
                        <span className="font-semibold">マッチングストーリー</span>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-3">
                        {storyboard?.summary || storyboard?.story?.summary || sections[0]?.content || "ストーリーのプレビュー"}
                      </p>
                    </div>
                    <CardContent className="pt-3 pb-3">
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {characters.length} キャラクター
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {sections.length || 4} 章
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
