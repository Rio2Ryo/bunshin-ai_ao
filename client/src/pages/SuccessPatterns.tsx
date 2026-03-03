import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Trophy, BookOpen, Lightbulb, Search, Trash2, Sparkles, Target, Loader2 } from "lucide-react";

const TYPE_CONFIG: Record<string, { emoji: string; color: string; label: string }> = {
  opening_phrase: { emoji: "\uD83D\uDFE2", color: "bg-green-500/20 text-green-400 border-green-500/30", label: "オープニング" },
  question_technique: { emoji: "\uD83D\uDD35", color: "bg-blue-500/20 text-blue-400 border-blue-500/30", label: "質問テクニック" },
  consensus_method: { emoji: "\uD83D\uDFE3", color: "bg-purple-500/20 text-purple-400 border-purple-500/30", label: "合意形成" },
};

const TIMING_COLORS: Record<string, string> = {
  opening: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  middle: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  closing: "bg-rose-500/20 text-rose-400 border-rose-500/30",
};

const TIMING_LABELS: Record<string, string> = {
  opening: "冒頭",
  middle: "中盤",
  closing: "終盤",
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-500/20 text-red-400 border-red-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const PRIORITY_LABELS: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export default function SuccessPatterns() {
  usePageMeta({ title: "成功パターン", description: "マッチング成功パターンの抽出と活用", path: "/success-patterns" });

  const [activeTab, setActiveTab] = useState("extract");
  const [libraryFilter, setLibraryFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestionTheme, setSuggestionTheme] = useState("");

  const { data: patternsRaw, refetch: refetchPatterns } = trpc.matching.listSuccessPatterns.useQuery(
    { patternType: libraryFilter === "all" ? undefined : libraryFilter }
  );
  const patterns = (patternsRaw as any[]) || [];

  const extractMut = trpc.matching.extractSuccessPatterns.useMutation({
    onSuccess: () => {
      toast.success("パターンを抽出しました");
      refetchPatterns();
    },
    onError: (err: any) => toast.error(err.message || "抽出に失敗しました"),
  });

  const deleteMut = trpc.matching.deleteSuccessPattern.useMutation({
    onSuccess: () => {
      toast.success("パターンを削除しました");
      refetchPatterns();
    },
    onError: (err: any) => toast.error(err.message || "削除に失敗しました"),
  });

  const suggestMut = trpc.matching.getPreMatchSuggestions.useMutation({
    onError: (err: any) => toast.error(err.message || "サジェストの取得に失敗しました"),
  });

  const handleExtract = () => {
    extractMut.mutate();
  };

  const handleDelete = (patternId: number) => {
    deleteMut.mutate({ patternId });
  };

  const handleSuggest = () => {
    if (!suggestionTheme.trim()) {
      toast.error("テーマを入力してください");
      return;
    }
    suggestMut.mutate({ theme: suggestionTheme.trim() });
  };

  // Group extracted patterns by type
  const extractedPatterns = (extractMut.data as any)?.patterns || [];
  const groupedExtracted = (extractedPatterns as any[]).reduce((acc: Record<string, any[]>, p: any) => {
    const type = p.patternType || "opening_phrase";
    if (!acc[type]) acc[type] = [];
    acc[type].push(p);
    return acc;
  }, {} as Record<string, any[]>);

  // Filter library patterns by search
  const filteredPatterns = searchQuery
    ? patterns.filter((p: any) =>
        (p.title || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.description || "").toLowerCase().includes(searchQuery.toLowerCase())
      )
    : patterns;

  const suggestions = (suggestMut.data as any)?.suggestions || [];

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Trophy className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">成功パターン</h1>
            <p className="text-sm text-muted-foreground">マッチング成功パターンを抽出・蓄積・活用します</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="extract">
              <Sparkles className="h-4 w-4 mr-1.5" />パターン抽出
            </TabsTrigger>
            <TabsTrigger value="library">
              <BookOpen className="h-4 w-4 mr-1.5" />パターンライブラリ
            </TabsTrigger>
            <TabsTrigger value="suggest">
              <Target className="h-4 w-4 mr-1.5" />マッチング前サジェスト
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: パターン抽出 */}
          <TabsContent value="extract" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  成功パターンを抽出
                </CardTitle>
                <CardDescription>過去のマッチング対話から成功パターンをAIが抽出します</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={handleExtract} disabled={extractMut.isPending}>
                  {extractMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
                  パターンを抽出
                </Button>
              </CardContent>
            </Card>

            {Object.keys(groupedExtracted).length > 0 ? (
              Object.entries(groupedExtracted).map(([type, items]) => {
                const config = TYPE_CONFIG[type] || { emoji: "\u26AA", color: "bg-muted", label: type };
                return (
                  <div key={type} className="space-y-3">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <span>{config.emoji}</span>
                      {config.label}
                      <Badge variant="secondary" className="text-xs">{(items as any[]).length}件</Badge>
                    </h3>
                    <div className="grid gap-3 md:grid-cols-2">
                      {(items as any[]).map((pattern: any, idx: number) => (
                        <Card key={idx} className="hover:border-primary/30 transition-colors">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-base">{pattern.title}</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <p className="text-sm text-muted-foreground">{pattern.description}</p>
                            {(pattern.examples || []).length > 0 && (
                              <div className="space-y-1">
                                <p className="text-xs font-medium text-muted-foreground">例:</p>
                                <ul className="space-y-1">
                                  {(pattern.examples as string[]).map((ex: string, i: number) => (
                                    <li key={i} className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
                                      &ldquo;{ex}&rdquo;
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {pattern.effectiveness != null && (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">効果</span>
                                  <span className="font-medium">{pattern.effectiveness}%</span>
                                </div>
                                <Progress value={pattern.effectiveness} className="h-1.5" />
                              </div>
                            )}
                            {(pattern.tags || []).length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {(pattern.tags as string[]).map((tag: string, i: number) => (
                                  <Badge key={i} variant="outline" className="text-xs">{tag}</Badge>
                                ))}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })
            ) : (
              !extractMut.isPending && (
                <Card className="border-dashed">
                  <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                    <Trophy className="h-12 w-12 text-muted-foreground/40 mb-4" />
                    <p className="text-muted-foreground">「パターンを抽出」ボタンで成功パターンを抽出します</p>
                  </CardContent>
                </Card>
              )
            )}
          </TabsContent>

          {/* Tab 2: パターンライブラリ */}
          <TabsContent value="library" className="space-y-4">
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="パターンを検索..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: "all", label: "すべて" },
                    { value: "opening_phrase", label: "\uD83D\uDFE2 オープニング" },
                    { value: "question_technique", label: "\uD83D\uDD35 質問テクニック" },
                    { value: "consensus_method", label: "\uD83D\uDFE3 合意形成" },
                  ].map((filter) => (
                    <Button
                      key={filter.value}
                      variant={libraryFilter === filter.value ? "default" : "outline"}
                      size="sm"
                      onClick={() => setLibraryFilter(filter.value)}
                    >
                      {filter.label}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {filteredPatterns.length > 0 ? (
              <div className="space-y-3">
                {filteredPatterns.map((pattern: any) => {
                  const config = TYPE_CONFIG[pattern.patternType] || { emoji: "\u26AA", color: "bg-muted", label: pattern.patternType };
                  return (
                    <Card key={pattern.id}>
                      <CardContent className="py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center gap-2">
                              <span>{config.emoji}</span>
                              <h4 className="font-medium">{pattern.title}</h4>
                              <Badge variant="outline" className={`text-xs ${config.color}`}>{config.label}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">{pattern.description}</p>
                            {pattern.effectiveness != null && (
                              <div className="w-32 space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">効果</span>
                                  <span>{pattern.effectiveness}%</span>
                                </div>
                                <Progress value={pattern.effectiveness} className="h-1.5" />
                              </div>
                            )}
                            {(pattern.tags || []).length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {(pattern.tags as string[]).map((tag: string, i: number) => (
                                  <Badge key={i} variant="outline" className="text-xs">{tag}</Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => pattern.id && handleDelete(pattern.id)}
                            disabled={deleteMut.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <BookOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <p className="text-muted-foreground">
                    {searchQuery ? "該当するパターンが見つかりません" : "パターンがまだありません。抽出タブで生成してください"}
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Tab 3: マッチング前サジェスト */}
          <TabsContent value="suggest" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Lightbulb className="h-5 w-5" />
                  マッチング前アドバイス
                </CardTitle>
                <CardDescription>テーマを入力すると、成功パターンに基づいたアドバイスを生成します</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-3">
                  <Input
                    placeholder="マッチングテーマを入力..."
                    value={suggestionTheme}
                    onChange={(e) => setSuggestionTheme(e.target.value)}
                    className="flex-1"
                  />
                  <Button onClick={handleSuggest} disabled={suggestMut.isPending}>
                    {suggestMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Target className="h-4 w-4 mr-1.5" />}
                    サジェストを取得
                  </Button>
                </div>
              </CardContent>
            </Card>

            {suggestions.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {suggestions.map((s: any, idx: number) => (
                  <Card key={idx} className="hover:border-primary/30 transition-colors">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base flex-1">{s.title || s.advice}</CardTitle>
                        <div className="flex gap-1.5 flex-shrink-0">
                          {s.timing && (
                            <Badge variant="outline" className={`text-xs ${TIMING_COLORS[s.timing] || ""}`}>
                              {TIMING_LABELS[s.timing] || s.timing}
                            </Badge>
                          )}
                          {s.priority && (
                            <Badge variant="outline" className={`text-xs ${PRIORITY_COLORS[s.priority] || ""}`}>
                              優先度: {PRIORITY_LABELS[s.priority] || s.priority}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground leading-relaxed">{s.description || s.advice}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              !suggestMut.isPending && (
                <Card className="border-dashed">
                  <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                    <Target className="h-12 w-12 text-muted-foreground/40 mb-4" />
                    <p className="text-muted-foreground">テーマを入力して「サジェストを取得」を押してください</p>
                  </CardContent>
                </Card>
              )
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
